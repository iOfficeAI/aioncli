/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Part,
  Content,
  FunctionCall,
  FunctionResponse,
} from '@google/genai';
import { GenerateContentResponse, FinishReason } from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import Anthropic from '@anthropic-ai/sdk';
import { toContents } from '../code_assist/converter.js';
import type { Config } from '../config/config.js';

export class AnthropicContentGenerator implements ContentGenerator {
  protected client: Anthropic;
  private model: string;
  private config: Config;

  constructor(apiKey: string, model: string, config: Config) {
    this.model = model;
    this.config = config;
    let baseURL = process.env['ANTHROPIC_BASE_URL'] || 'https://api.anthropic.com';
    // Remove trailing /v1 if present - Anthropic SDK adds its own path
    if (baseURL.endsWith('/v1')) {
      baseURL = baseURL.slice(0, -3);
    }

    // Configure timeout settings
    const timeoutConfig = {
      timeout: 120000,
      maxRetries: 3,
    };

    // Allow config to override timeout settings
    const contentGeneratorConfig = this.config.getContentGeneratorConfig();
    if (contentGeneratorConfig?.timeout) {
      timeoutConfig.timeout = contentGeneratorConfig.timeout;
    }
    if (contentGeneratorConfig?.maxRetries !== undefined) {
      timeoutConfig.maxRetries = contentGeneratorConfig.maxRetries;
    }

    this.client = new Anthropic({
      apiKey,
      baseURL,
      timeout: timeoutConfig.timeout,
      maxRetries: timeoutConfig.maxRetries,
    });
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const { systemMessage, messages } = this.convertToAnthropicFormat(request);

    try {
      const samplingParams = this.buildSamplingParameters(request);

      const createParams: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.model,
        max_tokens: samplingParams.max_tokens || 4096,
        messages,
        ...(systemMessage ? { system: systemMessage } : {}),
        ...(samplingParams.temperature !== undefined ? { temperature: samplingParams.temperature } : {}),
        ...(samplingParams.top_p !== undefined ? { top_p: samplingParams.top_p } : {}),
      };

      // Convert tools if present
      if (request.config?.tools) {
        createParams.tools = await this.convertGeminiToolsToAnthropic(request.config.tools);
      }

      const completion = await this.client.messages.create(createParams);
      return this.convertToGeminiFormat(completion);
    } catch (error) {
      console.error('Anthropic API Error:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // For now, use non-streaming API and wrap in generator
    // This ensures compatibility while we can improve streaming later
    const self = this;
    async function* streamWrapper(): AsyncGenerator<GenerateContentResponse> {
      const response = await self.generateContent(request, userPromptId);
      yield response;
    }
    return streamWrapper();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Anthropic doesn't have a public token counting API
    // Use character approximation
    const content = JSON.stringify(request.contents);
    const totalTokens = Math.ceil(content.length / 4);

    return { totalTokens };
  }

  async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error('Anthropic does not support embeddings');
  }

  private convertToAnthropicFormat(request: GenerateContentParameters): {
    systemMessage: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    let systemMessage: string | undefined;
    const messages: Anthropic.MessageParam[] = [];

    // Handle system instruction
    if (request.config?.systemInstruction) {
      systemMessage = this.extractSystemInstruction(request.config.systemInstruction);
    }

    // Handle contents
    if (Array.isArray(request.contents)) {
      for (const content of request.contents) {
        if (typeof content === 'string') {
          messages.push({ role: 'user', content });
        } else if ('role' in content && 'parts' in content) {
          const { role, contentBlocks } = this.processContentParts(content);
          if (contentBlocks.length > 0) {
            messages.push({ role, content: contentBlocks });
          }
        }
      }
    }

    // Ensure messages alternate and start with user
    return { systemMessage, messages: this.ensureAlternatingMessages(messages) };
  }

  private extractSystemInstruction(systemInstruction: unknown): string {
    if (typeof systemInstruction === 'string') {
      return systemInstruction;
    }
    if (Array.isArray(systemInstruction)) {
      return systemInstruction
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item === 'object' && item && 'parts' in item) {
            const contentObj = item as Content;
            return contentObj.parts?.map((p) => ('text' in p ? p.text : '')).join('\n') || '';
          }
          return '';
        })
        .join('\n');
    }
    if (typeof systemInstruction === 'object' && systemInstruction && 'parts' in systemInstruction) {
      const contentObj = systemInstruction as Content;
      return contentObj.parts?.map((p) => ('text' in p ? p.text : '')).join('\n') || '';
    }
    return '';
  }

  private processContentParts(content: Content): {
    role: 'user' | 'assistant';
    contentBlocks: Anthropic.ContentBlockParam[];
  } {
    const role = content.role === 'model' ? 'assistant' : 'user';
    const contentBlocks: Anthropic.ContentBlockParam[] = [];
    const functionResponses: FunctionResponse[] = [];

    for (const part of content.parts || []) {
      if (typeof part === 'string') {
        contentBlocks.push({ type: 'text', text: part });
      } else if ('text' in part && part.text) {
        contentBlocks.push({ type: 'text', text: part.text });
      } else if ('functionCall' in part && part.functionCall) {
        // Convert to tool_use block
        contentBlocks.push({
          type: 'tool_use',
          id: part.functionCall.id || `call_${Date.now()}`,
          name: part.functionCall.name || '',
          input: part.functionCall.args || {},
        });
      } else if ('functionResponse' in part && part.functionResponse) {
        functionResponses.push(part.functionResponse);
      }
    }

    // Handle function responses as tool_result
    for (const funcResponse of functionResponses) {
      contentBlocks.push({
        type: 'tool_result',
        tool_use_id: funcResponse.id || '',
        content: typeof funcResponse.response === 'string' ? funcResponse.response : JSON.stringify(funcResponse.response),
      });
    }

    return { role, contentBlocks };
  }

  private ensureAlternatingMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (messages.length === 0) return [];

    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      const lastRole = result.length > 0 ? result[result.length - 1].role : null;

      if (lastRole === msg.role) {
        // Merge with previous message
        const lastMsg = result[result.length - 1];
        const lastContent = lastMsg.content;
        const newContent = msg.content;

        if (typeof lastContent === 'string' && typeof newContent === 'string') {
          lastMsg.content = lastContent + '\n' + newContent;
        } else {
          const lastArray = typeof lastContent === 'string' ? [{ type: 'text' as const, text: lastContent }] : (lastContent as Anthropic.ContentBlockParam[]);
          const newArray = typeof newContent === 'string' ? [{ type: 'text' as const, text: newContent }] : (newContent as Anthropic.ContentBlockParam[]);
          lastMsg.content = [...lastArray, ...newArray];
        }
      } else {
        result.push({ ...msg });
      }
    }

    // Ensure first message is from user
    if (result.length > 0 && result[0].role !== 'user') {
      result.unshift({ role: 'user', content: 'Continue.' });
    }

    return result;
  }

  private async convertGeminiToolsToAnthropic(geminiTools: unknown): Promise<Anthropic.Tool[]> {
    const anthropicTools: Anthropic.Tool[] = [];

    if (!Array.isArray(geminiTools)) return anthropicTools;

    for (const tool of geminiTools) {
      let actualTool: unknown;

      if ('tool' in (tool as object)) {
        actualTool = await ((tool as { tool: () => Promise<unknown> }).tool)();
      } else {
        actualTool = tool;
      }

      const toolObj = actualTool as { functionDeclarations?: Array<{ name?: string; description?: string; parameters?: unknown }> };
      if (toolObj.functionDeclarations) {
        for (const func of toolObj.functionDeclarations) {
          if (func.name) {
            anthropicTools.push({
              name: func.name,
              description: func.description || '',
              input_schema: (func.parameters as Anthropic.Tool.InputSchema) || { type: 'object', properties: {} },
            });
          }
        }
      }
    }

    return anthropicTools;
  }

  private convertToGeminiFormat(anthropicResponse: Anthropic.Message): GenerateContentResponse {
    const response = new GenerateContentResponse();
    const parts: Part[] = [];

    for (const block of anthropicResponse.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_use') {
        parts.push({
          functionCall: {
            id: block.id,
            name: block.name,
            args: block.input as Record<string, unknown>,
          } as FunctionCall,
        });
      }
    }

    response.responseId = anthropicResponse.id;
    response.createTime = new Date().getTime().toString();

    response.candidates = [
      {
        content: { parts, role: 'model' as const },
        finishReason: this.mapStopReason(anthropicResponse.stop_reason),
        index: 0,
        safetyRatings: [],
      },
    ];

    response.modelVersion = this.model;
    response.promptFeedback = { safetyRatings: [] };

    response.usageMetadata = {
      promptTokenCount: anthropicResponse.usage.input_tokens,
      candidatesTokenCount: anthropicResponse.usage.output_tokens,
      totalTokenCount: anthropicResponse.usage.input_tokens + anthropicResponse.usage.output_tokens,
    };

    return response;
  }

  private mapStopReason(stopReason: string | null): FinishReason {
    switch (stopReason) {
      case 'end_turn':
        return FinishReason.STOP;
      case 'max_tokens':
        return FinishReason.MAX_TOKENS;
      case 'stop_sequence':
        return FinishReason.STOP;
      case 'tool_use':
        return FinishReason.STOP;
      default:
        return FinishReason.STOP;
    }
  }

  private buildSamplingParameters(request: GenerateContentParameters): {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
  } {
    const configSamplingParams = this.config.getContentGeneratorConfig()?.samplingParams;

    return {
      temperature: configSamplingParams?.temperature !== undefined ? configSamplingParams.temperature : request.config?.temperature,
      max_tokens: configSamplingParams?.max_tokens !== undefined ? configSamplingParams.max_tokens : request.config?.maxOutputTokens,
      top_p: configSamplingParams?.top_p !== undefined ? configSamplingParams.top_p : request.config?.topP,
    };
  }
}
