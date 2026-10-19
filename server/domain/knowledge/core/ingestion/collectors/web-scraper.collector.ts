/**
 * Web Scraper Source Collector
 *
 * Fetches web page content, strips HTML tags to extract text,
 * and returns structured CollectorResult with timing metadata.
 * Supports rate-limiting with exponential backoff (3 retries).
 */

import { createLogger } from "@server/utils/logger.js";
import type { CollectorInvocation, SourceCollectorType } from "../types.js";
import type {
  CollectedContent,
  CollectorResult,
  SourceCollector,
} from "./collector.interface.js";

const logger = createLogger("WebScraperCollector");

/** Default timeout in ms if not specified in the invocation */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Maximum number of retry attempts for rate-limited requests */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff */
const BASE_BACKOFF_MS = 1000;

/**
 * Strip HTML tags and decode basic entities to extract readable text content.
 */
function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/**
 * Extract a page title from HTML content.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match?.[1]) {
    return stripHtml(match[1]).trim();
  }
  return "";
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a fetch with exponential backoff on 429 (rate-limited) responses.
 * Returns the Response on success or throws on exhausted retries / other errors.
 */
async function fetchWithBackoff(
  url: string,
  timeout: number,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "OddjobResearchBot/1.0 (autonomous research ingestion)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      clearTimeout(timeoutId);

      // If rate-limited and we have retries left, back off exponentially
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get("Retry-After");
        const backoffMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_BACKOFF_MS * Math.pow(2, attempt);

        logger.warn(
          `Rate limited (429) on attempt ${attempt + 1}/${MAX_RETRIES + 1}, backing off ${backoffMs}ms`,
          { url, attempt },
        );
        await sleep(backoffMs);
        continue;
      }

      return response;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      const error = err instanceof Error ? err : new Error(String(err));

      // Abort errors indicate timeout
      if (error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeout}ms`);
      }

      // For network errors, don't retry (only retry on 429)
      lastError = error;
      throw error;
    }
  }

  // All retries exhausted due to 429
  throw lastError ?? new Error(`Rate limited: exhausted ${MAX_RETRIES} retries`);
}

/**
 * Web Scraper collector implementation.
 *
 * Fetches a web page, extracts text content by stripping HTML,
 * records timing metadata, and handles timeouts and rate limiting.
 */
export const webScraperCollector: SourceCollector = {
  type: "web_scraper" as SourceCollectorType,

  async collect(invocation: CollectorInvocation): Promise<CollectorResult> {
    const startTime = new Date().toISOString();
    const timeout = invocation.timeout || DEFAULT_TIMEOUT_MS;
    const url = invocation.query;

    logger.info("Starting web scrape", {
      collectorId: invocation.id,
      url,
      timeout,
    });

    try {
      const response = await fetchWithBackoff(url, timeout);

      if (!response.ok) {
        const endTime = new Date().toISOString();
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        logger.warn("Web scrape failed with HTTP error", {
          collectorId: invocation.id,
          url,
          status: response.status,
        });

        return {
          collectorId: invocation.id,
          status: "failed",
          startTime,
          endTime,
          error: errorMsg,
          contentSize: 0,
        };
      }

      const html = await response.text();
      const title = extractTitle(html) || url;
      const content = stripHtml(html);
      const contentType =
        response.headers.get("content-type") || "text/html";
      const contentSize = Buffer.byteLength(content, "utf-8");

      const collectedContent: CollectedContent = {
        url,
        title,
        content,
        contentType,
        sourceType: "web_scraper",
        contentSize,
        metadata: {
          httpStatus: response.status,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          fetchedAt: new Date().toISOString(),
        },
      };

      const endTime = new Date().toISOString();

      logger.info("Web scrape completed", {
        collectorId: invocation.id,
        url,
        contentSize,
        title,
      });

      return {
        collectorId: invocation.id,
        status: "completed",
        startTime,
        endTime,
        content: [collectedContent],
        contentSize,
      };
    } catch (err: unknown) {
      const endTime = new Date().toISOString();
      const error = err instanceof Error ? err : new Error(String(err));
      const isTimeout = error.message.includes("timed out");

      logger.error("Web scrape error", {
        collectorId: invocation.id,
        url,
        error: error.message,
        isTimeout,
      });

      return {
        collectorId: invocation.id,
        status: isTimeout ? "timeout" : "failed",
        startTime,
        endTime,
        error: error.message,
        contentSize: 0,
      };
    }
  },
};
