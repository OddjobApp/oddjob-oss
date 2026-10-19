import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { portManagerService, PortAllocationRequest, PortAllocationResult } from "./port-manager.service.js";
import { db } from "@server/database_service.js";
import { redis } from "@server/domain/core/infrastructure/redis/redis-client.js";
import * as schema from "@shared/schema/index.js";
import { eq, isNull } from "drizzle-orm";

describe("PortManagerService", () => {
  // port_allocations has NOT NULL FKs to apps/app_instances/orgs. The tests below
  // reference small literal ids (1, 2, 3, ...) for appId/instanceId, so we pre-create
  // that many real fixture rows per test and map literal N -> fixtures[N - 1].
  let orgId: number;
  let fixtures: { appId: number; instanceId: number }[];
  const FIXTURE_COUNT = 10;
  let lockHeld = false;

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [org] = await db.insert(schema.orgs).values({ name: `port-manager-test-org-${suffix}` }).returning();
    orgId = org.id;

    fixtures = [];
    for (let i = 0; i < FIXTURE_COUNT; i++) {
      const [app] = await db.insert(schema.apps).values({
        name: `port-test-app-${suffix}-${i}`,
        slug: `port-test-app-${suffix}-${i}`,
        organizationId: orgId,
      }).returning();
      const [deployment] = await db.insert(schema.appDeployments).values({
        appId: app.id,
        organizationId: orgId,
      }).returning();
      const [instance] = await db.insert(schema.appInstances).values({
        deploymentId: deployment.id,
        containerId: `port-test-instance-${suffix}-${i}`,
        port: 0,
        status: "starting",
      }).returning();
      fixtures.push({ appId: app.id, instanceId: instance.id });
    }

    // Mock Redis operations. The lock uses SET ... NX, which only succeeds for the
    // first caller until released — a blanket mockResolvedValue("OK") would let every
    // concurrent caller "acquire" the lock at once, defeating the mutual exclusion the
    // production code relies on. Simulate real NX semantics with shared lock state.
    lockHeld = false;
    vi.spyOn(redis, "set").mockImplementation(async (...args: any[]) => {
      if (args.includes("NX")) {
        if (lockHeld) return null;
        lockHeld = true;
        return "OK";
      }
      return "OK";
    });
    vi.spyOn(redis, "setex").mockResolvedValue("OK");
    vi.spyOn(redis, "get").mockResolvedValue(null);
    vi.spyOn(redis, "del").mockImplementation(async (...args: any[]) => {
      // redis.del is also used to invalidate the per-port cache entry, not just the
      // lock — only clear lock state when the lock key itself is the one being deleted.
      if (args[0] === "port:allocation:lock") {
        lockHeld = false;
      }
      return 1;
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    // Deleting apps cascades to app_deployments -> app_instances -> port_allocations.
    for (const fixture of fixtures) {
      await db.delete(schema.apps).where(eq(schema.apps.id, fixture.appId));
    }
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  });

  describe("allocatePort", () => {
    it("should allocate port within expected range", async () => {
      const request: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[0].instanceId,
        orgId,
        allocationType: "dynamic",
        allocatedBy: "test",
      };

      const result = await portManagerService.allocatePort(request);

      expect(result.port).toBeGreaterThanOrEqual(10000);
      expect(result.port).toBeLessThanOrEqual(15000);
      expect(result.allocationType).toBe("dynamic");
      expect(result.instanceId).toBe(fixtures[0].instanceId);
    });

    it("should throw error when lock cannot be acquired", async () => {
      // Mock lock acquisition to fail on every attempt, exhausting the retry budget
      vi.spyOn(redis, "set").mockResolvedValue(null);

      const request: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[0].instanceId,
        orgId,
        allocatedBy: "test",
      };

      await expect(portManagerService.allocatePort(request)).rejects.toThrow(
        "Could not acquire port allocation lock"
      );
    });

    it("should allocate different ports for different instances", async () => {
      const results: PortAllocationResult[] = [];

      for (let i = 0; i < 5; i++) {
        const request: PortAllocationRequest = {
          appId: fixtures[i].appId,
          instanceId: fixtures[i].instanceId,
          orgId,
          allocatedBy: "test",
        };

        const result = await portManagerService.allocatePort(request);
        results.push(result);
      }

      const ports = results.map((r) => r.port);
      const uniquePorts = new Set(ports);

      expect(uniquePorts.size).toBe(ports.length);
    });
  });

  describe("releasePort", () => {
    it("should release allocated port", async () => {
      // First allocate
      const allocRequest: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[0].instanceId,
        orgId,
        allocatedBy: "test",
      };

      const allocated = await portManagerService.allocatePort(allocRequest);
      const allocatedPort = allocated.port;

      // Then release
      await portManagerService.releasePort(fixtures[0].instanceId);

      // Should be able to allocate same port again
      const request2: PortAllocationRequest = {
        appId: fixtures[1].appId,
        instanceId: fixtures[1].instanceId,
        orgId,
        allocatedBy: "test",
      };

      const result2 = await portManagerService.allocatePort(request2);
      expect(result2.port).toBe(allocatedPort);
    });

    it("should handle non-existent instance gracefully", async () => {
      await expect(portManagerService.releasePort(99999)).resolves.not.toThrow();
    });
  });

  describe("sticky allocation", () => {
    it("should reuse previous port for same app when available", async () => {
      // First allocation
      const request1: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[0].instanceId,
        orgId,
        allocationType: "sticky",
        allocatedBy: "test",
      };

      const result1 = await portManagerService.allocatePort(request1);
      const firstPort = result1.port;
      expect(result1.stickyReused).toBe(false);

      // Release
      await portManagerService.releasePort(fixtures[0].instanceId);

      // Second allocation for same app
      const request2: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[1].instanceId,
        orgId,
        allocationType: "sticky",
        allocatedBy: "test",
      };

      const result2 = await portManagerService.allocatePort(request2);

      expect(result2.port).toBe(firstPort);
      expect(result2.stickyReused).toBe(true);
    });

    it("should allocate new port if previous port is taken", async () => {
      // Allocate port for app 1
      const request1: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[0].instanceId,
        orgId,
        allocationType: "sticky",
        allocatedBy: "test",
      };

      const result1 = await portManagerService.allocatePort(request1);
      const firstPort = result1.port;

      // Release app 1 port
      await portManagerService.releasePort(fixtures[0].instanceId);

      // Allocate same port for app 2 (taking the previous port)
      const request2: PortAllocationRequest = {
        appId: fixtures[1].appId,
        instanceId: fixtures[1].instanceId,
        orgId,
        allocatedBy: "test",
      };

      await portManagerService.allocatePort(request2);

      // Now try to allocate for app 1 again (previous port is taken)
      const request3: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[2].instanceId,
        orgId,
        allocationType: "sticky",
        allocatedBy: "test",
      };

      const result3 = await portManagerService.allocatePort(request3);

      expect(result3.port).not.toBe(firstPort);
      expect(result3.stickyReused).toBe(false);
    });
  });

  describe("getAllocationHistory", () => {
    it("should return allocation history for app", async () => {
      // Allocate multiple ports for same app
      for (let i = 0; i < 3; i++) {
        const request: PortAllocationRequest = {
          appId: fixtures[0].appId,
          instanceId: fixtures[i].instanceId,
          orgId,
          allocatedBy: "test",
        };

        await portManagerService.allocatePort(request);
      }

      const history = await portManagerService.getAllocationHistory(fixtures[0].appId, 10);

      expect(history.length).toBeGreaterThanOrEqual(3);
      expect(history[0].appId).toBe(fixtures[0].appId);
    });
  });

  describe("getPoolStatus", () => {
    it("should return pool status with correct utilization", async () => {
      // Allocate few ports
      for (let i = 0; i < 5; i++) {
        const request: PortAllocationRequest = {
          appId: fixtures[i].appId,
          instanceId: fixtures[i].instanceId,
          orgId,
          allocatedBy: "test",
        };

        await portManagerService.allocatePort(request);
      }

      const status = await portManagerService.getPoolStatus(orgId);

      expect(status.poolStart).toBe(10000);
      expect(status.poolEnd).toBe(15000);
      expect(status.totalPorts).toBe(5001); // 15000 - 10000 + 1
      expect(status.allocatedPorts).toBeGreaterThanOrEqual(5);
      // 5 allocations against a 5001-port pool rounds to 0%, so assert the percentage
      // is computed correctly from the actual counts rather than an unreachable ">0".
      expect(status.utilizationPercent).toBe(
        Math.round((status.allocatedPorts / status.totalPorts) * 100)
      );
    });
  });

  describe("concurrent allocation", () => {
    it("should handle concurrent allocations correctly", async () => {
      const promises: Promise<PortAllocationResult>[] = [];

      for (let i = 0; i < 10; i++) {
        const request: PortAllocationRequest = {
          appId: fixtures[i].appId,
          instanceId: fixtures[i].instanceId,
          orgId,
          allocatedBy: "test",
        };

        promises.push(portManagerService.allocatePort(request));
      }

      const results = await Promise.all(promises);
      const ports = results.map((r) => r.port);
      const uniquePorts = new Set(ports);

      // All ports should be unique
      expect(uniquePorts.size).toBe(ports.length);
    });
  });

  describe("allocation type", () => {
    it("should respect allocation type parameter", async () => {
      const stickyRequest: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[0].instanceId,
        orgId,
        allocationType: "sticky",
        allocatedBy: "test",
      };

      const stickyResult = await portManagerService.allocatePort(stickyRequest);
      expect(stickyResult.allocationType).toMatch(/sticky|dynamic/);

      const dynamicRequest: PortAllocationRequest = {
        appId: fixtures[1].appId,
        instanceId: fixtures[1].instanceId,
        orgId,
        allocationType: "dynamic",
        allocatedBy: "test",
      };

      const dynamicResult = await portManagerService.allocatePort(dynamicRequest);
      expect(dynamicResult.allocationType).toBe("dynamic");
    });
  });

  describe("reason tracking", () => {
    it("should track allocation reason", async () => {
      const request: PortAllocationRequest = {
        appId: fixtures[0].appId,
        instanceId: fixtures[0].instanceId,
        orgId,
        allocationType: "dynamic",
        reason: "first_deploy",
        allocatedBy: "system",
      };

      const result = await portManagerService.allocatePort(request);
      expect(result.instanceId).toBe(fixtures[0].instanceId);

      const history = await portManagerService.getAllocationHistory(fixtures[0].appId, 1);
      expect(history[0].allocationReason).toBe("first_deploy");
    });
  });
});
