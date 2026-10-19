import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@server/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { AcademicSearchCollector } from "./academic-search.collector.js";
import type { CollectorInvocation } from "../types.js";

const mockFetch = vi.fn();

function invocation(query = "diffusion transformer"): CollectorInvocation {
  return { id: "academic-1", collectorType: "academic_search", query, priority: 1, estimatedYield: 0.7, timeout: 5000 };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const emptyArxiv = () => new Response("<feed></feed>", { status: 200 });

function openReviewNote(id: string, title: string, venueid: string, venue: string) {
  return {
    id,
    forum: id,
    pdate: Date.UTC(2025, 0, 22),
    content: {
      title: { value: title },
      abstract: { value: `Abstract of\n${title}` },
      authors: { value: ["Ada Lovelace", "Alan Turing"] },
      venue: { value: venue },
      venueid: { value: venueid },
      pdf: { value: "/pdf/abc.pdf" },
    },
  };
}

/** Route each source's request to its own canned response. */
function routeFetch(openReview: () => Response) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("export.arxiv.org")) return emptyArxiv();
    if (url.includes("semanticscholar")) return json({ total: 0, data: [] });
    if (url.includes("openreview")) return openReview();
    throw new Error(`unexpected url ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("AcademicSearchCollector — OpenReview", () => {
  it("queries the OpenReview v2 search endpoint with the term", async () => {
    routeFetch(() => json({ notes: [], count: 0 }));
    await new AcademicSearchCollector().collect(invocation("graph neural networks"));

    const call = mockFetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes("openreview"));
    expect(call).toBeDefined();
    const url = new URL(call!);
    expect(url.origin + url.pathname).toBe("https://api2.openreview.net/notes/search");
    expect(url.searchParams.get("term")).toBe("graph neural networks");
    expect(url.searchParams.get("source")).toBe("forum");
  });

  it("maps notes to collected content with venue, review status and links", async () => {
    routeFetch(() => json({
      notes: [
        openReviewNote("taHwqSrbrb", "Dynamic Diffusion Transformer", "ICLR.cc/2025/Conference", "ICLR 2025 Poster"),
        openReviewNote("E4roJSM9RM", "A Rejected Paper", "ICLR.cc/2025/Conference/Rejected_Submission", "Submitted to ICLR 2025"),
      ],
    }));

    const result = await new AcademicSearchCollector().collect(invocation());

    expect(result.status).toBe("completed");
    const accepted = result.content!.find((c) => c.title === "Dynamic Diffusion Transformer")!;
    expect(accepted.url).toBe("https://openreview.net/forum?id=taHwqSrbrb");
    expect(accepted.content).toBe("Abstract of Dynamic Diffusion Transformer");
    expect(accepted.metadata).toMatchObject({
      source: "openreview",
      venue: "ICLR 2025 Poster",
      reviewStatus: "accepted",
      authors: ["Ada Lovelace", "Alan Turing"],
      pdfUrl: "https://openreview.net/pdf/abc.pdf",
      publicationDate: "2025-01-22T00:00:00.000Z",
    });

    const rejected = result.content!.find((c) => c.title === "A Rejected Paper")!;
    expect(rejected.metadata.reviewStatus).toBe("rejected");
  });

  it("drops notes without an abstract", async () => {
    const note = openReviewNote("x1", "No Abstract", "ICLR.cc/2025/Conference", "ICLR 2025 Poster");
    delete (note.content as any).abstract;
    routeFetch(() => json({ notes: [note] }));

    const result = await new AcademicSearchCollector().collect(invocation());
    expect(result.content).toEqual([]);
  });

  it("still completes with the other sources when OpenReview errors", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("export.arxiv.org")) {
        return new Response(
          "<feed><entry><id>http://arxiv.org/abs/1</id><title>An arXiv Paper</title><summary>Text</summary>" +
            "<author><name>A</name></author><published>2025-01-01</published><updated>2025-01-01</updated></entry></feed>",
          { status: 200 },
        );
      }
      if (url.includes("semanticscholar")) return json({ total: 0, data: [] });
      return json({ name: "RateLimitError" }, 429);
    });

    const result = await new AcademicSearchCollector().collect(invocation());
    expect(result.status).toBe("completed");
    expect(result.content!.map((c) => c.title)).toEqual(["An arXiv Paper"]);
  });
});
