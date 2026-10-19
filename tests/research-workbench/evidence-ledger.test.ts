import { describe, expect, it } from "vitest";
import { assessSourceQuality } from "../../server/blueprints/apps/research-workbench/app/ingestion-hub/components/EvidenceLedger";
import type { ResearchSource } from "../../server/blueprints/apps/research-workbench/lib/platform-client";

function source(overrides: Partial<ResearchSource> = {}): ResearchSource {
  return {
    id: "source-1",
    url: "https://example.com/article",
    title: "Example",
    type: "other",
    addedAt: "2026-07-29T00:00:00.000Z",
    status: "indexed",
    _createdAt: "2026-07-29T00:00:00.000Z",
    _updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("assessSourceQuality", () => {
  it("recognizes indexed academic sources as strong evidence", () => {
    const result = assessSourceQuality(
      source({
        url: "https://arxiv.org/abs/1234.5678",
        type: "paper",
        publisher: "arXiv",
        publishedAt: "2026-06-01",
        summary: "A peer-reviewed research summary.",
      }),
    );

    expect(result.strength).toBe("high");
    expect(result.authority).toBe("peer-reviewed");
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it("does not inflate failed unknown sources", () => {
    const result = assessSourceQuality(source({ status: "error" }));

    expect(result.strength).toBe("low");
    expect(result.issues).toContain("Source is error");
    expect(result.primarySource).toBe(false);
  });

  it("preserves an explicit stored assessment", () => {
    const quality: NonNullable<ResearchSource["quality"]> = {
      score: 61,
      strength: "medium",
      primarySource: true,
      recency: "aging",
      authority: "first-party",
      issues: ["Version is superseded"],
    };

    expect(assessSourceQuality(source({ quality }))).toEqual(quality);
  });
});
