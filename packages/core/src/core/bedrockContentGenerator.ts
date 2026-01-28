/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import type {
  CountTokensResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Part,
  Content,
  Tool,
  ToolListUnion,
  FunctionCall,
} from '@google/genai';
import { GenerateContentResponse, FinishReason } from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandOutput,
  type ConverseStreamCommandOutput,
  type Message,
  type ContentBlock,
  type ToolConfiguration,
  type ToolSpecification,
  type ToolResultBlock,
  type ToolUseBlock,
  type StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
import {
  fromNodeProviderChain,
  fromEnv,
  fromIni,
} from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { logApiResponse } from '../telemetry/loggers.js';
import { toContents } from '../code_assist/converter.js';
import { ApiResponseEvent } from '../telemetry/types.js';
import type { Config } from '../config/config.js';
import { safeJsonParse } from '../utils/safeJsonParse.js';

// Bedrock configuration type
export type BedrockConfig = {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  profile?: string;
};

export class BedrockContentGenerator implements ContentGenerator {
  private client: BedrockRuntimeClient;
  private model: string;
  private config: Config;
  private streamingToolCalls: Map<
    number,
    {
      id?: string;
      name?: string;
      input: string;
    }
  > = new Map();

  constructor(bedrockConfig: BedrockConfig, model: string, config: Config) {
    this.model = model;
    this.config = config;

    const region =
      bedrockConfig.region ||
      process.env['AWS_REGION'] ||
      process.env['AWS_DEFAULT_REGION'] ||
      'us-east-1';

    // Determine credentials provider based on configuration priority:
    // 1. Explicit credentials (accessKeyId/secretAccessKey)
    // 2. AWS Profile (config.profile or AWS_PROFILE env var)
    // 3. Environment variables (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)
    // 4. Default credential chain (IAM Role / Instance Profile)
    let credentials: AwsCredentialIdentityProvider;

    if (bedrockConfig.accessKeyId && bedrockConfig.secretAccessKey) {
      // Use explicit credentials
      credentials = async () => ({
        accessKeyId: bedrockConfig.accessKeyId!,
        secretAccessKey: bedrockConfig.secretAccessKey!,
        sessionToken: bedrockConfig.sessionToken,
      });
    } else if (bedrockConfig.profile || process.env['AWS_PROFILE']) {
      // Use AWS Profile
      credentials = fromIni({
        profile: bedrockConfig.profile || process.env['AWS_PROFILE'],
      });
    } else if (
      process.env['AWS_ACCESS_KEY_ID'] &&
      process.env['AWS_SECRET_ACCESS_KEY']
    ) {
      // Use environment variables
      credentials = fromEnv();
    } else {
      // Use default credential chain
      credentials = fromNodeProviderChain();
    }

    // Configure timeout settings
    const contentGeneratorConfig = this.config.getContentGeneratorConfig();
    const timeout = contentGeneratorConfig?.timeout || 120000;
    const maxRetries = contentGeneratorConfig?.maxRetries ?? 3;

    this.client = new BedrockRuntimeClient({
      region,
      credentials,
      maxAttempts: maxRetries,
      requestHandler: {
        requestTimeout: timeout,
      } as unknown as undefined, // Type cast to handle requestHandler typing
    });
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    const { messages, system, toolConfig } =
      this.convertToBedrockFormat(request);

    try {
      const samplingParams = this.buildSamplingParameters(request);

      const command = new ConverseCommand({
        modelId: this.model,
        messages,
        system: system ? [{ text: system }] : undefined,
        toolConfig,
        inferenceConfig: {
          maxTokens: samplingParams.maxTokens,
          temperature: samplingParams.temperature,
          topP: samplingParams.topP,
        },
      });

      const bedrockResponse = await this.client.send(command);
      const response = this.convertToGeminiFormat(bedrockResponse);
      const durationMs = Date.now() - startTime;

      // Log API response event for UI telemetry
      const responseEvent = new ApiResponseEvent(
        this.model,
        durationMs,
        {
          prompt_id: userPromptId,
          contents: toContents(request.contents),
          generate_content_config: request.config,
        },
        {
          candidates: response.candidates,
        },
        this.config.getContentGeneratorConfig()?.authType,
        response.usageMetadata,
      );

      logApiResponse(this.config, responseEvent);

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Estimate token usage even when there's an error
      let estimatedUsage;
      try {
        const tokenCountResult = await this.countTokens({
          contents: toContents(request.contents),
          model: this.model,
        });
        estimatedUsage = {
          promptTokenCount: tokenCountResult.totalTokens,
          candidatesTokenCount: 0,
          totalTokenCount: tokenCountResult.totalTokens,
        };
      } catch {
        const contentStr = JSON.stringify(request.contents);
        const estimatedTokens = Math.ceil(contentStr.length / 4);
        estimatedUsage = {
          promptTokenCount: estimatedTokens,
          candidatesTokenCount: 0,
          totalTokenCount: estimatedTokens,
        };
      }

      // Log API error event
      const errorEvent = new ApiResponseEvent(
        this.model,
        durationMs,
        {
          prompt_id: userPromptId,
          contents: toContents(request.contents),
          generate_content_config: request.config,
        },
        {},
        this.config.getContentGeneratorConfig()?.authType,
        estimatedUsage,
        errorMessage,
      );
      logApiResponse(this.config, errorEvent);

      // eslint-disable-next-line no-console
      console.error('Bedrock API Error:', errorMessage);
      throw error;
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const startTime = Date.now();
    const { messages, system, toolConfig } =
      this.convertToBedrockFormat(request);

    try {
      const samplingParams = this.buildSamplingParameters(request);

      const command = new ConverseStreamCommand({
        modelId: this.model,
        messages,
        system: system ? [{ text: system }] : undefined,
        toolConfig,
        inferenceConfig: {
          maxTokens: samplingParams.maxTokens,
          temperature: samplingParams.temperature,
          topP: samplingParams.topP,
        },
      });

      const bedrockResponse = await this.client.send(command);
      const originalStream = this.streamGenerator(bedrockResponse);

      // Collect all responses for final logging
      const responses: GenerateContentResponse[] = [];

      const wrappedGenerator = async function* (this: BedrockContentGenerator) {
        try {
          for await (const response of originalStream) {
            responses.push(response);
            yield response;
          }

          const durationMs = Date.now() - startTime;

          // Get final usage metadata from the last response that has it
          const finalUsageMetadata = responses
            .slice()
            .reverse()
            .find((r) => r.usageMetadata)?.usageMetadata;

          // Log API response event
          const responseEvent = new ApiResponseEvent(
            this.model,
            durationMs,
            {
              prompt_id: userPromptId,
              contents: toContents(request.contents),
              generate_content_config: request.config,
            },
            {},
            this.config.getContentGeneratorConfig()?.authType,
            finalUsageMetadata,
          );

          logApiResponse(this.config, responseEvent);
        } catch (error) {
          const durationMs = Date.now() - startTime;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          // Estimate token usage
          let estimatedUsage;
          try {
            const tokenCountResult = await this.countTokens({
              contents: toContents(request.contents),
              model: this.model,
            });
            estimatedUsage = {
              promptTokenCount: tokenCountResult.totalTokens,
              candidatesTokenCount: 0,
              totalTokenCount: tokenCountResult.totalTokens,
            };
          } catch {
            const contentStr = JSON.stringify(request.contents);
            const estimatedTokens = Math.ceil(contentStr.length / 4);
            estimatedUsage = {
              promptTokenCount: estimatedTokens,
              candidatesTokenCount: 0,
              totalTokenCount: estimatedTokens,
            };
          }

          // Log API error event
          const errorEvent = new ApiResponseEvent(
            this.model,
            durationMs,
            {
              prompt_id: userPromptId,
              contents: toContents(request.contents),
              generate_content_config: request.config,
            },
            {},
            this.config.getContentGeneratorConfig()?.authType,
            estimatedUsage,
            errorMessage,
          );
          logApiResponse(this.config, errorEvent);

          throw error;
        }
      }.bind(this);

      return wrappedGenerator();
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Estimate token usage
      let estimatedUsage;
      try {
        const tokenCountResult = await this.countTokens({
          contents: toContents(request.contents),
          model: this.model,
        });
        estimatedUsage = {
          promptTokenCount: tokenCountResult.totalTokens,
          candidatesTokenCount: 0,
          totalTokenCount: tokenCountResult.totalTokens,
        };
      } catch {
        const contentStr = JSON.stringify(request.contents);
        const estimatedTokens = Math.ceil(contentStr.length / 4);
        estimatedUsage = {
          promptTokenCount: estimatedTokens,
          candidatesTokenCount: 0,
          totalTokenCount: estimatedTokens,
        };
      }

      // Log API error event
      const errorEvent = new ApiResponseEvent(
        this.model,
        durationMs,
        {
          prompt_id: userPromptId,
          contents: toContents(request.contents),
          generate_content_config: request.config,
        },
        {},
        this.config.getContentGeneratorConfig()?.authType,
        estimatedUsage,
        errorMessage,
      );
      logApiResponse(this.config, errorEvent);

      // eslint-disable-next-line no-console
      console.error('Bedrock API Streaming Error:', errorMessage);
      throw error;
    }
  }

  private async *streamGenerator(
    response: ConverseStreamCommandOutput,
  ): AsyncGenerator<GenerateContentResponse> {
    // Reset the accumulators for each new stream
    this.streamingToolCalls.clear();

    let inputTokens = 0;
    let outputTokens = 0;

    if (!response.stream) {
      return;
    }

    for await (const event of response.stream) {
      if (event.contentBlockStart) {
        // Start of a new content block (could be text or tool use)
        const toolUse = event.contentBlockStart.start?.toolUse;
        if (toolUse) {
          const index = event.contentBlockStart.contentBlockIndex ?? 0;
          this.streamingToolCalls.set(index, {
            id: toolUse.toolUseId,
            name: toolUse.name,
            input: '',
          });
        }
      } else if (event.contentBlockDelta) {
        const delta = event.contentBlockDelta.delta;
        const index = event.contentBlockDelta.contentBlockIndex ?? 0;

        if (delta?.text) {
          // Text delta
          yield this.createStreamResponse([{ text: delta.text }]);
        } else if (delta?.toolUse) {
          // Tool use input delta
          const accumulatedCall = this.streamingToolCalls.get(index);
          if (accumulatedCall) {
            accumulatedCall.input += delta.toolUse.input || '';
          }
        }
      } else if (event.contentBlockStop) {
        // Content block finished - emit tool calls if any
        const index = event.contentBlockStop.contentBlockIndex ?? 0;
        const accumulatedCall = this.streamingToolCalls.get(index);
        if (accumulatedCall?.name) {
          const args = safeJsonParse(accumulatedCall.input, {});
          const functionCallPart: Part = {
            functionCall: {
              id: accumulatedCall.id,
              name: accumulatedCall.name,
              args,
            },
          };
          yield this.createStreamResponse(
            [functionCallPart],
            FinishReason.STOP,
          );
          this.streamingToolCalls.delete(index);
        }
      } else if (event.messageStop) {
        // Message completed
        const stopReason = event.messageStop.stopReason;
        const finishReason = this.mapStopReason(stopReason);
        yield this.createStreamResponse([], finishReason, {
          promptTokenCount: inputTokens,
          candidatesTokenCount: outputTokens,
          totalTokenCount: inputTokens + outputTokens,
        });
      } else if (event.metadata) {
        // Usage metadata
        inputTokens = event.metadata.usage?.inputTokens || 0;
        outputTokens = event.metadata.usage?.outputTokens || 0;
      }
    }
  }

  private createStreamResponse(
    parts: Part[],
    finishReason: FinishReason = FinishReason.FINISH_REASON_UNSPECIFIED,
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    },
  ): GenerateContentResponse {
    const response = new GenerateContentResponse();
    response.candidates = [
      {
        content: {
          parts,
          role: 'model' as const,
        },
        finishReason,
        index: 0,
        safetyRatings: [],
      },
    ];
    response.modelVersion = this.model;
    response.promptFeedback = { safetyRatings: [] };

    if (usageMetadata) {
      response.usageMetadata = usageMetadata;
    }

    return response;
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Use tiktoken for token counting (rough estimate)
    const content = JSON.stringify(request.contents);
    let totalTokens = 0;

    try {
      const { get_encoding } = await import('tiktoken');
      const encoding = get_encoding('cl100k_base');
      totalTokens = encoding.encode(content).length;
      encoding.free();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        'Failed to load tiktoken, falling back to character approximation:',
        error,
      );
      totalTokens = Math.ceil(content.length / 4);
    }

    return {
      totalTokens,
    };
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // Bedrock embedding would require a different model (e.g., Amazon Titan Embeddings)
    // For now, throw an error indicating this isn't supported
    throw new Error(
      'Embedding is not yet implemented for Bedrock. Use a dedicated embedding model.',
    );
  }

  private buildSamplingParameters(request: GenerateContentParameters): {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  } {
    const configSamplingParams =
      this.config.getContentGeneratorConfig()?.samplingParams;

    return {
      maxTokens:
        configSamplingParams?.max_tokens !== undefined
          ? configSamplingParams.max_tokens
          : request.config?.maxOutputTokens !== undefined
            ? request.config.maxOutputTokens
            : 4096,

      temperature:
        configSamplingParams?.temperature !== undefined
          ? configSamplingParams.temperature
          : request.config?.temperature !== undefined
            ? request.config.temperature
            : 0.0,

      topP:
        configSamplingParams?.top_p !== undefined
          ? configSamplingParams.top_p
          : request.config?.topP !== undefined
            ? request.config.topP
            : 1.0,
    };
  }

  private convertToBedrockFormat(request: GenerateContentParameters): {
    messages: Message[];
    system?: string;
    toolConfig?: ToolConfiguration;
  } {
    const messages: Message[] = [];
    let system: string | undefined;

    // Handle system instruction
    if (request.config?.systemInstruction) {
      const systemInstruction = request.config.systemInstruction;

      if (Array.isArray(systemInstruction)) {
        system = systemInstruction
          .map((content) => {
            if (typeof content === 'string') return content;
            if ('parts' in content) {
              const contentObj = content as Content;
              return (
                contentObj.parts
                  ?.map((p: Part) =>
                    typeof p === 'string' ? p : 'text' in p ? p.text : '',
                  )
                  .join('\n') || ''
              );
            }
            return '';
          })
          .join('\n');
      } else if (typeof systemInstruction === 'string') {
        system = systemInstruction;
      } else if (
        typeof systemInstruction === 'object' &&
        'parts' in systemInstruction
      ) {
        const systemContent = systemInstruction;
        system =
          systemContent.parts
            ?.map((p: Part) =>
              typeof p === 'string' ? p : 'text' in p ? p.text : '',
            )
            .join('\n') || '';
      }
    }

    // Handle contents
    if (Array.isArray(request.contents)) {
      for (const content of request.contents) {
        if (typeof content === 'string') {
          messages.push({
            role: 'user',
            content: [{ text: content }],
          });
        } else if ('role' in content && 'parts' in content) {
          const contentBlocks: ContentBlock[] = [];
          const toolResults: ToolResultBlock[] = [];
          const functionCalls: FunctionCall[] = [];

          for (const part of content.parts || []) {
            if (typeof part === 'string') {
              contentBlocks.push({ text: part });
            } else if ('text' in part && part.text && !part.thought) {
              contentBlocks.push({ text: part.text });
            } else if ('functionCall' in part && part.functionCall) {
              functionCalls.push(part.functionCall);
            } else if ('functionResponse' in part && part.functionResponse) {
              const funcResponse = part.functionResponse as FunctionResponse;
              toolResults.push({
                toolUseId: funcResponse.id || '',
                content: [
                  {
                    text:
                      typeof funcResponse.response === 'string'
                        ? funcResponse.response
                        : JSON.stringify(funcResponse.response),
                  },
                ],
              });
            }
          }

          // Handle tool results (from user role containing function responses)
          if (toolResults.length > 0) {
            messages.push({
              role: 'user',
              content: toolResults.map((tr) => ({ toolResult: tr })),
            });
          }
          // Handle assistant messages with function calls
          else if (content.role === 'model' && functionCalls.length > 0) {
            const assistantContent: ContentBlock[] = [...contentBlocks];
            for (const fc of functionCalls) {
              const toolUseBlock: ToolUseBlock = {
                toolUseId: fc.id || `tool_${Date.now()}`,
                name: fc.name || '',
                input: (fc.args || {}) as DocumentType,
              };
              assistantContent.push({ toolUse: toolUseBlock });
            }
            messages.push({
              role: 'assistant',
              content: assistantContent,
            });
          }
          // Handle regular messages
          else if (contentBlocks.length > 0) {
            messages.push({
              role: content.role === 'model' ? 'assistant' : 'user',
              content: contentBlocks,
            });
          }
        }
      }
    } else if (request.contents) {
      if (typeof request.contents === 'string') {
        messages.push({
          role: 'user',
          content: [{ text: request.contents }],
        });
      } else if ('role' in request.contents && 'parts' in request.contents) {
        const content = request.contents;
        const text =
          content.parts
            ?.map((p: Part) =>
              typeof p === 'string' ? p : 'text' in p ? p.text : '',
            )
            .join('\n') || '';

        if (text) {
          messages.push({
            role: content.role === 'model' ? 'assistant' : 'user',
            content: [{ text }],
          });
        }
      }
    }

    // Convert tools if present
    let toolConfig: ToolConfiguration | undefined;
    if (request.config?.tools) {
      const tools = this.convertGeminiToolsToBedrock(request.config.tools);
      if (tools.length > 0) {
        toolConfig = {
          tools,
        };
      }
    }

    return { messages, system, toolConfig };
  }

  private convertGeminiToolsToBedrock(
    geminiTools: ToolListUnion,
  ): Array<{ toolSpec: ToolSpecification }> {
    const bedrockTools: Array<{ toolSpec: ToolSpecification }> = [];

    for (const tool of geminiTools) {
      let actualTool: Tool;

      // Handle CallableTool vs Tool
      if ('tool' in tool) {
        // This is a CallableTool - we can't await here, so skip callable tools
        // They would need to be resolved before calling this method
        continue;
      } else {
        actualTool = tool;
      }

      if (actualTool.functionDeclarations) {
        for (const func of actualTool.functionDeclarations) {
          if (func.name && func.description) {
            bedrockTools.push({
              toolSpec: {
                name: func.name,
                description: func.description,
                inputSchema: {
                  json: this.convertGeminiParametersToBedrock(
                    (func.parameters || {}) as Record<string, unknown>,
                  ) as DocumentType,
                },
              },
            });
          }
        }
      }
    }

    return bedrockTools;
  }

  private convertGeminiParametersToBedrock(
    parameters: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!parameters || typeof parameters !== 'object') {
      return { type: 'object', properties: {} };
    }

    const converted = JSON.parse(JSON.stringify(parameters));

    const convertTypes = (obj: unknown): unknown => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map(convertTypes);
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'type') {
          if (value === null || value === undefined) {
            result[key] = 'object';
          } else if (Array.isArray(value)) {
            const primaryType = value.find(
              (t) => typeof t === 'string' && t.toLowerCase() !== 'null',
            );
            result[key] = primaryType
              ? String(primaryType).toLowerCase()
              : 'object';
          } else if (typeof value === 'string') {
            result[key] = value.toLowerCase();
          } else {
            result[key] = value;
          }
        } else if (typeof value === 'object') {
          result[key] = convertTypes(value);
        } else {
          result[key] = value;
        }
      }

      if (result['properties'] && !result['type']) {
        result['type'] = 'object';
      }

      return result;
    };

    const result = convertTypes(converted) as Record<string, unknown>;

    if (
      !result['type'] ||
      result['type'] === null ||
      Array.isArray(result['type'])
    ) {
      result['type'] = 'object';
    }
    if (!result['properties']) {
      result['properties'] = {};
    }

    return result;
  }

  private convertToGeminiFormat(
    bedrockResponse: ConverseCommandOutput,
  ): GenerateContentResponse {
    const response = new GenerateContentResponse();
    const parts: Part[] = [];

    // Process output content
    if (bedrockResponse.output?.message?.content) {
      for (const block of bedrockResponse.output.message.content) {
        if (block.text) {
          parts.push({ text: block.text });
        } else if (block.toolUse) {
          const functionCallPart: Part = {
            functionCall: {
              id: block.toolUse.toolUseId,
              name: block.toolUse.name || '',
              args: (block.toolUse.input as Record<string, unknown>) || {},
            },
          };
          parts.push(functionCallPart);
        }
      }
    }

    response.candidates = [
      {
        content: {
          parts,
          role: 'model' as const,
        },
        finishReason: this.mapStopReason(bedrockResponse.stopReason),
        index: 0,
        safetyRatings: [],
      },
    ];

    response.modelVersion = this.model;
    response.promptFeedback = { safetyRatings: [] };

    // Add usage metadata
    if (bedrockResponse.usage) {
      response.usageMetadata = {
        promptTokenCount: bedrockResponse.usage.inputTokens || 0,
        candidatesTokenCount: bedrockResponse.usage.outputTokens || 0,
        totalTokenCount:
          (bedrockResponse.usage.inputTokens || 0) +
          (bedrockResponse.usage.outputTokens || 0),
      };
    }

    return response;
  }

  private mapStopReason(stopReason?: StopReason): FinishReason {
    if (!stopReason) return FinishReason.FINISH_REASON_UNSPECIFIED;

    switch (stopReason) {
      case 'end_turn':
        return FinishReason.STOP;
      case 'tool_use':
        return FinishReason.STOP;
      case 'max_tokens':
        return FinishReason.MAX_TOKENS;
      case 'stop_sequence':
        return FinishReason.STOP;
      case 'content_filtered':
        return FinishReason.SAFETY;
      case 'guardrail_intervened':
        return FinishReason.SAFETY;
      default:
        return FinishReason.FINISH_REASON_UNSPECIFIED;
    }
  }
}
