/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Content,
  GenerateContentConfig,
  Part,
  EmbedContentParameters,
  GenerateContentResponse,
  Tool,
  FunctionDeclaration,
  Schema,
} from '@google/genai';
import type { Config } from '../config/config.js';
import type { ContentGenerator } from './contentGenerator.js';
import { AuthType } from './contentGenerator.js';
import { getResponseText } from '../utils/partUtils.js';
import { reportError } from '../utils/errorReporting.js';
import { getErrorMessage } from '../utils/errors.js';
import { logMalformedJsonResponse } from '../telemetry/loggers.js';
import { MalformedJsonResponseEvent } from '../telemetry/types.js';
import { retryWithBackoff } from '../utils/retry.js';
import { getFunctionCalls } from '../utils/generateContentResponseUtilities.js';

const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Options for the generateJson utility function.
 */
export interface GenerateJsonOptions {
  /** The input prompt or history. */
  contents: Content[];
  /** The required JSON schema for the output. */
  schema: Record<string, unknown>;
  /** The specific model to use for this task. */
  model: string;
  /**
   * Task-specific system instructions.
   * If omitted, no system instruction is sent.
   */
  systemInstruction?: string | Part | Part[] | Content;
  /**
   * Overrides for generation configuration (e.g., temperature).
   */
  config?: Omit<
    GenerateContentConfig,
    | 'systemInstruction'
    | 'responseJsonSchema'
    | 'responseMimeType'
    | 'tools'
    | 'abortSignal'
  >;
  /** Signal for cancellation. */
  abortSignal: AbortSignal;
  /**
   * A unique ID for the prompt, used for logging/telemetry correlation.
   */
  promptId: string;
  /**
   * The maximum number of attempts for the request.
   */
  maxAttempts?: number;
}

/**
 * A client dedicated to stateless, utility-focused LLM calls.
 */
export class BaseLlmClient {
  // Default configuration for utility tasks
  private readonly defaultUtilityConfig: GenerateContentConfig = {
    temperature: 0,
    topP: 1,
  };

  constructor(
    private readonly contentGenerator: ContentGenerator,
    private readonly config: Config,
  ) {}

  async generateJson(
    options: GenerateJsonOptions,
  ): Promise<Record<string, unknown>> {
    const {
      contents,
      schema,
      model,
      abortSignal,
      systemInstruction,
      promptId,
      maxAttempts,
    } = options;

    // Check if using OpenAI authType
    const authType = this.config.getContentGeneratorConfig()?.authType;
    const isOpenAI = authType === AuthType.USE_OPENAI;

    if (isOpenAI) {
      return this.generateJsonForOpenAI(options);
    }

    // Standard Gemini implementation
    const requestConfig: GenerateContentConfig = {
      abortSignal,
      ...this.defaultUtilityConfig,
      ...options.config,
      ...(systemInstruction && { systemInstruction }),
      responseJsonSchema: schema,
      responseMimeType: 'application/json',
    };

    try {
      const apiCall = () =>
        this.contentGenerator.generateContent(
          {
            model,
            config: requestConfig,
            contents,
          },
          promptId,
        );

      const shouldRetryOnContent = (response: GenerateContentResponse) => {
        const text = getResponseText(response)?.trim();
        if (!text) {
          return true; // Retry on empty response
        }
        try {
          JSON.parse(this.cleanJsonResponse(text, model));
          return false;
        } catch (_e) {
          return true;
        }
      };

      const result = await retryWithBackoff(apiCall, {
        shouldRetryOnContent,
        maxAttempts: maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      });

      // If we are here, the content is valid (not empty and parsable).
      return JSON.parse(
        this.cleanJsonResponse(getResponseText(result)!.trim(), model),
      );
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }

      // Check if the error is from exhausting retries, and report accordingly.
      if (
        error instanceof Error &&
        error.message.includes('Retry attempts exhausted')
      ) {
        await reportError(
          error,
          'API returned invalid content (empty or unparsable JSON) after all retries.',
          contents,
          'generateJson-invalid-content',
        );
      } else {
        await reportError(
          error,
          'Error generating JSON content via API.',
          contents,
          'generateJson-api',
        );
      }

      throw new Error(
        `Failed to generate JSON content: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * OpenAI-specific implementation using function calling instead of responseJsonSchema
   */
  private async generateJsonForOpenAI(
    options: GenerateJsonOptions,
  ): Promise<Record<string, unknown>> {
    const {
      contents,
      schema,
      model,
      abortSignal,
      systemInstruction,
      promptId,
      maxAttempts,
    } = options;

    try {
      // Create function declaration for OpenAI-style response
      const functionDeclaration: FunctionDeclaration = {
        name: 'respond_in_schema',
        description: 'Provide the response in provided schema',
        parameters: schema as Schema,
      };

      const tools: Tool[] = [
        {
          functionDeclarations: [functionDeclaration],
        },
      ];

      const requestConfig: GenerateContentConfig = {
        abortSignal,
        ...this.defaultUtilityConfig,
        ...options.config,
        ...(systemInstruction && { systemInstruction }),
        tools,
      };

      const apiCall = () =>
        this.contentGenerator.generateContent(
          {
            model,
            config: requestConfig,
            contents,
          },
          promptId,
        );

      const result = await retryWithBackoff(apiCall, {
        maxAttempts: maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      });

      // Try to extract function call arguments
      const functionCalls = getFunctionCalls(result);

      if (functionCalls && functionCalls.length > 0) {
        const functionCall = functionCalls.find(
          (call) => call.name === 'respond_in_schema',
        );
        if (functionCall && functionCall.args) {
          return functionCall.args;
        }
      }

      // Fallback: try to parse response text as JSON
      let text = getResponseText(result);

      if (!text) {
        const error = new Error(
          'API returned an empty response for generateJson (OpenAI).',
        );
        await reportError(
          error,
          'Error in generateJson (OpenAI): API returned an empty response.',
          contents,
          'generateJson-openai-empty-response',
        );
        throw error;
      }

      // Handle markdown wrapped JSON
      text = this.cleanJsonResponse(text, model);

      try {
        return JSON.parse(text);
      } catch (parseError) {
        await reportError(
          parseError,
          'Failed to parse JSON response from generateJson (OpenAI).',
          {
            responseTextFailedToParse: text,
            originalRequestContents: contents,
          },
          'generateJson-openai-parse',
        );
        throw new Error(
          `Failed to parse API response as JSON: ${getErrorMessage(
            parseError,
          )}`,
        );
      }
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }

      await reportError(
        error,
        'Error generating JSON content via OpenAI API.',
        contents,
        'generateJson-openai-api',
      );
      throw new Error(
        `Failed to generate JSON content: ${getErrorMessage(error)}`,
      );
    }
  }

  async generateEmbedding(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }
    const embedModelParams: EmbedContentParameters = {
      model: this.config.getEmbeddingModel(),
      contents: texts,
    };

    const embedContentResponse =
      await this.contentGenerator.embedContent(embedModelParams);
    if (
      !embedContentResponse.embeddings ||
      embedContentResponse.embeddings.length === 0
    ) {
      throw new Error('No embeddings found in API response.');
    }

    if (embedContentResponse.embeddings.length !== texts.length) {
      throw new Error(
        `API returned a mismatched number of embeddings. Expected ${texts.length}, got ${embedContentResponse.embeddings.length}.`,
      );
    }

    return embedContentResponse.embeddings.map((embedding, index) => {
      const values = embedding.values;
      if (!values || values.length === 0) {
        throw new Error(
          `API returned an empty embedding for input text at index ${index}: "${texts[index]}"`,
        );
      }
      return values;
    });
  }

  private cleanJsonResponse(text: string, model: string): string {
    const prefix = '```json';
    const suffix = '```';
    if (text.startsWith(prefix) && text.endsWith(suffix)) {
      logMalformedJsonResponse(
        this.config,
        new MalformedJsonResponseEvent(model),
      );
      return text.substring(prefix.length, text.length - suffix.length).trim();
    }
    return text;
  }
}
