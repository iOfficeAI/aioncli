/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsonrepair } from 'jsonrepair';

export function safeJsonParse<T = Record<string, unknown>>(
  jsonString: string,
  fallbackValue: T = {} as T,
): T {
  if (!jsonString || typeof jsonString !== 'string') {
    return fallbackValue;
  }

  try {
    // First attempt: try normal JSON.parse
    return JSON.parse(jsonString) as T;
  } catch (error) {
    try {
      // Second attempt: use jsonrepair to fix common JSON issues
      const repairedJson = jsonrepair(jsonString);
      return JSON.parse(repairedJson) as T;
    } catch (repairError) {
      console.error('Failed to parse JSON even with jsonrepair:', {
        originalError: error,
        repairError,
        jsonString,
      });
      return fallbackValue;
    }
  }
}