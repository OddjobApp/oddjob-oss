/**
 * Document Parser Source Collector
 *
 * Fetches document files (PDF, DOCX) from a URL, extracts text content,
 * and returns structured CollectorResult with timing metadata.
 *
 * Supports:
 * - PDF documents (via pdf-parse)
 * - DOCX documents (via mammoth)
 */

import { createLogger } from "@server/utils/logger.js";
import type { CollectorInvocation, SourceCollectorType } from "../types.js";
import type {
  CollectedContent,
  CollectorResult,
  SourceCollector,
} from "./collector.interface.js";

const logger = createLogger("DocumentParserCollector");

/** Default timeout in ms if not specified in the invocation */
const DEFAULT_TIMEOUT_MS = 60_000;

// ─── File Type Detection ───────────────────────────────────────────────────────

type DocumentType = "pdf" | "docx" | "unknown";

/**
 * Detect document type from content-type header or URL extension.
 * Prefers content-type header; falls back to URL extension.
 */
function detectDocumentType(
  contentType: string | null,
  url: string,
): DocumentType {
  // Check content-type header first
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes("application/pdf")) return "pdf";
    if (
      ct.includes("application/vnd.openxmlformats-officedocument.wordprocessingml") ||
      ct.includes("application/msword")
    ) {
      return "docx";
    }
  }

  // Fall back to URL extension
  const urlPath = new URL(url).pathname.toLowerCase();
  if (urlPath.endsWith(".pdf")) return "pdf";
  if (urlPath.endsWith(".docx") || urlPath.endsWith(".doc")) return "docx";

  return "unknown";
}

/**
 * Extract a filename from the URL path for use as a title fallback.
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/");
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    // ignore URL parse errors
  }
  return url;
}

// ─── PDF Parsing ───────────────────────────────────────────────────────────────

interface PdfParseResult {
  text: string;
  pageCount: number;
  title: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Parse PDF buffer and extract text content using pdf-parse.
 */
async function parsePdfContent(buffer: Buffer): Promise<PdfParseResult> {
  const pdfParse = await import("pdf-parse");
  const parseFn: Function = (pdfParse as any).default ?? pdfParse;
  const data = await parseFn(buffer, { max: 0 });

  // Clean up the extracted text (collapse excessive newlines)
  const text = (data.text || "").replace(/\n{3,}/g, "\n\n").trim();

  return {
    text,
    pageCount: data.numpages || 0,
    title: data.info?.Title || null,
    metadata: {
      author: data.info?.Author || null,
      creator: data.info?.Creator || null,
      producer: data.info?.Producer || null,
      creationDate: data.info?.CreationDate || null,
      modDate: data.info?.ModDate || null,
      pageCount: data.numpages || 0,
    },
  };
}

// ─── DOCX Parsing ──────────────────────────────────────────────────────────────

interface DocxParseResult {
  text: string;
  wordCount: number;
  metadata: Record<string, unknown>;
}

/**
 * Parse DOCX buffer and extract text content using mammoth.
 */
async function parseDocxContent(buffer: Buffer): Promise<DocxParseResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });

  const text = (result.value || "").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    wordCount,
    metadata: {
      wordCount,
      warnings: result.messages?.length || 0,
    },
  };
}

// ─── Collector Implementation ──────────────────────────────────────────────────

/**
 * Document Parser collector implementation.
 *
 * Fetches a document from the invocation query URL, detects file type
 * from content-type header or URL extension, extracts text content
 * using the appropriate parser (pdf-parse for PDFs, mammoth for DOCX),
 * and returns structured results with timing metadata.
 */
export const documentParserCollector: SourceCollector = {
  type: "document_parser" as SourceCollectorType,

  async collect(invocation: CollectorInvocation): Promise<CollectorResult> {
    const startTime = new Date().toISOString();
    const timeout = invocation.timeout || DEFAULT_TIMEOUT_MS;
    const url = invocation.query;

    logger.info("Starting document parse", {
      collectorId: invocation.id,
      url,
      timeout,
    });

    // Set up timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "OddjobResearchBot/1.0 (autonomous research ingestion)",
          Accept:
            "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,*/*;q=0.8",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const endTime = new Date().toISOString();
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        logger.warn("Document fetch failed with HTTP error", {
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

      const contentType = response.headers.get("content-type");
      const docType = detectDocumentType(contentType, url);

      if (docType === "unknown") {
        const endTime = new Date().toISOString();
        const errorMsg = `Unsupported document type: content-type="${contentType || "none"}", url="${url}"`;
        logger.warn("Unsupported document type", {
          collectorId: invocation.id,
          url,
          contentType,
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

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filename = extractFilenameFromUrl(url);

      let collectedContent: CollectedContent;

      if (docType === "pdf") {
        const parsed = await parsePdfContent(buffer);
        const contentSize = Buffer.byteLength(parsed.text, "utf-8");

        collectedContent = {
          url,
          title: parsed.title || filename,
          content: parsed.text,
          contentType: "application/pdf",
          sourceType: "document_parser",
          contentSize,
          metadata: {
            ...parsed.metadata,
            documentType: "pdf",
            fetchedAt: new Date().toISOString(),
          },
        };

        logger.info("Parsed PDF document", {
          collectorId: invocation.id,
          url,
          pageCount: parsed.pageCount,
          contentSize,
        });
      } else {
        // docType === "docx"
        const parsed = await parseDocxContent(buffer);
        const contentSize = Buffer.byteLength(parsed.text, "utf-8");

        collectedContent = {
          url,
          title: filename,
          content: parsed.text,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sourceType: "document_parser",
          contentSize,
          metadata: {
            ...parsed.metadata,
            documentType: "docx",
            fetchedAt: new Date().toISOString(),
          },
        };

        logger.info("Parsed DOCX document", {
          collectorId: invocation.id,
          url,
          wordCount: parsed.wordCount,
          contentSize,
        });
      }

      const endTime = new Date().toISOString();

      return {
        collectorId: invocation.id,
        status: "completed",
        startTime,
        endTime,
        content: [collectedContent],
        contentSize: collectedContent.contentSize,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const endTime = new Date().toISOString();
      const error = err instanceof Error ? err : new Error(String(err));
      const isTimeout = error.name === "AbortError";

      logger.error("Document parse error", {
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
        error: isTimeout
          ? `Request timed out after ${timeout}ms`
          : error.message,
        contentSize: 0,
      };
    }
  },
};
