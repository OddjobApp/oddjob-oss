/**
 * Academic Search Source Collector
 *
 * Retrieves academic paper metadata from arXiv (Atom feed), Semantic Scholar and
 * OpenReview (conference/workshop submissions, with their review outcome).
 * Parses title, authors, abstract, publication date, and venue information.
 */

import { createLogger } from "@server/utils/logger.js";
import { classifyOpenReviewStatus } from "@shared/openreview-status.js";
import type { SourceCollector, CollectedContent, CollectorResult } from "./collector.interface.js";
import type { CollectorInvocation, SourceCollectorType } from "../types.js";

const logger = createLogger("AcademicSearchCollector");

// ─── arXiv Response Parsing ────────────────────────────────────────────────────

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  link: string;
  categories: string[];
}

/**
 * Parse arXiv Atom XML feed into structured entries.
 * Uses basic string parsing to avoid XML library dependency.
 */
function parseArxivAtomFeed(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryBlocks = xml.split("<entry>").slice(1); // skip preamble before first <entry>

  for (const block of entryBlocks) {
    const entryXml = block.split("</entry>")[0];
    if (!entryXml) continue;

    const id = extractTag(entryXml, "id") ?? "";
    const title = cleanWhitespace(extractTag(entryXml, "title") ?? "");
    const summary = cleanWhitespace(extractTag(entryXml, "summary") ?? "");
    const published = extractTag(entryXml, "published") ?? "";
    const updated = extractTag(entryXml, "updated") ?? "";

    // Extract authors
    const authors: string[] = [];
    const authorMatches = entryXml.matchAll(/<author>\s*<name>([^<]+)<\/name>/g);
    for (const match of authorMatches) {
      authors.push(match[1].trim());
    }

    // Extract primary link (alternate)
    const linkMatch = entryXml.match(/<link[^>]*href="([^"]+)"[^>]*type="text\/html"/);
    const link = linkMatch ? linkMatch[1] : id.replace("abs", "abs");

    // Extract categories
    const categories: string[] = [];
    const catMatches = entryXml.matchAll(/<category[^>]*term="([^"]+)"/g);
    for (const match of catMatches) {
      categories.push(match[1]);
    }

    entries.push({ id, title, summary, authors, published, updated, link, categories });
  }

  return entries;
}

// ─── Semantic Scholar Response Types ───────────────────────────────────────────

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  authors: Array<{ name: string }>;
  year: number | null;
  venue: string | null;
  url: string;
  publicationDate: string | null;
  citationCount: number | null;
}

interface SemanticScholarResponse {
  total: number;
  data: SemanticScholarPaper[];
}

// ─── OpenReview Response Types ─────────────────────────────────────────────────

/** API v2 wraps every content field as `{ value }`. */
interface OpenReviewNote {
  id: string;
  forum?: string;
  cdate?: number;
  pdate?: number;
  content: {
    title?: { value?: string };
    abstract?: { value?: string };
    authors?: { value?: string[] };
    venue?: { value?: string };
    venueid?: { value?: string };
    keywords?: { value?: string[] };
    pdf?: { value?: string };
  };
}

interface OpenReviewSearchResponse {
  notes?: OpenReviewNote[];
  count?: number;
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function cleanWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function computeByteSize(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

// ─── Academic Search Collector ─────────────────────────────────────────────────

export class AcademicSearchCollector implements SourceCollector {
  readonly type: SourceCollectorType = "academic_search";

  private readonly arxivBaseUrl = "https://export.arxiv.org/api/query";
  private readonly semanticScholarBaseUrl = "https://api.semanticscholar.org/graph/v1/paper/search";
  private readonly openReviewBaseUrl = "https://api2.openreview.net/notes/search";

  async collect(invocation: CollectorInvocation): Promise<CollectorResult> {
    const startTime = new Date().toISOString();
    const { id, query, timeout } = invocation;

    logger.info("[AcademicSearch] Starting collection", { collectorId: id, query, timeout });

    try {
      const results = await this.collectWithTimeout(query, timeout);

      const endTime = new Date().toISOString();
      const totalSize = results.reduce((sum, item) => sum + item.contentSize, 0);

      logger.info("[AcademicSearch] Collection completed", {
        collectorId: id,
        itemCount: results.length,
        totalSize,
      });

      return {
        collectorId: id,
        status: "completed",
        startTime,
        endTime,
        content: results,
        contentSize: totalSize,
      };
    } catch (error: any) {
      const endTime = new Date().toISOString();

      if (error.name === "AbortError" || error.message === "TIMEOUT") {
        logger.warn("[AcademicSearch] Collection timed out", { collectorId: id, timeout });
        return {
          collectorId: id,
          status: "timeout",
          startTime,
          endTime,
          error: `Collection timed out after ${timeout}ms`,
          contentSize: 0,
        };
      }

      logger.error("[AcademicSearch] Collection failed", error, { collectorId: id });
      return {
        collectorId: id,
        status: "failed",
        startTime,
        endTime,
        error: error.message || "Unknown error during academic search",
        contentSize: 0,
      };
    }
  }

  /**
   * Execute academic search with a timeout boundary.
   * Queries both arXiv and Semantic Scholar in parallel.
   */
  private async collectWithTimeout(
    query: string,
    timeout: number
  ): Promise<CollectedContent[]> {
    return new Promise<CollectedContent[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("TIMEOUT"));
      }, timeout);

      this.searchAll(query, timeout)
        .then((results) => {
          clearTimeout(timer);
          resolve(results);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Query arXiv, Semantic Scholar and OpenReview in parallel, merge and
   * deduplicate results.
   */
  private async searchAll(query: string, timeout: number): Promise<CollectedContent[]> {
    const [arxivResults, scholarResults, openReviewResults] = await Promise.allSettled([
      this.searchArxiv(query, timeout),
      this.searchSemanticScholar(query, timeout),
      this.searchOpenReview(query, timeout),
    ]);

    const collected: CollectedContent[] = [];

    if (arxivResults.status === "fulfilled") {
      collected.push(...arxivResults.value);
    } else {
      logger.warn("[AcademicSearch] arXiv search failed", { error: arxivResults.reason?.message });
    }

    if (scholarResults.status === "fulfilled") {
      collected.push(...scholarResults.value);
    } else {
      logger.warn("[AcademicSearch] Semantic Scholar search failed", {
        error: scholarResults.reason?.message,
      });
    }

    if (openReviewResults.status === "fulfilled") {
      collected.push(...openReviewResults.value);
    } else {
      logger.warn("[AcademicSearch] OpenReview search failed", {
        error: openReviewResults.reason?.message,
      });
    }

    // Deduplicate by title similarity (exact lowercase match)
    return this.deduplicateByTitle(collected);
  }

  /**
   * Search arXiv using the Atom feed API.
   */
  private async searchArxiv(query: string, timeout: number): Promise<CollectedContent[]> {
    const maxResults = 10;
    const encodedQuery = encodeURIComponent(query);
    const url = `${this.arxivBaseUrl}?search_query=all:${encodedQuery}&start=0&max_results=${maxResults}`;

    logger.info("[AcademicSearch] Querying arXiv", { url });

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), Math.min(timeout, 30000));

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Oddjob-Research/1.0" },
      });

      if (!response.ok) {
        throw new Error(`arXiv API returned status ${response.status}`);
      }

      const xml = await response.text();
      const entries = parseArxivAtomFeed(xml);

      return entries.map((entry): CollectedContent => {
        const content = entry.summary;
        return {
          url: entry.id || entry.link,
          title: entry.title,
          content,
          contentType: "text/plain",
          sourceType: "academic_search",
          contentSize: computeByteSize(content),
          metadata: {
            authors: entry.authors,
            publicationDate: entry.published,
            updatedDate: entry.updated,
            categories: entry.categories,
            source: "arxiv",
          },
        };
      });
    } finally {
      clearTimeout(fetchTimeout);
    }
  }

  /**
   * Search Semantic Scholar using the Graph API.
   */
  private async searchSemanticScholar(
    query: string,
    timeout: number
  ): Promise<CollectedContent[]> {
    const limit = 10;
    const fields = "paperId,title,abstract,authors,year,venue,url,publicationDate,citationCount";
    const encodedQuery = encodeURIComponent(query);
    const url = `${this.semanticScholarBaseUrl}?query=${encodedQuery}&limit=${limit}&fields=${fields}`;

    logger.info("[AcademicSearch] Querying Semantic Scholar", { url });

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), Math.min(timeout, 30000));

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Oddjob-Research/1.0",
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Semantic Scholar API returned status ${response.status}`);
      }

      const data = (await response.json()) as SemanticScholarResponse;

      if (!data.data || !Array.isArray(data.data)) {
        return [];
      }

      return data.data
        .filter((paper) => paper.abstract) // Only include papers with abstracts
        .map((paper): CollectedContent => {
          const content = paper.abstract || "";
          return {
            url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
            title: paper.title,
            content,
            contentType: "text/plain",
            sourceType: "academic_search",
            contentSize: computeByteSize(content),
            metadata: {
              authors: paper.authors.map((a) => a.name),
              publicationDate: paper.publicationDate || (paper.year ? `${paper.year}` : null),
              venue: paper.venue || null,
              citationCount: paper.citationCount,
              paperId: paper.paperId,
              source: "semantic_scholar",
            },
          };
        });
    } finally {
      clearTimeout(fetchTimeout);
    }
  }

  /**
   * Search OpenReview (API v2) for conference and workshop submissions.
   * Guest access needs no credentials.
   */
  private async searchOpenReview(query: string, timeout: number): Promise<CollectedContent[]> {
    const limit = 10;
    const params = new URLSearchParams({
      term: query,
      type: "terms",
      content: "all",
      source: "forum",
      limit: String(limit),
    });
    const url = `${this.openReviewBaseUrl}?${params.toString()}`;

    logger.info("[AcademicSearch] Querying OpenReview", { url });

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), Math.min(timeout, 30000));

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Oddjob-Research/1.0",
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`OpenReview API returned status ${response.status}`);
      }

      const data = (await response.json()) as OpenReviewSearchResponse;
      if (!Array.isArray(data.notes)) {
        return [];
      }

      return data.notes
        .filter((note) => note.content?.title?.value && note.content?.abstract?.value)
        .map((note): CollectedContent => {
          const content = cleanWhitespace(note.content.abstract!.value!);
          const forumId = note.forum || note.id;
          const venueId = note.content.venueid?.value;
          const published = note.pdate ?? note.cdate;
          const pdf = note.content.pdf?.value;
          return {
            url: `https://openreview.net/forum?id=${forumId}`,
            title: cleanWhitespace(note.content.title!.value!),
            content,
            contentType: "text/plain",
            sourceType: "academic_search",
            contentSize: computeByteSize(content),
            metadata: {
              authors: note.content.authors?.value ?? [],
              publicationDate: published ? new Date(published).toISOString() : null,
              venue: note.content.venue?.value ?? null,
              venueId: venueId ?? null,
              reviewStatus: classifyOpenReviewStatus(venueId, note.content.venue?.value),
              keywords: note.content.keywords?.value ?? [],
              pdfUrl: pdf ? (pdf.startsWith("/") ? `https://openreview.net${pdf}` : pdf) : null,
              paperId: note.id,
              source: "openreview",
            },
          };
        });
    } finally {
      clearTimeout(fetchTimeout);
    }
  }

  /**
   * Remove duplicate entries by comparing lowercase titles.
   * When duplicates are found, prefer the one with more metadata (e.g., citation count).
   */
  private deduplicateByTitle(items: CollectedContent[]): CollectedContent[] {
    const seen = new Map<string, CollectedContent>();

    for (const item of items) {
      const key = item.title.toLowerCase().trim();
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, item);
      } else {
        // Prefer the item with more metadata
        const existingMetaCount = Object.keys(existing.metadata).length;
        const currentMetaCount = Object.keys(item.metadata).length;
        if (currentMetaCount > existingMetaCount) {
          seen.set(key, item);
        }
      }
    }

    return Array.from(seen.values());
  }
}
