import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), select: vi.fn(), where: vi.fn(), limit: vi.fn() }));
vi.mock("@server/database_service.js", () => ({ db: { select: mocks.select } }));
vi.mock("./app-records-reader.service.js", () => ({ resolveAppForRecords: mocks.resolve }));
import { readAppActivity } from "./app-activity-reader.service";
import { PgDialect } from "drizzle-orm/pg-core";

describe("app activity access and provenance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
    mocks.where.mockReturnValue({ orderBy: () => ({ limit: mocks.limit }) });
    mocks.resolve.mockResolvedValue({ id: 888, slug: "sdlc-workbench-org342", name: "SDLC" });
  });
  it("checks room/project access before querying, and filters both tenant and app with a cursor", async () => {
    const ctx = { organizationId: 342, roomProjectId: 7, userId: "u", agentName: "QA" };
    mocks.limit.mockResolvedValue([{ id: 5, event: "mission_trigger", level: "info", timestamp: new Date(0) }, { id: 4 }]);
    const result = await readAppActivity(ctx, "/app/sdlc-workbench-public", 1, 9);
    expect(mocks.resolve).toHaveBeenCalledWith(ctx, "/app/sdlc-workbench-public");
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.params).toEqual([888, 342, 9]);
    expect(result).toMatchObject({ source: "app_telemetry", returned: 1, nextBeforeId: 5 });
    expect(result.scope).toContain("not room-specific");
    expect(result.evidence).toContain("Not proof");
    expect(mocks.select.mock.calls[0][0]).not.toHaveProperty("metadata");
  });
  it("does not query telemetry when app/project access fails", async () => {
    mocks.resolve.mockRejectedValue(new Error("not available"));
    await expect(readAppActivity({ organizationId: 342 }, "private")).rejects.toThrow("not available");
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("reports no app events without substituting organization-wide events", async () => {
    mocks.limit.mockResolvedValue([]);
    expect(await readAppActivity({ organizationId: 342 }, "sdlc")).toMatchObject({ events: [], returned: 0, nextBeforeId: null });
  });
});
