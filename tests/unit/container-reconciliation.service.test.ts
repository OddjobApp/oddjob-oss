import { describe, it, expect, vi, beforeEach } from "vitest";
import net from "node:net";
import { ContainerReconciliationService } from "@domain/infrastructure/container-reconciliation.service.js";

const mocks = vi.hoisted(() => ({
  instances: [] as any[],
  updates: [] as any[],
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(async () => mocks.instances),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: any) => ({
        where: vi.fn(async () => {
          mocks.updates.push(values);
          return [];
        }),
      })),
    })),
  },
}));

// The reconciler also runs in the standalone worker process, which never spawns
// apps — its registry is empty by construction. These tests pin that reality.
vi.mock("@domain/apps/infrastructure/local-process.service.js", () => ({
  localProcessService: {
    isProcessRunning: vi.fn(async () => false),
    stopProcess: vi.fn(async () => true),
  },
}));

function listenOnEphemeralPort(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => server.close() });
    });
  });
}

/** An IPv4 wildcard port that is guaranteed closed: bind, capture, release. */
async function closedPort(): Promise<number> {
  const { port, close } = await listenOnEphemeralPort();
  close();
  return port;
}

describe("ContainerReconciliationService", () => {
  let service: ContainerReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.instances = [];
    mocks.updates = [];
    service = new ContainerReconciliationService();
    // Keep Docker out of these tests — a cooldown makes getDockerContainers
    // return an empty map without spawning `docker ps`.
    (service as any).dockerAvailable = false;
    (service as any).lastDockerCheckTimestamp = Date.now();
  });

  describe("getDockerContainers", () => {
    it("should return empty map without subprocess execution when Docker is in cooldown", async () => {
      const containers = await service.getDockerContainers();
      expect(containers.size).toBe(0);
    });

    it("should attempt Docker status check when not in cooldown", async () => {
      (service as any).dockerAvailable = false;
      (service as any).lastDockerCheckTimestamp = Date.now() - 400000; // 6+ minutes ago (cooldown expired)

      const containers = await service.getDockerContainers();
      expect(containers).toBeDefined();
    });
  });

  describe("reconcile", () => {
    it("should generate a clean reconciliation report for zero app instances", async () => {
      const report = await service.reconcile();

      expect(report).toBeDefined();
      expect(report.totalInstancesChecked).toBe(0);
      expect(report.healthyCount).toBe(0);
      expect(report.divergentCount).toBe(0);
    });

    it("keeps a serving local-process instance healthy when this process did not spawn it", async () => {
      // The worker process's registry is empty, so a live `next start` child of
      // the web server looks exactly like a missing container. The bound port
      // is what proves it alive.
      const { port, close } = await listenOnEphemeralPort();
      mocks.instances = [{
        id: 1,
        deploymentId: 10,
        containerId: "oddjob-app-demo-1",
        port,
        status: "running",
      }];

      try {
        const report = await service.reconcile();

        expect(report.divergentCount).toBe(0);
        expect(report.healthyCount).toBe(1);
        expect(mocks.updates).toHaveLength(0);
      } finally {
        close();
      }
    });

    it("marks a running instance unhealthy only when nothing answers on its port", async () => {
      mocks.instances = [{
        id: 2,
        deploymentId: 10,
        containerId: "oddjob-app-demo-2",
        port: await closedPort(),
        status: "running",
      }];

      const report = await service.reconcile();

      expect(report.divergentCount).toBe(1);
      expect(mocks.updates).toEqual([{ status: "unhealthy" }]);
    });

    it("reinstates an unhealthy row whose port is still serving", async () => {
      const { port, close } = await listenOnEphemeralPort();
      mocks.instances = [{
        id: 3,
        deploymentId: 10,
        containerId: "oddjob-app-demo-3",
        port,
        status: "unhealthy",
      }];

      try {
        const report = await service.reconcile();

        expect(report.healthyCount).toBe(1);
        expect(mocks.updates).toEqual([{ status: "running" }]);
        expect(report.details[0].actionTaken).toBe("reinstated_running_port_alive");
      } finally {
        close();
      }
    });
  });
});
