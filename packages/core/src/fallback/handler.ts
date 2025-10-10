/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { AuthType } from '../core/contentGenerator.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { logFlashFallback, FlashFallbackEvent } from '../telemetry/index.js';

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
        if (intent === 'retry') {
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

  const fallbackModel = DEFAULT_GEMINI_FLASH_MODEL;

  if (failedModel === fallbackModel) return null;

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
      case 'retry':
        // Activate fallback mode. The NEXT retry attempt will pick this up.
        activateFallbackMode(config, authType);
        return true; // Signal retryWithBackoff to continue.

      case 'stop':
        activateFallbackMode(config, authType);
        return false;

      case 'auth':
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

function activateFallbackMode(config: Config, authType: string | undefined) {
  if (!config.isInFallbackMode()) {
    config.setFallbackMode(true);
    if (authType) {
      logFlashFallback(config, new FlashFallbackEvent(authType));
    }
  }
}
