/**
 * Input Classifier Service
 *
 * Classifies and validates user input as either a "topic" (keyword/phrase)
 * or a "url" (valid HTTP/HTTPS URL). Performs reachability checks for URLs
 * and length validation for topics.
 *
 * @module ingestion/input-classifier
 */

import { createLogger } from "@server/utils/logger.js";
import type { ClassifiedInput } from "./types.js";

const logger = createLogger("InputClassifier");

// ─── Error Types ───────────────────────────────────────────────────────────────

/** Structured error returned when input classification or validation fails */
export interface InputClassificationError {
  message: string;
  suggestion: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Minimum topic length (trimmed) */
const TOPIC_MIN_LENGTH = 2;

/** Maximum topic length (trimmed) */
const TOPIC_MAX_LENGTH = 500;

/** Timeout for URL reachability check in milliseconds */
const URL_REACHABILITY_TIMEOUT_MS = 10_000;

/**
 * Pattern to identify valid HTTP/HTTPS URLs.
 * Matches strings starting with http:// or https:// followed by a valid host.
 */
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

// ─── Service ───────────────────────────────────────────────────────────────────

export const inputClassifierService = {
  /**
   * Classify and validate user input as either a topic or URL.
   *
   * @param input - Raw user-provided string (topic or URL)
   * @returns Classified and normalized input
   * @throws InputClassificationError when input fails validation
   */
  async classifyInput(input: string): Promise<ClassifiedInput> {
    // Step 1: Check for empty/whitespace-only input
    const trimmed = input?.trim() ?? "";

    if (trimmed.length === 0) {
      throw createClassificationError(
        "Input cannot be empty",
        "Enter a research topic or paste a URL"
      );
    }

    // Step 2: Determine if the input is a URL or topic
    const isUrl = isHttpUrl(trimmed);

    if (isUrl) {
      return await classifyAsUrl(trimmed);
    }

    return classifyAsTopic(trimmed);
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Test whether a string matches a valid HTTP/HTTPS URL pattern.
 */
function isHttpUrl(value: string): boolean {
  return HTTP_URL_PATTERN.test(value);
}

/**
 * Classify input as a URL: validate format and check reachability.
 */
async function classifyAsUrl(url: string): Promise<ClassifiedInput> {
  // Validate URL format using the URL constructor for robust parsing
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw createClassificationError(
      "Not a valid HTTP/HTTPS URL",
      "Include the full URL with protocol"
    );
  }

  // Ensure protocol is http or https
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw createClassificationError(
      "Not a valid HTTP/HTTPS URL",
      "Include the full URL with protocol"
    );
  }

  // Check URL reachability via HTTP HEAD with timeout
  await checkUrlReachability(parsedUrl.href);

  logger.info("Input classified as URL", { url: parsedUrl.href });

  return {
    type: "url",
    value: url,
    normalizedValue: parsedUrl.href,
  };
}

/**
 * Classify input as a topic: validate length constraints.
 */
function classifyAsTopic(trimmed: string): ClassifiedInput {
  if (trimmed.length < TOPIC_MIN_LENGTH) {
    throw createClassificationError(
      "Topic too short",
      "Provide at least 2 characters"
    );
  }

  if (trimmed.length > TOPIC_MAX_LENGTH) {
    throw createClassificationError(
      "Topic too long",
      "Limit to 500 characters"
    );
  }

  const normalizedValue = trimmed.toLowerCase();

  logger.info("Input classified as topic", {
    topic: normalizedValue,
    length: trimmed.length,
  });

  return {
    type: "topic",
    value: trimmed,
    normalizedValue,
  };
}

/**
 * Perform an HTTP HEAD request to verify URL reachability.
 * Throws an InputClassificationError if the URL is not reachable within the timeout.
 */
async function checkUrlReachability(url: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), URL_REACHABILITY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });

    // We consider any response (even 4xx/5xx) as "reachable" — the server responded.
    // Only network errors and timeouts indicate unreachable URLs.
    if (!response.ok && response.status >= 500) {
      logger.warn("URL returned server error but is reachable", {
        url,
        status: response.status,
      });
    }
  } catch (error: unknown) {
    const isAbort =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");

    if (isAbort) {
      throw createClassificationError(
        "URL not reachable within 10 seconds",
        "Verify the URL is accessible"
      );
    }

    // Network error (DNS failure, connection refused, etc.)
    throw createClassificationError(
      "URL not reachable within 10 seconds",
      "Verify the URL is accessible"
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create a structured classification error.
 */
function createClassificationError(
  message: string,
  suggestion: string
): InputClassificationError {
  return { message, suggestion };
}
