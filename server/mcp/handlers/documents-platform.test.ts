/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("../../domain/knowledge/core/extraction/document-service.js", () => ({ documentService: { listDocuments: mocks.list, getDocumentById: mocks.get } }));
vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("../../domain/knowledge/core/search/search-service.js", () => ({ searchService: {} }));
import { handleGetDocumentContent, handleListDocuments, handleSearchDocuments } from "./documents.js";
const data = (result: any) => JSON.parse(result.content[0].text);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockImplementation(async (context: any) => [{ id: context.organizationId * 100, title: `Private org ${context.organizationId}`, textContent: `Gemini tenantcanary${context.organizationId}`, sourceType: "text" }]);
  mocks.get.mockImplementation(async (id: number, context: any) => id === context.organizationId * 100 ? { id, title: "Private", textContent: "Private body" } : null);
});
describe("MCP platform documentation federation", () => {
  it("adds public docs while leaving private service calls scoped to the requesting org", async () => {
    const one = data(await handleSearchDocuments({ query: "Gemini", limit: 100 }, { organizationId: 1 }));
    const two = data(await handleSearchDocuments({ query: "Gemini", limit: 100 }, { organizationId: 2 }));
    expect(one.data.some((d: any) => String(d.id).startsWith("platform:"))).toBe(true);
    expect(two.data.some((d: any) => String(d.id).startsWith("platform:"))).toBe(true);
    expect(one.data.some((d: any) => d.id === 100)).toBe(true);
    expect(two.data.some((d: any) => d.id === 100)).toBe(false);
    expect(mocks.list.mock.calls.map(call => call[0].organizationId)).toEqual([1, 2]);
  });
  it("reads namespaced public content without consulting private document IDs", async () => {
    for (const organizationId of [1, 2]) {
      const response = data(await handleGetDocumentContent({ documentId: "platform:keys-and-credentials" }, { organizationId }));
      expect(response.success).toBe(true);
      expect(response.data.content).toContain("BYOK");
    }
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("preserves numeric private reads and does not fall back across organizations", async () => {
    expect(data(await handleGetDocumentContent({ documentId: 100 }, { organizationId: 1 })).success).toBe(true);
    expect(data(await handleGetDocumentContent({ documentId: 100 }, { organizationId: 2 })).success).toBe(false);
    expect(mocks.get).toHaveBeenLastCalledWith(100, expect.objectContaining({ organizationId: 2 }));
  });
  it("does not bypass a restricted tool's topic scopes", async () => {
    const result = await handleGetDocumentContent({ documentId: "platform:keys-and-credentials" }, { organizationId: 2, allowedTopicIds: [9] });
    expect(data(result).success).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("lists published guides within the requested limit", async () => {
    const result = data(await handleListDocuments({ limit: 3 }, { organizationId: 2 }));
    expect(result.data).toHaveLength(3);
    expect(result.data.every((doc: any) => String(doc.id).startsWith("platform:"))).toBe(true);
  });
});
