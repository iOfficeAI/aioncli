/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@google/gemini-cli-core';
import {
  AuthType,
  debugLogger,
  OutputFormat,
  ExitCodes,
} from '@google/gemini-cli-core';
import { USER_SETTINGS_PATH } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';
import { type LoadedSettings } from './config/settings.js';
import { handleError } from './utils/errors.js';
import { runExitCleanup } from './utils/cleanup.js';

function getAuthTypeFromEnv(): AuthType | undefined {
  if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
    return AuthType.LOGIN_WITH_GOOGLE;
  }
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') {
    return AuthType.USE_VERTEX_AI;
  }
  if (process.env['GEMINI_API_KEY']) {
    return AuthType.USE_GEMINI;
  }
  // Check for AWS Bedrock credentials
  // AWS SDK will automatically detect credentials from multiple sources:
  // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
  // 2. AWS Profile (AWS_PROFILE)
  // 3. IAM role (for EC2/ECS/Lambda)
  if (
    process.env['AWS_ACCESS_KEY_ID'] ||
    process.env['AWS_PROFILE'] ||
    process.env['AWS_REGION']
  ) {
    return AuthType.USE_BEDROCK;
  }
  // Check for OpenAI API key
  if (process.env['OPENAI_API_KEY']) {
    return AuthType.USE_OPENAI;
  }
  // Check for Anthropic API key
  if (process.env['ANTHROPIC_API_KEY']) {
    return AuthType.USE_ANTHROPIC;
  }
  return undefined;
}

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
  settings: LoadedSettings,
) {
  try {
    // Environment variables take priority over stored settings for non-Google
    // auth types (OpenAI, Bedrock). This allows users to switch providers by
    // setting env vars without needing to clear their stored Google OAuth config.
    const envAuthType = getAuthTypeFromEnv();
    const effectiveAuthType = envAuthType || configuredAuthType;

    const enforcedType = settings.merged.security.auth.enforcedType;
    if (enforcedType && effectiveAuthType !== enforcedType) {
      const message = effectiveAuthType
        ? `The enforced authentication type is '${enforcedType}', but the current type is '${effectiveAuthType}'. Please re-authenticate with the correct type.`
        : `The auth type '${enforcedType}' is enforced, but no authentication is configured.`;
      throw new Error(message);
    }

    if (!effectiveAuthType) {
      const message = `Please set an Auth method in your ${USER_SETTINGS_PATH} or specify one of the following environment variables before running:
  - GEMINI_API_KEY (for Gemini API)
  - GOOGLE_GENAI_USE_VERTEXAI=true (for Vertex AI)
  - GOOGLE_GENAI_USE_GCA=true (for Google Cloud)
  - AWS_PROFILE or AWS_ACCESS_KEY_ID (for AWS Bedrock)
  - OPENAI_API_KEY (for OpenAI compatible APIs)`;
      throw new Error(message);
    }

    const authType: AuthType = effectiveAuthType;

    if (!useExternalAuth) {
      const err = validateAuthMethod(String(authType));
      if (err != null) {
        throw new Error(err);
      }
    }

    return authType;
  } catch (error) {
    if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        nonInteractiveConfig,
        ExitCodes.FATAL_AUTHENTICATION_ERROR,
      );
    } else {
      debugLogger.error(error instanceof Error ? error.message : String(error));
      await runExitCleanup();
      process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
    }
  }
}
