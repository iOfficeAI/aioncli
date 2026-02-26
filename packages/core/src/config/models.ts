/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const PREVIEW_GEMINI_MODEL = 'gemini-3-pro-preview';
export const PREVIEW_GEMINI_3_1_MODEL = 'gemini-3.1-pro-preview';
export const PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL =
  'gemini-3.1-pro-preview-customtools';
export const PREVIEW_GEMINI_FLASH_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

export const VALID_GEMINI_MODELS = new Set([
  PREVIEW_GEMINI_MODEL,
  PREVIEW_GEMINI_3_1_MODEL,
  PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
]);

export const PREVIEW_GEMINI_MODEL_AUTO = 'auto-gemini-3';
export const DEFAULT_GEMINI_MODEL_AUTO = 'auto-gemini-2.5';

// Model aliases for user convenience.
export const GEMINI_MODEL_ALIAS_AUTO = 'auto';
export const GEMINI_MODEL_ALIAS_PRO = 'pro';
export const GEMINI_MODEL_ALIAS_FLASH = 'flash';
export const GEMINI_MODEL_ALIAS_FLASH_LITE = 'flash-lite';

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

// Cap the thinking at 8192 to prevent run-away thinking loops.
export const DEFAULT_THINKING_MODE = 8192;

/**
 * Resolves the requested model alias (e.g., 'auto-gemini-3', 'pro', 'flash', 'flash-lite')
 * to a concrete model name.
 *
 * @param requestedModel The model alias or concrete model name requested by the user.
 * @param useGemini3_1 Whether to use Gemini 3.1 Pro Preview for auto/pro aliases.
 * @returns The resolved concrete model name.
 */
export function resolveModel(
  requestedModel: string,
  useGemini3_1: boolean = false,
  useCustomToolModel: boolean = false,
): string {
  switch (requestedModel) {
    case PREVIEW_GEMINI_MODEL:
    case PREVIEW_GEMINI_MODEL_AUTO:
    case GEMINI_MODEL_ALIAS_AUTO:
    case GEMINI_MODEL_ALIAS_PRO: {
      if (useGemini3_1) {
        return useCustomToolModel
          ? PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL
          : PREVIEW_GEMINI_3_1_MODEL;
      }
      return PREVIEW_GEMINI_MODEL;
    }
    case DEFAULT_GEMINI_MODEL_AUTO: {
      return DEFAULT_GEMINI_MODEL;
    }
    case GEMINI_MODEL_ALIAS_FLASH: {
      return PREVIEW_GEMINI_FLASH_MODEL;
    }
    case GEMINI_MODEL_ALIAS_FLASH_LITE: {
      return DEFAULT_GEMINI_FLASH_LITE_MODEL;
    }
    default: {
      return requestedModel;
    }
  }
}

/**
 * Resolves the appropriate model based on the classifier's decision.
 *
 * @param requestedModel The current requested model (e.g. auto-gemini-2.5).
 * @param modelAlias The alias selected by the classifier ('flash' or 'pro').
 * @returns The resolved concrete model name.
 */
export function resolveClassifierModel(
  requestedModel: string,
  modelAlias: string,
  useGemini3_1: boolean = false,
  useCustomToolModel: boolean = false,
): string {
  if (modelAlias === GEMINI_MODEL_ALIAS_FLASH) {
    if (
      requestedModel === DEFAULT_GEMINI_MODEL_AUTO ||
      requestedModel === DEFAULT_GEMINI_MODEL
    ) {
      return DEFAULT_GEMINI_FLASH_MODEL;
    }
    if (
      requestedModel === PREVIEW_GEMINI_MODEL_AUTO ||
      requestedModel === PREVIEW_GEMINI_MODEL
    ) {
      return PREVIEW_GEMINI_FLASH_MODEL;
    }
    return resolveModel(GEMINI_MODEL_ALIAS_FLASH);
  }
  return resolveModel(requestedModel, useGemini3_1, useCustomToolModel);
}
export function getDisplayString(model: string) {
  switch (model) {
    case PREVIEW_GEMINI_MODEL_AUTO:
      return 'Auto (Gemini 3)';
    case DEFAULT_GEMINI_MODEL_AUTO:
      return 'Auto (Gemini 2.5)';
    case GEMINI_MODEL_ALIAS_PRO:
      return PREVIEW_GEMINI_MODEL;
    case GEMINI_MODEL_ALIAS_FLASH:
      return PREVIEW_GEMINI_FLASH_MODEL;
    case PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL:
      return PREVIEW_GEMINI_3_1_MODEL;
    default:
      return model;
  }
}

/**
 * Checks if the model is a preview model.
 *
 * @param model The model name to check.
 * @returns True if the model is a preview model.
 */
export function isPreviewModel(model: string): boolean {
  return (
    model === PREVIEW_GEMINI_MODEL ||
    model === PREVIEW_GEMINI_3_1_MODEL ||
    model === PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL ||
    model === PREVIEW_GEMINI_FLASH_MODEL ||
    model === PREVIEW_GEMINI_MODEL_AUTO
  );
}

/**
 * Checks if the model is a Pro model.
 *
 * @param model The model name to check.
 * @returns True if the model is a Pro model.
 */
export function isProModel(model: string): boolean {
  return model.toLowerCase().includes('pro');
}

/**
 * Checks if the model is a Gemini 3 model.
 *
 * @param model The model name to check.
 * @returns True if the model is a Gemini 3 model.
 */
export function isGemini3Model(model: string): boolean {
  const resolved = resolveModel(model);
  return /^gemini-3(\.|-|$)/.test(resolved);
}

/**
 * Checks if the model is a Gemini 2.x model.
 *
 * @param model The model name to check.
 * @returns True if the model is a Gemini-2.x model.
 */
export function isGemini2Model(model: string): boolean {
  return /^gemini-2(\.|$)/.test(model);
}

/**
 * Checks if the model is an auto model.
 *
 * @param model The model name to check.
 * @returns True if the model is an auto model.
 */
export function isAutoModel(model: string): boolean {
  return (
    model === GEMINI_MODEL_ALIAS_AUTO ||
    model === PREVIEW_GEMINI_MODEL_AUTO ||
    model === DEFAULT_GEMINI_MODEL_AUTO
  );
}

/**
 * Checks if the model supports multimodal function responses (multimodal data nested within function response).
 * This is supported in Gemini 3.
 *
 * @param model The model name to check.
 * @returns True if the model supports multimodal function responses.
 */
export function supportsMultimodalFunctionResponse(model: string): boolean {
  return model.startsWith('gemini-3-');
}

// ===== AWS Bedrock Models =====

/**
 * Default Bedrock model - Claude Sonnet 4.5
 */
export const DEFAULT_BEDROCK_MODEL =
  'anthropic.claude-sonnet-4-5-20250929-v1:0';

/**
 * Bedrock model availability by region.
 * Based on AWS Bedrock documentation (as of January 2025).
 * This mapping needs periodic updates as AWS expands model availability.
 */
export const BEDROCK_MODEL_REGIONS: Record<string, string[]> = {
  // Claude 4.5 models
  'anthropic.claude-opus-4-5-20251101-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-1',
    'ap-northeast-1',
  ],
  'anthropic.claude-sonnet-4-5-20250929-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-1',
    'ap-northeast-1',
  ],
  'anthropic.claude-haiku-4-5-20251001-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-1',
    'ap-northeast-1',
  ],

  // Claude 4 models
  'anthropic.claude-sonnet-4-20250514-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'ap-southeast-1',
  ],

  // Claude 3.7 models
  'anthropic.claude-3-7-sonnet-20250219-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'ap-southeast-1',
  ],

  // Claude 3.5 models
  'anthropic.claude-3-5-sonnet-20241022-v2:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-1',
    'ap-northeast-1',
  ],
  'anthropic.claude-3-5-sonnet-20240620-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'ap-southeast-1',
  ],

  // Claude 3 models
  'anthropic.claude-3-opus-20240229-v1:0': ['us-east-1', 'us-west-2'],
  'anthropic.claude-3-sonnet-20240229-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'ap-southeast-1',
  ],
  'anthropic.claude-3-sonnet-20240229-v1:0:28k': [
    'us-east-1',
    'us-west-2',
    'ap-southeast-1',
  ],
  'anthropic.claude-3-sonnet-20240229-v1:0:200k': [
    'us-east-1',
    'us-west-2',
    'ap-southeast-1',
  ],
  'anthropic.claude-3-haiku-20240307-v1:0': [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'ap-southeast-1',
    'ap-northeast-1',
  ],
};

/**
 * Validate if a Bedrock model is available in the specified region.
 *
 * @param model Bedrock model ID
 * @param region AWS region
 * @returns Validation result with suggestions if not available
 */
export function validateBedrockModelRegion(
  model: string,
  region: string,
): { valid: boolean; message?: string; suggestions?: string[] } {
  const modelRegions = BEDROCK_MODEL_REGIONS[model];

  if (!modelRegions) {
    // Unknown model - allow but warn
    return {
      valid: true,
      message:
        `Warning: Model ${model} not in known model list. ` +
        `It may work if it's a newly released model.`,
    };
  }

  if (!modelRegions.includes(region)) {
    // Model not available in this region
    return {
      valid: false,
      message:
        `Model ${model} is not available in region ${region}.\n\n` +
        `Available regions for this model:\n` +
        modelRegions.map((r) => `  - ${r}`).join('\n') +
        `\n\nSolutions:\n` +
        `  1. Switch to a supported region:\n` +
        `     export AWS_REGION="${modelRegions[0]}"\n\n` +
        `  2. List models available in ${region}:\n` +
        `     aws bedrock list-foundation-models --region ${region} --by-provider Anthropic`,
      suggestions: modelRegions,
    };
  }

  return { valid: true };
}

/**
 * Check if a model is a Bedrock model.
 */
export function isBedrockModel(model: string): boolean {
  return (
    model.startsWith('anthropic.') ||
    model.startsWith('amazon.') ||
    model.startsWith('meta.') ||
    model.startsWith('mistral.')
  );
}

/**
 * Checks if the given model is considered active based on the current configuration.
 *
 * @param model The model name to check.
 * @param useGemini3_1 Whether Gemini 3.1 Pro Preview is enabled.
 * @returns True if the model is active.
 */
export function isActiveModel(
  model: string,
  useGemini3_1: boolean = false,
  useCustomToolModel: boolean = false,
): boolean {
  if (!VALID_GEMINI_MODELS.has(model)) {
    return false;
  }
  if (useGemini3_1) {
    if (model === PREVIEW_GEMINI_MODEL) {
      return false;
    }
    if (useCustomToolModel) {
      return model !== PREVIEW_GEMINI_3_1_MODEL;
    } else {
      return model !== PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL;
    }
  } else {
    return (
      model !== PREVIEW_GEMINI_3_1_MODEL &&
      model !== PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL
    );
  }
}
