/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ local: vi.fn(), docker: vi.fn() }));
vi.mock("./local-process.service.js", () => ({
  localProcessService: { isProcessRunning: mocks.local },
}));
vi.mock("@domain/core/infrastructure/docker/docker-bridge.service.js", () => ({
  dockerBridgeService: { isContainerRunning: mocks.docker },
}));
import { verifiedRuntimeInstances, resetRuntimeCheckCache } from "./runtime-instance-health";
describe("app runtime ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeCheckCache();
    mocks.local.mockResolvedValue(false);
    mocks.docker.mockResolvedValue(false);
  });
  it("rejects stale local records even if another app occupies their old port", async () => {
    mocks.local.mockImplementation(
      async (id: string) => id === "oddjob-app-wayfare-10009",
    );
    const rows = [
      { containerId: "oddjob-app-sdlc-10009", port: 10009 },
      { containerId: "oddjob-app-wayfare-10009", port: 10009 },
    ];
    expect(await verifiedRuntimeInstances(rows)).toEqual([rows[1]]);
    expect(mocks.docker).not.toHaveBeenCalled();
  });
  it("checks Docker runtimes through Docker rather than mistaking names for local processes", async () => {
    mocks.docker.mockResolvedValue(true);
    const row = { containerId: "oddjob-app-service-abc123", port: 10010 };
    expect(await verifiedRuntimeInstances([row])).toEqual([row]);
    expect(mocks.docker).toHaveBeenCalledWith(row.containerId);
    expect(mocks.local).not.toHaveBeenCalled();
  });
  it("reuses a recent Docker check instead of shelling out on every proxied request", async () => {
    mocks.docker.mockResolvedValue(true);
    const row = { containerId: "oddjob-app-service-abc123", port: 10010 };
    await verifiedRuntimeInstances([row]);
    await verifiedRuntimeInstances([row]);
    expect(mocks.docker).toHaveBeenCalledTimes(1);
  });
});
