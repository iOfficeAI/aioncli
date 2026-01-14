/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { AuthType } from '../core/contentGenerator.js';
import { openBrowserSecurely } from '../utils/secure-browser-launcher.js';
import { debugLogger } from '../utils/debugLogger.js';
import { getErrorMessage } from '../utils/errors.js';
import type { FallbackIntent, FallbackRecommendation } from './types.js';
import { classifyFailureKind } from '../availability/errorClassification.js';
import {
  buildFallbackPolicyContext,
  resolvePolicyChain,
  resolvePolicyAction,
  applyAvailabilityTransition,
} from '../availability/policyHelpers.js';

const UPGRADE_URL_PAGE = 'https://goo.gle/set-up-gemini-code-assist';

// [PATCH:API_KEY_ROTATION_START]
// First try to rotate API key for GEMINI/OPENAI API key modes
// 优先尝试轮换 GEMINI/OPENAI API key
/**
 * Tries to rotate API key for GEMINI/OPENAI API key authentication modes.
 * Returns true if key was rotated successfully, false otherwise.
 *
 * This function checks for a new API key in environment variables and
 * refreshes the authentication if a different key is found.
 */
async function tryRotateApiKey(
  config: Config,
  authType?: string,
): Promise<boolean> {
  // Support both GEMINI and OPENAI API key modes
  let envKey: string | undefined;
  let authTypeEnum: AuthType | undefined;

  if (authType === AuthType.USE_GEMINI) {
    envKey = 'GEMINI_API_KEY';
    authTypeEnum = AuthType.USE_GEMINI;
  } else if (authType === AuthType.USE_OPENAI) {
    envKey = 'OPENAI_API_KEY';
    authTypeEnum = AuthType.USE_OPENAI;
  } else {
    return false; // Not a supported API key mode
  }

  const newApiKey = process.env[envKey]?.trim();
  if (!newApiKey) {
    return false;
  }

  const currentConfig = config.getContentGeneratorConfig();
  if (!currentConfig) {
    return false;
  }

  if (currentConfig.apiKey === newApiKey) {
    return false; // Same key, no rotation needed
  }

  try {
    // Use refreshAuth to reload the entire auth configuration with the new API key
    await config.refreshAuth(authTypeEnum);
    return true;
  } catch (_error) {
    return false;
  }
}
// [PATCH:API_KEY_ROTATION_END]

export async function handleFallback(
  config: Config,
  failedModel: string,
  authType?: string,
  error?: unknown,
): Promise<string | boolean | null> {
  // [PATCH:API_KEY_ROTATION_START]
  // First try to rotate API key for GEMINI/OPENAI API key modes
  // 优先尝试轮换 GEMINI/OPENAI API key
  if (authType === AuthType.USE_GEMINI || authType === AuthType.USE_OPENAI) {
    const rotated = await tryRotateApiKey(config, authType);
    if (rotated) {
      return true;
    }
    return null;
  }
  // [PATCH:API_KEY_ROTATION_END]

  if (authType !== AuthType.LOGIN_WITH_GOOGLE) {
    return null;
  }

  // Resolve fallback policy chain and candidates.
  // 解析回退策略链与候选模型。
  const chain = resolvePolicyChain(config);
  const { failedPolicy, candidates } = buildFallbackPolicyContext(
    chain,
    failedModel,
  );

  // Classify failure kind for availability policy decisions.
  // 识别失败类型，用于可用性/策略决策。
  const failureKind = classifyFailureKind(error);
  const availability = config.getModelAvailabilityService();
  // Build availability context for transitions.
  // 构建可用性上下文以应用状态迁移。
  const getAvailabilityContext = () => {
    if (!failedPolicy) return undefined;
    return { service: availability, policy: failedPolicy };
  };

  // Pick a fallback model based on availability policies.
  // 基于可用性策略选择回退模型。
  let fallbackModel: string;
  if (!candidates.length) {
    fallbackModel = failedModel;
  } else {
    // Select the first available model from candidates.
    // 从候选模型中选择第一个可用模型。
    const selection = availability.selectFirstAvailable(
      candidates.map((policy) => policy.model),
    );

    const lastResortPolicy = candidates.find((policy) => policy.isLastResort);
    const selectedFallbackModel =
      selection.selectedModel ?? lastResortPolicy?.model;
    const selectedPolicy = candidates.find(
      (policy) => policy.model === selectedFallbackModel,
    );

    // Abort if the selected model is invalid or unchanged.
    // 若选择无效或未发生变更则终止回退。
    if (
      !selectedFallbackModel ||
      selectedFallbackModel === failedModel ||
      !selectedPolicy
    ) {
      return null;
    }

    fallbackModel = selectedFallbackModel;

    // Resolve policy action for this failure.
    // 针对该失败类型解析策略动作。
    const action = resolvePolicyAction(failureKind, selectedPolicy);

    // Silent action: apply transition and retry without UI.
    // 静默动作：应用状态迁移并直接重试（不弹 UI）。
    if (action === 'silent') {
      applyAvailabilityTransition(getAvailabilityContext, failureKind);
      return processIntent(config, 'retry_always', fallbackModel);
    }

    // This will be used in the future when FallbackRecommendation is passed through UI
    // 将来 UI 透传 FallbackRecommendation 时使用
    const recommendation: FallbackRecommendation = {
      ...selection,
      selectedModel: fallbackModel,
      action,
      failureKind,
      failedPolicy,
      selectedPolicy,
    };
    void recommendation;
  }

  // Ask UI layer for user intent.
  // 通过 UI 获取用户意图。
  const handler = config.getFallbackModelHandler();
  if (typeof handler !== 'function') {
    return null;
  }

  try {
    // Pass the specific failed model to the UI handler.
    // 传入失败模型，供 UI 决策。
    const intent = await handler(failedModel, fallbackModel, error);

    // If the user chose to switch/retry, we apply the availability transition
    // 如果用户选择切换/重试，则应用可用性状态迁移
    // to the failed model (e.g. marking it terminal if it had a quota error).
    // We DO NOT apply it if the user chose 'stop' or 'retry_later', allowing
    // 若选择 stop/retry_later 则不应用迁移，允许后续再尝试
    // them to try again later with the same model state.
    if (intent === 'retry_always' || intent === 'retry_once') {
      applyAvailabilityTransition(getAvailabilityContext, failureKind);
    }

    return await processIntent(config, intent, fallbackModel);
  } catch (handlerError) {
    debugLogger.error('Fallback handler failed:', handlerError);
    return null;
  }
}

async function handleUpgrade() {
  try {
    await openBrowserSecurely(UPGRADE_URL_PAGE);
  } catch (error) {
    debugLogger.warn(
      'Failed to open browser automatically:',
      getErrorMessage(error),
    );
  }
}

async function processIntent(
  config: Config,
  intent: FallbackIntent | null,
  fallbackModel: string,
): Promise<boolean> {
  switch (intent) {
    case 'retry_always':
      // TODO(telemetry): Implement generic fallback event logging. Existing
      // logFlashFallback is specific to a single Model.
      config.setActiveModel(fallbackModel);
      return true;

    case 'retry_once':
      // For distinct retry (retry_once), we do NOT set the active model permanently.
      // The FallbackStrategy will handle routing to the available model for this turn
      // based on the availability service state (which is updated before this).
      return true;

    case 'stop':
      // Do not switch model on stop. User wants to stay on current model (and stop).
      return false;

    case 'retry_later':
      return false;

    case 'upgrade':
      await handleUpgrade();
      return false;

    default:
      throw new Error(
        `Unexpected fallback intent received from fallbackModelHandler: "${intent}"`,
      );
  }
}
