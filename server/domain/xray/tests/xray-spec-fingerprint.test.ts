import { describe, it, expect, beforeEach, vi } from "vitest";
import { xrayNodeDetailService } from "../core/xray-node-detail.service.js";
import { db } from "@server/database_service.js";
import { xrayNodeDocumentation, xrayNodeDocChanges } from "@shared/schema/index.js";

vi.mock("@server/database_service.js", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

// saveNodeDocumentation now also files the spec into the knowledge base, so that
// the ~450KB of architecture specs are reachable by knowledge search — they used
// to get a knowledge TOPIC and no document, and were invisible for months. That
// path runs its own inserts, which would otherwise land in the db.insert counts
// asserted below. Stubbed here so those counts keep measuring the fingerprint
// and change-register writes they were written to measure.
const createDocument = vi.fn(async (_input: any, _orgContext?: any) => ({ id: 555 }));
vi.mock("@domain/knowledge/core/extraction/document-service.js", () => ({
  documentService: { createDocument },
}));

describe("X-Ray Spec Content Fingerprinting & Change Register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes deterministic SHA-256 fingerprint for spec markdown content", () => {
    const markdown1 = "## Overview\nComponent A specification content.";
    const markdown2 = "## Overview\nComponent A specification content.";
    const markdown3 = "## Overview\nComponent B specification content.";

    const fp1 = xrayNodeDetailService.computeSpecFingerprint(markdown1);
    const fp2 = xrayNodeDetailService.computeSpecFingerprint(markdown2);
    const fp3 = xrayNodeDetailService.computeSpecFingerprint(markdown3);

    expect(fp1).toHaveLength(64);
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });

  it("creates initial spec with fingerprint and records 'addition' in change register", async () => {
    const nodeId = "screen::dashboard";
    const nodeType = "screen";
    const content = "# Dashboard Screen Spec\nInitial documentation.";
    const orgId = 1;

    // Mock no existing topic
    const selectQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    // Mock inserts
    const topicInsert = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 101 }]),
    };
    const docInsert = {
      values: vi.fn().mockImplementation((val) => {
        return {
          returning: vi.fn().mockResolvedValue([
            {
              id: 1,
              nodeId,
              nodeType,
              content,
              status: "published",
              contentFingerprint: val.contentFingerprint,
              documentationStatus: "up-to-date",
            },
          ]),
        };
      }),
    };
    const changeInsert = {
      values: vi.fn().mockImplementation((val) => {
        expect(val.kind).toBe("addition");
        expect(val.nodeId).toBe(nodeId);
        expect(val.newFingerprint).toHaveLength(64);
        return Promise.resolve([]);
      }),
    };

    (db.select as any).mockReturnValue(selectQuery);
    (db.insert as any)
      .mockReturnValueOnce(topicInsert)
      .mockReturnValueOnce(docInsert)
      .mockReturnValueOnce(changeInsert);

    const doc = await xrayNodeDetailService.saveNodeDocumentation(
      nodeId,
      nodeType,
      "Dashboard Screen",
      content,
      orgId
    );

    expect(doc.contentFingerprint).toHaveLength(64);
    expect(doc.documentationStatus).toBe("up-to-date");
    expect(db.insert).toHaveBeenCalledTimes(3);

    // A new spec is filed into the knowledge base under the topic that was just
    // created for it — the step that was missing entirely until now.
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument.mock.calls[0][0]).toMatchObject({
      title: "X-Ray Spec: dashboard (screen)",
      sourceType: "xray_spec",
      topicIds: [101],
    });
  });

  it("updates existing spec and records 'change' entry with diff when fingerprint changes", async () => {
    const nodeId = "api_endpoint::GET_/api/health";
    const nodeType = "api_endpoint";
    const oldContent = "# Health Check API\nReturns 200 OK.";
    const newContent = "# Health Check API\nReturns 200 OK with system status.";
    const orgId = 1;

    const oldFingerprint = xrayNodeDetailService.computeSpecFingerprint(oldContent);
    const newFingerprint = xrayNodeDetailService.computeSpecFingerprint(newContent);

    // Mock existing topic & doc
    const selectTopicQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 102, description: "Old" }]),
    };
    const selectDocQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 5,
          nodeId,
          nodeType,
          content: oldContent,
          contentFingerprint: oldFingerprint,
          documentationStatus: "up-to-date",
        },
      ]),
    };

    const topicUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const docUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([
        {
          id: 5,
          nodeId,
          content: newContent,
          contentFingerprint: newFingerprint,
          documentationStatus: "up-to-date",
        },
      ]),
    };
    const changeInsert = {
      values: vi.fn().mockImplementation((val) => {
        expect(val.kind).toBe("change");
        expect(val.previousFingerprint).toBe(oldFingerprint);
        expect(val.newFingerprint).toBe(newFingerprint);
        expect(val.diff).toContain("+ Returns 200 OK with system status.");
        return Promise.resolve([]);
      }),
    };

    (db.select as any)
      .mockReturnValueOnce(selectTopicQuery)
      .mockReturnValueOnce(selectDocQuery);
    (db.update as any)
      .mockReturnValueOnce(topicUpdate)
      .mockReturnValueOnce(docUpdate);
    (db.insert as any).mockReturnValueOnce(changeInsert);

    const doc = await xrayNodeDetailService.saveNodeDocumentation(
      nodeId,
      nodeType,
      "Health API",
      newContent,
      orgId
    );

    expect(doc.contentFingerprint).toBe(newFingerprint);
    expect(db.insert).toHaveBeenCalledTimes(1);

    // Re-filed on a real content change — the fingerprint is the signal for
    // "worth re-embedding", so an unchanged save must not churn the vector store.
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument.mock.calls[0][0]).toMatchObject({
      title: "X-Ray Spec: GET_/api/health (api_endpoint)",
      sourceType: "xray_spec",
    });
  });
});
