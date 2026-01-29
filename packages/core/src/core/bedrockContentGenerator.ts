/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  Tool,
  ToolListUnion,
} from '@google/genai';
import { FinishReason, GenerateContentResponse } from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandOutput,
  type ConverseStreamOutput,
  type Message,
  type ContentBlock,
  type SystemContentBlock,
  type StopReason,
  type ToolConfiguration,
  type Tool as BedrockTool,
} from '@aws-sdk/client-bedrock-runtime';
import { debugLogger } from '../utils/debugLogger.js';
import { retryWithBackoff } from '../utils/retry.js';

/**
 * BedrockContentGenerator implements ContentGenerator interface for AWS Bedrock.
 */
export class BedrockContentGenerator implements ContentGenerator {
  private client: BedrockRuntimeClient;
  private model: string;
  private region: string;

  /**
   * Accumulator for streaming tool calls.
   * Bedrock sends tool input as JSON fragments across multiple contentBlockDelta events.
   * We accumulate the fragments and emit complete functionCall when contentBlockStop arrives.
   */
  private streamingToolUses: Map<
    number, // contentBlockIndex
    {
      toolUseId?: string;
      name?: string;
      input: string; // Accumulated JSON string
    }
  > = new Map();

  constructor(config: { model: string; region?: string }) {
    this.model = config.model;
    this.region = config.region || process.env['AWS_REGION'] || 'us-east-1';

    this.client = new BedrockRuntimeClient({
      region: this.region,
    });

    const credentialSource = this.detectCredentialSource();

    debugLogger.log(
      `[Bedrock] Initialized:\n` +
        `  Model: ${this.model}\n` +
        `  Region: ${this.region}\n` +
        `  Credentials: ${credentialSource}`,
    );
  }

  private detectCredentialSource(): string {
    if (process.env['AWS_ACCESS_KEY_ID']) {
      return 'Environment variables (AWS_ACCESS_KEY_ID)';
    }

    if (process.env['AWS_PROFILE']) {
      return `AWS Profile (${process.env['AWS_PROFILE']})`;
    }

    return 'AWS SDK default credential chain';
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    const { messages, system } = this.convertToBedrockMessages(request);

    // Convert tools if present
    let toolConfig: ToolConfiguration | undefined;
    if (request.config?.tools && request.config.tools.length > 0) {
      toolConfig = await this.convertToolsToBedrockFormat(request.config.tools);
    }

    // Wrap API call with retry logic
    return retryWithBackoff(
      async () => {
        try {
          const command = new ConverseCommand({
            modelId: this.model,
            messages,
            system,
            toolConfig,
            inferenceConfig: {
              maxTokens: request.config?.maxOutputTokens || 4096,
              temperature: request.config?.temperature ?? 1.0,
              topP: request.config?.topP,
            },
          });

          debugLogger.log(
            `[Bedrock] Sending request:\n` +
              `  Model: ${this.model}\n` +
              `  Messages: ${messages.length}\n` +
              `  System: ${system ? 'yes' : 'no'}`,
          );

          const response = await this.client.send(command);

          const elapsedTime = Date.now() - startTime;
          debugLogger.log(
            `[Bedrock] Response received (${elapsedTime}ms):\n` +
              `  Stop Reason: ${response.stopReason}\n` +
              `  Input Tokens: ${response.usage?.inputTokens || 0}\n` +
              `  Output Tokens: ${response.usage?.outputTokens || 0}`,
          );

          return this.convertToGeminiFormat(response);
        } catch (error: unknown) {
          debugLogger.error(`[Bedrock] Error:`, error);
          throw this.enhanceError(error);
        }
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        authType: 'bedrock',
      },
    );
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    const { messages, system } = this.convertToBedrockMessages(request);

    // Convert tools if present
    let toolConfig: ToolConfiguration | undefined;
    if (request.config?.tools && request.config.tools.length > 0) {
      toolConfig = await this.convertToolsToBedrockFormat(request.config.tools);
    }

    // Wrap initial stream setup with retry logic
    // Note: Once stream starts, we cannot retry mid-stream
    const stream = await retryWithBackoff(
      async () => {
        try {
          const command = new ConverseStreamCommand({
            modelId: this.model,
            messages,
            system,
            toolConfig,
            inferenceConfig: {
              maxTokens: request.config?.maxOutputTokens || 4096,
              temperature: request.config?.temperature ?? 1.0,
              topP: request.config?.topP,
            },
          });

          debugLogger.log(
            `[Bedrock] Sending stream request:\n` +
              `  Model: ${this.model}\n` +
              `  Messages: ${messages.length}\n` +
              `  System: ${system ? 'yes' : 'no'}\n` +
              `  Tools: ${toolConfig?.tools?.length || 0}`,
          );

          const response = await this.client.send(command);

          if (!response.stream) {
            throw new Error('No stream in response');
          }

          return response.stream;
        } catch (error: unknown) {
          debugLogger.error(`[Bedrock] Stream error:`, error);
          throw this.enhanceError(error);
        }
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        authType: 'bedrock',
      },
    );

    return this.streamGenerator(stream, startTime);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Handle both array and single content
    const contents = Array.isArray(request.contents)
      ? request.contents
      : [request.contents];

    const textParts: string[] = [];

    for (const c of contents) {
      if (typeof c === 'string') {
        textParts.push(c);
      } else if ('parts' in c && c.parts) {
        for (const p of c.parts) {
          if (typeof p === 'string') {
            textParts.push(p);
          } else if ('text' in p && p.text) {
            textParts.push(p.text);
          }
        }
      }
    }

    const text = textParts.join('');
    const totalTokens = Math.ceil(text.length / 4);
    return { totalTokens };
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('Embedding is not supported for Claude models on Bedrock.');
  }

  /**
   * Generator function to process streaming response from Bedrock.
   * Handles text chunks and accumulates tool calls until complete.
   */
  private async *streamGenerator(
    stream: AsyncIterable<ConverseStreamOutput>,
    startTime: number,
  ): AsyncGenerator<GenerateContentResponse> {
    // Reset accumulator for new stream
    this.streamingToolUses.clear();
    let currentBlockIndex = 0;

    try {
      for await (const event of stream) {
        // 1. Handle tool use start
        if (event.contentBlockStart) {
          const start = event.contentBlockStart;
          currentBlockIndex = start.contentBlockIndex ?? 0;

          // Check if this is a tool use block
          if (start.start && 'toolUse' in start.start) {
            const toolUse = start.start.toolUse;
            this.streamingToolUses.set(currentBlockIndex, {
              toolUseId: toolUse?.toolUseId,
              name: toolUse?.name,
              input: '',
            });

            debugLogger.log(
              `[Bedrock] Tool use started: ${toolUse?.name} (index ${currentBlockIndex})`,
            );
          }
        }

        // 2. Handle content block delta - accumulate JSON input or emit text
        if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta;
          const index = delta.contentBlockIndex ?? currentBlockIndex;

          // Check delta type
          if (delta.delta) {
            // Accumulate tool input (JSON may be fragmented)
            if ('toolUse' in delta.delta && delta.delta.toolUse) {
              const accumulated = this.streamingToolUses.get(index);
              if (accumulated && delta.delta.toolUse.input) {
                accumulated.input += delta.delta.toolUse.input;
                debugLogger.log(
                  `[Bedrock] Tool input fragment (${accumulated.input.length} chars)`,
                );
              }
            }

            // Emit text content immediately
            if ('text' in delta.delta && delta.delta.text) {
              const response = new GenerateContentResponse();
              response.candidates = [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: delta.delta.text }],
                  },
                  finishReason: FinishReason.STOP,
                  safetyRatings: [],
                },
              ];
              yield response;
            }
          }
        }

        // 3. Handle content block stop - emit complete tool call
        if (event.contentBlockStop) {
          const index =
            event.contentBlockStop?.contentBlockIndex ?? currentBlockIndex;
          const accumulated = this.streamingToolUses.get(index);

          if (accumulated?.toolUseId && accumulated.name) {
            try {
              // Parse complete JSON input
              const args = JSON.parse(accumulated.input || '{}');

              debugLogger.log(
                `[Bedrock] Tool use complete: ${accumulated.name}`,
                JSON.stringify(args, null, 2),
              );

              const response = new GenerateContentResponse();
              response.candidates = [
                {
                  content: {
                    role: 'model',
                    parts: [
                      {
                        functionCall: {
                          id: accumulated.toolUseId,
                          name: accumulated.name,
                          args,
                        },
                      },
                    ],
                  },
                  finishReason: FinishReason.STOP,
                  safetyRatings: [],
                },
              ];
              yield response;

              // Clear this tool call
              this.streamingToolUses.delete(index);
            } catch (error) {
              debugLogger.error(
                `[Bedrock] Failed to parse tool input for ${accumulated.name}:`,
                accumulated.input,
                error,
              );
              throw new Error(
                `Invalid JSON in tool call ${accumulated.name}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }

        // 4. Handle stream metadata (usage information)
        if (event.metadata) {
          const usage = event.metadata.usage;
          if (usage) {
            const response = new GenerateContentResponse();
            response.usageMetadata = {
              promptTokenCount: usage.inputTokens || 0,
              candidatesTokenCount: usage.outputTokens || 0,
              totalTokenCount: usage.totalTokens || 0,
            };
            yield response;

            const elapsedTime = Date.now() - startTime;
            debugLogger.log(
              `[Bedrock] Stream complete (${elapsedTime}ms):\n` +
                `  Input Tokens: ${usage.inputTokens || 0}\n` +
                `  Output Tokens: ${usage.outputTokens || 0}`,
            );
          }
        }

        // 5. Handle message stop (finish reason)
        if (event.messageStop) {
          debugLogger.log(
            `[Bedrock] Message stop: ${event.messageStop.stopReason}`,
          );
        }
      }
    } finally {
      // Ensure cleanup
      this.streamingToolUses.clear();
    }
  }

  /**
   * Convert Gemini request to Bedrock Converse format.
   */
  private convertToBedrockMessages(request: GenerateContentParameters): {
    messages: Message[];
    system?: SystemContentBlock[];
  } {
    const messages: Message[] = [];
    let system: SystemContentBlock[] | undefined;

    // Handle system instruction
    if (request.config?.systemInstruction) {
      const sysInstr = request.config.systemInstruction;
      // Type guard: Only pass if it's string, Content, or Content[]
      if (typeof sysInstr === 'string' || this.isContentOrArray(sysInstr)) {
        system = this.convertSystemInstruction(
          sysInstr as string | Content | Content[],
        );
      }
    }

    // Handle contents
    const contents = Array.isArray(request.contents)
      ? request.contents
      : [request.contents];

    for (const content of contents) {
      if (typeof content === 'string') {
        messages.push({
          role: 'user',
          content: [{ text: content }],
        });
        continue;
      }

      if (!('role' in content) || !('parts' in content)) {
        continue;
      }

      // Separate different part types
      const textParts: string[] = [];
      const functionCalls: Array<{
        id?: string;
        name: string;
        args: Record<string, unknown>;
      }> = [];
      const functionResponses: Array<{ id?: string; response: unknown }> = [];

      for (const part of content.parts || []) {
        if (typeof part === 'string') {
          textParts.push(part);
        } else if ('text' in part && part.text) {
          textParts.push(part.text);
        } else if ('functionCall' in part && part.functionCall) {
          functionCalls.push({
            id: part.functionCall.id,
            name: part.functionCall.name || '',
            args: part.functionCall.args || {},
          });
        } else if ('functionResponse' in part && part.functionResponse) {
          functionResponses.push({
            id: part.functionResponse.id,
            response: part.functionResponse.response,
          });
        }
      }

      const role = content.role === 'model' ? 'assistant' : 'user';

      // Handle function responses (tool results)
      if (functionResponses.length > 0) {
        const toolResultBlocks: ContentBlock[] = functionResponses.map(
          (fr) => ({
            toolResult: {
              toolUseId: fr.id || '',
              content: [
                {
                  text:
                    typeof fr.response === 'string'
                      ? fr.response
                      : JSON.stringify(fr.response),
                },
              ],
            },
          }),
        );

        if (textParts.length > 0) {
          toolResultBlocks.unshift({ text: textParts.join('\n') });
        }

        messages.push({
          role: 'user',
          content: toolResultBlocks,
        });
      }
      // Handle function calls (tool uses)
      else if (functionCalls.length > 0) {
        const contentBlocks: ContentBlock[] = [];

        if (textParts.length > 0) {
          contentBlocks.push({ text: textParts.join('\n') });
        }

        for (const fc of functionCalls) {
          contentBlocks.push({
            toolUse: {
              toolUseId: fc.id || `tool_${Date.now()}_${Math.random()}`,
              name: fc.name,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              input: fc.args as any, // Bedrock accepts any JSON-serializable value
            },
          });
        }

        messages.push({
          role: 'assistant',
          content: contentBlocks,
        });
      }
      // Handle regular text messages
      else if (textParts.length > 0) {
        messages.push({
          role,
          content: [{ text: textParts.join('\n') }],
        });
      }
    }

    return { messages, system };
  }

  /**
   * Type guard to check if value is Content or Content[]
   */
  private isContentOrArray(value: unknown): value is Content | Content[] {
    if (Array.isArray(value)) {
      return value.every(
        (item) => typeof item === 'object' && item !== null && 'parts' in item,
      );
    }
    return typeof value === 'object' && value !== null && 'parts' in value;
  }

  /**
   * Convert system instruction to Bedrock format.
   */
  private convertSystemInstruction(
    systemInstruction: string | Content | Content[],
  ): SystemContentBlock[] {
    let systemText = '';

    if (Array.isArray(systemInstruction)) {
      systemText = systemInstruction
        .map((content) => {
          if (typeof content === 'string') return content;
          if ('parts' in content) {
            return (content.parts || [])
              .map((p: Part) =>
                typeof p === 'string' ? p : 'text' in p ? p.text : '',
              )
              .join('\n');
          }
          return '';
        })
        .join('\n');
    } else if (typeof systemInstruction === 'string') {
      systemText = systemInstruction;
    } else if ('parts' in systemInstruction) {
      systemText = (systemInstruction.parts || [])
        .map((p: Part) =>
          typeof p === 'string' ? p : 'text' in p ? p.text : '',
        )
        .join('\n');
    }

    return systemText ? [{ text: systemText }] : [];
  }

  /**
   * Convert Bedrock response to Gemini format.
   */
  private convertToGeminiFormat(
    bedrockResponse: ConverseCommandOutput,
  ): GenerateContentResponse {
    const response = new GenerateContentResponse();
    const parts: Part[] = [];
    let finishReason = FinishReason.STOP;

    const contentBlocks = bedrockResponse.output?.message?.content || [];

    for (const block of contentBlocks) {
      if ('text' in block && block.text) {
        parts.push({ text: block.text });
      } else if ('toolUse' in block && block.toolUse) {
        const toolUse = block.toolUse;
        parts.push({
          functionCall: {
            id: toolUse.toolUseId,
            name: toolUse.name || '',
            args: (toolUse.input as Record<string, unknown>) || {},
          },
        });
      }
    }

    if (bedrockResponse.stopReason) {
      finishReason = this.convertStopReason(bedrockResponse.stopReason);
    }

    // Set response properties
    response.candidates = [
      {
        content: {
          role: 'model',
          parts,
        },
        finishReason,
        safetyRatings: [],
      },
    ];

    response.usageMetadata = bedrockResponse.usage
      ? {
          promptTokenCount: bedrockResponse.usage.inputTokens || 0,
          candidatesTokenCount: bedrockResponse.usage.outputTokens || 0,
          totalTokenCount: bedrockResponse.usage.totalTokens || 0,
        }
      : undefined;

    return response;
  }

  /**
   * Convert Bedrock StopReason to Gemini FinishReason.
   */
  private convertStopReason(stopReason: StopReason): FinishReason {
    switch (stopReason) {
      case 'end_turn':
        return FinishReason.STOP;
      case 'max_tokens':
        return FinishReason.MAX_TOKENS;
      case 'stop_sequence':
        return FinishReason.STOP;
      case 'tool_use':
        return FinishReason.STOP;
      case 'content_filtered':
        return FinishReason.SAFETY;
      default:
        return FinishReason.STOP;
    }
  }

  /**
   * Convert Gemini Tools to Bedrock ToolConfiguration format.
   */
  private async convertToolsToBedrockFormat(
    geminiTools: ToolListUnion,
  ): Promise<ToolConfiguration> {
    const bedrockTools: BedrockTool[] = [];

    for (const tool of geminiTools) {
      let actualTool: Tool;

      // Handle CallableTool vs Tool
      if ('tool' in tool) {
        // This is a CallableTool - resolve it
        actualTool = await tool.tool();
      } else {
        // This is already a Tool
        actualTool = tool;
      }

      // Convert each function declaration to Bedrock tool format
      if (actualTool.functionDeclarations) {
        for (const func of actualTool.functionDeclarations) {
          if (func.name && func.description) {
            bedrockTools.push({
              toolSpec: {
                name: func.name,
                description: func.description,
                inputSchema: {
                  json: this.sanitizeJsonSchema(func.parameters || {}),
                },
              },
            });
          }
        }
      }
    }

    debugLogger.log(
      `[Bedrock] Converted ${bedrockTools.length} tools for Bedrock`,
    );

    return {
      tools: bedrockTools,
    };
  }

  /**
   * Sanitize JSON schema for Bedrock compatibility.
   * Bedrock has stricter requirements than Gemini:
   * - Root level must have type: "object"
   * - No nullable types (type: ["string", "null"])
   * - No additionalProperties
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sanitizeJsonSchema(schema: any): any {
    const sanitized = JSON.parse(JSON.stringify(schema));

    // Ensure root level has type: "object" (Bedrock requirement)
    if (!sanitized.type) {
      sanitized.type = 'object';
    } else if (sanitized.type !== 'object') {
      // If root type is not object, wrap the schema
      debugLogger.warn(
        `[Bedrock] Schema root type is "${sanitized.type}", wrapping in object`,
      );
      return {
        type: 'object',
        properties: {
          value: sanitized,
        },
        required: ['value'],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function traverse(obj: any): void {
      if (typeof obj !== 'object' || obj === null) return;

      // Convert type: ["string", "null"] to type: "string"
      if (Array.isArray(obj.type)) {
        obj.type = obj.type.find((t: string) => t !== 'null') || 'string';
      }

      // Remove additionalProperties
      if ('additionalProperties' in obj) {
        delete obj.additionalProperties;
      }

      // Recursively process nested objects
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          traverse(obj[key]);
        }
      }
    }

    traverse(sanitized);
    return sanitized;
  }

  /**
   * Enhance error with user-friendly messages.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private enhanceError(error: any): Error {
    const errorName = error.name || '';
    const errorMessage = error.message || String(error);

    // Permission errors
    if (errorName === 'AccessDeniedException') {
      return new Error(
        'Insufficient IAM permissions for Bedrock.\n' +
          'Required permissions:\n' +
          '  - bedrock:InvokeModel\n' +
          '  - bedrock:InvokeModelWithResponseStream\n\n' +
          'See: https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html',
      );
    }

    // Model not found
    if (
      errorName === 'ResourceNotFoundException' ||
      errorName === 'ModelNotFoundException'
    ) {
      return new Error(
        `Model ${this.model} not available in region ${this.region}.\n\n` +
          `List available models:\n` +
          `  aws bedrock list-foundation-models --region ${this.region} --by-provider Anthropic\n\n` +
          `Or use a different region:\n` +
          `  export AWS_REGION="us-east-1"\n` +
          `  npm run start`,
      );
    }

    // Validation errors
    if (errorName === 'ValidationException') {
      return new Error(
        `Bedrock validation error: ${errorMessage}\n` +
          'This usually indicates incompatible parameters or schema issues.',
      );
    }

    // Throttling
    if (errorName === 'ThrottlingException') {
      return new Error(
        'AWS Bedrock rate limit exceeded.\n' +
          'Solutions:\n' +
          '  1. Wait and retry\n' +
          '  2. Request quota increase: https://console.aws.amazon.com/servicequotas/\n' +
          '  3. Use a different region',
      );
    }

    // Quota exceeded
    if (errorName === 'ServiceQuotaExceededException') {
      return new Error(
        'AWS service quota exceeded.\n' +
          `Request quota increase: https://console.aws.amazon.com/servicequotas/home/services/bedrock/quotas`,
      );
    }

    // Return original error if not recognized
    return error;
  }
}
