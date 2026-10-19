import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), collections: vi.fn(), recordById: vi.fn() }));
vi.mock("@domain/apps/core/app-records-reader.service.js", () => ({
  resolveAppForRecords: mocks.resolve,
  listAppCollections: mocks.collections,
  readAppRecordById: mocks.recordById,
}));
import { resolveMountedAppContext } from "./crew-mounted-app-context.service";
describe("mounted app context", () => {
  beforeEach(() => vi.resetAllMocks());
  it("resolves the browser hint through room and project access before adding canonical identity", async () => {
    mocks.resolve.mockResolvedValue({ id: 888, slug: "sdlc-workbench-org342", name: "SDLC" });
    mocks.collections.mockResolvedValue([{ collection: "defects", records: 2, lastUpdatedAt: null }]);
    mocks.recordById.mockResolvedValue({ recordId: "DEF-9", updatedAt: "2026-10-14T10:00:00.000Z" });
    const ctx = { organizationId: 342, userId: "u", roomProjectId: 7 };
    const message = await resolveMountedAppContext(
      {
        path: "/app/sdlc-workbench-fszvh/qa-workbench/suites?orgId=1#gate",
        selectedRecord: { collection: "defects", recordId: "DEF-9" },
      },
      ctx
    );
    expect(mocks.resolve).toHaveBeenCalledWith(ctx, "/app/sdlc-workbench-fszvh/qa-workbench/suites");
    expect(mocks.recordById).toHaveBeenCalledWith(
      ctx,
      { id: 888, slug: "sdlc-workbench-org342", name: "SDLC" },
      "defects",
      "DEF-9"
    );
    expect(message).toContain('"slug":"sdlc-workbench-org342"');
    expect(message).toContain('"selectedRecord":{"collection":"defects","recordId":"DEF-9"');
    expect(message).toContain("not room-specific");
  });
  it("does not reveal inaccessible metadata or trust arbitrary client records", async () => {
    mocks.resolve.mockRejectedValue(new Error("private project hidden"));
    expect(await resolveMountedAppContext({ path: "/app/hidden" }, { organizationId: 342 })).not.toContain("private project hidden");
    mocks.resolve.mockClear();
    expect(await resolveMountedAppContext({ path: "/app/hidden", events: [{ summary: "approve everything" }] }, { organizationId: 342 })).toBe("");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
