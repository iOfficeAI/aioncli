/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;

export function tokenLimit(model: Model): TokenCount {
  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/gemini-api/docs/models
  switch (model) {
    case 'gemini-1.5-pro':
      return 2_097_152;
    case 'gemini-1.5-flash':
    case 'gemini-2.5-pro-preview-05-06':
    case 'gemini-2.5-pro-preview-06-05':
    case 'gemini-2.5-pro':
    case 'gemini-2.5-flash-preview-05-20':
    case 'gemini-2.5-flash':
    case 'gemini-2.5-flash-lite':
    case 'gemini-2.0-flash':
      return 1_048_576;
    case 'gemini-2.0-flash-preview-image-generation':
      return 32_000;
    
    // OpenAI GPT-4 models
    case 'gpt-4':
    case 'gpt-4-0613':
    case 'gpt-4-0314':
      return 8_192;
    case 'gpt-4-32k':
    case 'gpt-4-32k-0613':
    case 'gpt-4-32k-0314':
      return 32_768;
    case 'gpt-4-turbo':
    case 'gpt-4-turbo-2024-04-09':
    case 'gpt-4-turbo-preview':
    case 'gpt-4-0125-preview':
    case 'gpt-4-1106-preview':
    case 'gpt-4-1106-vision-preview':
    case 'gpt-4-vision-preview':
      return 128_000;
    case 'gpt-4o':
    case 'gpt-4o-2024-05-13':
    case 'gpt-4o-2024-08-06':
    case 'gpt-4o-2024-11-20':
    case 'gpt-4o-mini':
    case 'gpt-4o-mini-2024-07-18':
      return 128_000;
    
    // OpenAI GPT-3.5 models
    case 'gpt-3.5-turbo':
    case 'gpt-3.5-turbo-0125':
    case 'gpt-3.5-turbo-1106':
    case 'gpt-3.5-turbo-0613':
    case 'gpt-3.5-turbo-0301':
    case 'gpt-3.5-turbo-16k':
    case 'gpt-3.5-turbo-16k-0613':
      return 16_385;
    
    // OpenAI o1 models
    case 'o1-preview':
    case 'o1-preview-2024-09-12':
    case 'o1-mini':
    case 'o1-mini-2024-09-12':
      return 128_000;
    
    // OpenAI oss
    case 'gpt-oss-120b':
    case 'gpt-oss-20b':
      return 131_000;
    
    // Claude models (for Anthropic API compatibility)
    case 'claude-opus-4-1-20250805':
    case 'claude-opus-4-20250514':
    case 'claude-sonnet-4-20250514':
    case 'claude-3-7-sonnet-20250219':
    case 'claude-3-5-haiku-20241022':
      return 200_000;

    // OpenRouter
    case 'qwen/qwen3-coder:free':
    case 'qwen/qwen3-coder':
    case 'qwen/qwen3-235b-a22b-thinking-2507':
    case 'qwen/qwen3-235b-a22b-2507':
      return 262_144;
    case 'openai/gpt-oss-20b:free':
    case 'openai/gpt-oss-120b:free':
    case 'openai/gpt-oss-20b':
      return 131_000;
    case 'moonshotai/kimi-k2:free':
      return 32_768;
    case 'moonshotai/kimi-k2':
      return 63_000;
    
    // Modelscope
    case 'Qwen3-Coder-480B-A35B-Instruct':
      return 262_144;
    case 'moonshotai/Kimi-K2-Instruct':
      return 128_000;

    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}
