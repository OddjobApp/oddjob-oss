/**
 * Web Scraper Collector — Unit Tests
 *
 * Validates:
 * - Successful page fetch and content extraction
 * - Timeout handling (returns status "timeout")
 * - HTTP error handling (returns status "failed")
 * - Rate-limiting with exponential backoff (429 retries)
 * - Timing metadata (startTime, endTime as ISO 8601)
 *
 * Requirements: 3.1, 3.2, 3.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@server/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Import after mocks ─────────────────────────────────────────────────────

import { webScraperCollector } from "./web-scraper.collector.js";
import type { CollectorInvocation } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInvocation(overrides: Partial<CollectorInvocation> = {}): CollectorInvocation {
  return {
    id: "test-collector-001",
    collectorType: "web_scraper",
    query: "https://example.com/article",
    priority: 1,
    estimatedYield: 0.8,
    timeout: 5000,
    ...overrides,
  };
}

function makeHtmlResponse(html: string, status = 200, headers: Record<string, string> = {}): Response {
  const defaultHeaders = new Headers({
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  return new Response(html, { status, statusText: "OK", headers: defaultHeaders });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("webScraperCollector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has type web_scraper", () => {
    expect(webScraperCollector.type).toBe("web_scraper");
  });

  describe("successful collection", () => {
    it("returns completed status with extracted content", async () => {
      const html = `
        <html>
          <head><title>Test Article</title></head>
          <body>
            <h1>Hello World</h1>
            <p>This is the article content.</p>
          </body>
        </html>
      `;
      mockFetch.mockResolvedValueOnce(makeHtmlResponse(html));

      const invocation = makeInvocation();
      const result = await webScraperCollector.collect(invocation);

      expect(result.collectorId).toBe("test-collector-001");
      expect(result.status).toBe("completed");
      expect(result.content).toHaveLength(1);
      expect(result.content![0].title).toBe("Test Article");
      expect(result.content![0].content).toContain("Hello World");
      expect(result.content![0].content).toContain("This is the article content.");
      expect(result.content![0].sourceType).toBe("web_scraper");
      expect(result.content![0].url).toBe("https://example.com/article");
      expect(result.content![0].contentType).toContain("text/html");
      expect(result.content![0].contentSize).toBeGreaterThan(0);
      expect(result.contentSize).toBeGreaterThan(0);
    });

    it("records startTime and endTime as ISO 8601 strings", async () => {
      mockFetch.mockResolvedValueOnce(makeHtmlResponse("<html><body>Content</body></html>"));

      const result = await webScraperCollector.collect(makeInvocation());

      expect(result.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(result.startTime).getTime()).toBeLessThanOrEqual(
        new Date(result.endTime).getTime(),
      );
    });

    it("strips script and style tags from content", async () => {
      const html = `
        <html>
          <head><title>Page</title><style>.foo { color: red }</style></head>
          <body>
            <script>alert("xss")</script>
            <p>Real content here</p>
          </body>
        </html>
      `;
      mockFetch.mockResolvedValueOnce(makeHtmlResponse(html));

      const result = await webScraperCollector.collect(makeInvocation());

      expect(result.content![0].content).not.toContain("alert");
      expect(result.content![0].content).not.toContain(".foo");
      expect(result.content![0].content).toContain("Real content here");
    });

    it("decodes HTML entities", async () => {
      const html = `<html><head><title>Test</title></head><body>&amp; &lt; &gt; &quot;</body></html>`;
      mockFetch.mockResolvedValueOnce(makeHtmlResponse(html));

      const result = await webScraperCollector.collect(makeInvocation());

      expect(result.content![0].content).toContain("& < > \"");
    });

    it("uses URL as title when no title tag present", async () => {
      const html = `<html><body>No title here</body></html>`;
      mockFetch.mockResolvedValueOnce(makeHtmlResponse(html));

      const invocation = makeInvocation({ query: "https://example.com/no-title" });
      const result = await webScraperCollector.collect(invocation);

      expect(result.content![0].title).toBe("https://example.com/no-title");
    });
  });

  describe("timeout handling", () => {
    it("returns timeout status when fetch exceeds configured timeout", async () => {
      mockFetch.mockImplementationOnce((_url: string, opts: RequestInit) => {
        // Simulate the abort controller triggering
        return new Promise((_resolve, reject) => {
          const error = new Error("Request timed out after 5000ms");
          error.name = "AbortError";
          // Listen for abort signal
          if (opts.signal) {
            opts.signal.addEventListener("abort", () => {
              reject(error);
            });
          }
        });
      });

      const invocation = makeInvocation({ timeout: 5000 });
      const collectPromise = webScraperCollector.collect(invocation);

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(6000);

      const result = await collectPromise;

      expect(result.status).toBe("timeout");
      expect(result.error).toContain("timed out");
      expect(result.collectorId).toBe("test-collector-001");
      expect(result.contentSize).toBe(0);
    });

    it("uses default 60s timeout when invocation timeout is 0", async () => {
      mockFetch.mockResolvedValueOnce(makeHtmlResponse("<html><body>ok</body></html>"));

      const invocation = makeInvocation({ timeout: 0 });
      await webScraperCollector.collect(invocation);

      // Verify fetch was called (timeout of 0 falls back to 60000)
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("HTTP error handling", () => {
    it("returns failed status on 404", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      );

      const result = await webScraperCollector.collect(makeInvocation());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("404");
      expect(result.contentSize).toBe(0);
      expect(result.content).toBeUndefined();
    });

    it("returns failed status on 500", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
      );

      const result = await webScraperCollector.collect(makeInvocation());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("500");
    });

    it("returns failed status on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await webScraperCollector.collect(makeInvocation());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("ECONNREFUSED");
      expect(result.contentSize).toBe(0);
    });
  });

  describe("rate limiting with exponential backoff", () => {
    it("retries on 429 with exponential backoff up to 3 times", async () => {
      vi.useRealTimers(); // Need real timers for sleep

      // First 3 attempts return 429, 4th succeeds
      mockFetch
        .mockResolvedValueOnce(new Response("", { status: 429, headers: {} }))
        .mockResolvedValueOnce(new Response("", { status: 429, headers: {} }))
        .mockResolvedValueOnce(new Response("", { status: 429, headers: {} }))
        .mockResolvedValueOnce(makeHtmlResponse("<html><body>Success</body></html>"));

      const result = await webScraperCollector.collect(makeInvocation({ timeout: 30000 }));

      expect(result.status).toBe("completed");
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("returns failed after exhausting all retries on persistent 429", async () => {
      vi.useRealTimers();

      // All 4 attempts (initial + 3 retries) return 429
      mockFetch
        .mockResolvedValueOnce(new Response("", { status: 429, headers: {} }))
        .mockResolvedValueOnce(new Response("", { status: 429, headers: {} }))
        .mockResolvedValueOnce(new Response("", { status: 429, headers: {} }))
        .mockResolvedValueOnce(new Response("", { status: 429, headers: {} }));

      const result = await webScraperCollector.collect(makeInvocation({ timeout: 30000 }));

      // Last 429 response is not retried further — returns as HTTP error
      expect(result.status).toBe("failed");
      expect(result.error).toContain("429");
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("respects Retry-After header for backoff timing", async () => {
      vi.useRealTimers();

      const headers429 = new Headers({ "Retry-After": "1" });
      mockFetch
        .mockResolvedValueOnce(new Response("", { status: 429, headers: headers429 }))
        .mockResolvedValueOnce(makeHtmlResponse("<html><body>OK</body></html>"));

      const start = Date.now();
      const result = await webScraperCollector.collect(makeInvocation({ timeout: 30000 }));
      const elapsed = Date.now() - start;

      expect(result.status).toBe("completed");
      expect(elapsed).toBeGreaterThanOrEqual(900); // ~1 second from Retry-After
    });
  });

  describe("metadata", () => {
    it("includes HTTP status and response headers in metadata", async () => {
      mockFetch.mockResolvedValueOnce(
        makeHtmlResponse("<html><body>test</body></html>", 200, {
          "x-custom-header": "custom-value",
        }),
      );

      const result = await webScraperCollector.collect(makeInvocation());

      expect(result.content![0].metadata.httpStatus).toBe(200);
      expect(result.content![0].metadata.fetchedAt).toBeDefined();
    });
  });
});
