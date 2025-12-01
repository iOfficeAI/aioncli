/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { AuthType } from '../core/contentGenerator.js';
import {
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_MODEL,
} from '../config/models.js';
import { logFlashFallback, FlashFallbackEvent } from '../telemetry/index.js';
import { coreEvents } from '../utils/events.js';
import { openBrowserSecurely } from '../utils/secure-browser-launcher.js';
import { debugLogger } from '../utils/debugLogger.js';
import { getErrorMessage } from '../utils/errors.js';
import { ModelNotFoundError } from '../utils/httpErrors.js';
import { TerminalQuotaError } from '../utils/googleQuotaErrors.js';

const UPGRADE_URL_PAGE = 'https://goo.gle/set-up-gemini-code-assist';

// [PATCH:API_KEY_ROTATION_START]
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
  if (authType === AuthType.USE_GEMINI || authType === AuthType.USE_OPENAI) {
    // First, give external handler a chance to rotate the key
    const fallbackModelHandler = config.fallbackModelHandler;
    if (typeof fallbackModelHandler === 'function') {
      try {
        const intent = await fallbackModelHandler(
          failedModel,
          failedModel,
          error,
        );

        // After external handler runs, check if key was rotated
        const rotatedAfterHandler = await tryRotateApiKey(config, authType);

        if (rotatedAfterHandler) {
          return true;
        }

        // If key wasn't rotated, respect the intent from external handler
        if (intent === 'retry_always' || intent === 'retry_once') {
          return true;
        }
        if (intent === 'stop') {
          return false;
        }
      } catch (handlerError) {
        console.error(
          '[handleFallback] External handler failed:',
          handlerError,
        );
      }
    }

    // If no external handler or it didn't rotate, try built-in rotation
    const rotated = await tryRotateApiKey(config, authType);

    if (rotated) {
      return true;
    }

    // If all rotation attempts failed, stop retrying
    return null;
  }
  // [PATCH:API_KEY_ROTATION_END]

  // OAuth fallback logic
  if (authType !== AuthType.LOGIN_WITH_GOOGLE) return null;

  // Guardrail: If it's a ModelNotFoundError but NOT the preview model, do not handle it.
  if (
    error instanceof ModelNotFoundError &&
    failedModel !== PREVIEW_GEMINI_MODEL
  ) {
    return null;
  }
  const shouldActivatePreviewFallback =
    failedModel === PREVIEW_GEMINI_MODEL &&
    !(error instanceof TerminalQuotaError);
  // Preview Model Specific Logic
  if (shouldActivatePreviewFallback) {
    // Always set bypass mode for the immediate retry, for non-TerminalQuotaErrors.
    // This ensures the next attempt uses 2.5 Pro.
    config.setPreviewModelBypassMode(true);

    // If we are already in Preview Model fallback mode (user previously said "Always"),
    // we silently retry (which will use 2.5 Pro due to bypass mode).
    if (config.isPreviewModelFallbackMode()) {
      return true;
    }
  }

  const fallbackModel = shouldActivatePreviewFallback
    ? DEFAULT_GEMINI_MODEL
    : DEFAULT_GEMINI_FLASH_MODEL;

  // Consult UI Handler for Intent
  const fallbackModelHandler = config.fallbackModelHandler;
  if (typeof fallbackModelHandler !== 'function') return null;

  try {
    // Pass the specific failed model to the UI handler.
    const intent = await fallbackModelHandler(
      failedModel,
      fallbackModel,
      error,
    );

    // Process Intent and Update State
    switch (intent) {
      case 'retry_always':
        // If the error is non-retryable, e.g. TerminalQuota Error, trigger a regular fallback to flash.
        // For all other errors, activate previewModel fallback.
        if (shouldActivatePreviewFallback) {
          activatePreviewModelFallbackMode(config);
        } else {
          activateFallbackMode(config, authType);
        }
        return true; // Signal retryWithBackoff to continue.

      case 'retry_once':
        // Just retry this time, do NOT set sticky fallback mode.
        return true;

      case 'stop':
        activateFallbackMode(config, authType);
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
  } catch (handlerError) {
    console.error('Fallback UI handler failed:', handlerError);
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

function activateFallbackMode(config: Config, authType: string | undefined) {
  if (!config.isInFallbackMode()) {
    config.setFallbackMode(true);
    coreEvents.emitFallbackModeChanged(true);
    if (authType) {
      logFlashFallback(config, new FlashFallbackEvent(authType));
    }
  }
}

function activatePreviewModelFallbackMode(config: Config) {
  if (!config.isPreviewModelFallbackMode()) {
    config.setPreviewModelFallbackMode(true);
    // We might want a specific event for Preview Model fallback, but for now we just set the mode.
  }
}
