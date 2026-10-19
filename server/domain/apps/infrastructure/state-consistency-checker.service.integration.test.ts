import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { consistencyCheckerService, DivergenceType } from "./state-consistency-checker.service.js";
import { db } from "@server/database_service.js";
import { localProcessService } from "./local-process.service.js";
import { appRegistryService } from "../app-registry.service.js";
import { orgs, apps, appDeployments, appInstances, alerts } from "@shared/schema/index.js";
import { stateConsistencyLog, consistencyRemediationConfig } from "@shared/schema/infrastructure/phase-1a.js";
import { redis } from "@server/domain/core/infrastructure/redis/redis-client.js";
import { eq } from "drizzle-orm";

describe("ConsistencyCheckerService", () => {
  describe("detectDivergence", () => {
    it("should return NONE when db says running and docker is running", () => {
      const dbState = {
        instanceId: 1,
        appId: 1,
        orgId: 1,
        containerId: "some-container",
        port: 8080,
        status: "running" as const,
        lastHeartbeat: new Date(),
      };
      const dockerState = {
        exists: true,
        running: true,
      };
      const result = consistencyCheckerService.detectDivergence(dbState, dockerState);
      expect(result.type).toBe(DivergenceType.NONE);
    });

    it("should return CONTAINER_MISSING when db says running but docker does not exist", () => {
      const dbState = {
        instanceId: 1,
        appId: 1,
        orgId: 1,
        containerId: "some-container",
        port: 8080,
        status: "running" as const,
        lastHeartbeat: new Date(),
      };
      const dockerState = {
        exists: false,
        running: false,
      };
      const result = consistencyCheckerService.detectDivergence(dbState, dockerState);
      expect(result.type).toBe(DivergenceType.CONTAINER_MISSING);
    });

    it("should return STATE_MISMATCH when db says running but docker is stopped", () => {
      const dbState = {
        instanceId: 1,
        appId: 1,
        orgId: 1,
        containerId: "some-container",
        port: 8080,
        status: "running" as const,
        lastHeartbeat: new Date(),
      };
      const dockerState = {
        exists: true,
        running: false,
        exitCode: 1,
      };
      const result = consistencyCheckerService.detectDivergence(dbState, dockerState);
      expect(result.type).toBe(DivergenceType.STATE_MISMATCH);
      expect(result.details.actual).toBe("stopped");
    });

    it("should return ZOMBIE_PROCESS when docker is running but exitCode is non-zero", () => {
      const dbState = {
        instanceId: 1,
        appId: 1,
        orgId: 1,
        containerId: "some-container",
        port: 8080,
        status: "running" as const,
        lastHeartbeat: new Date(),
      };
      const dockerState = {
        exists: true,
        running: true,
        exitCode: 137,
      };
      const result = consistencyCheckerService.detectDivergence(dbState, dockerState);
      expect(result.type).toBe(DivergenceType.ZOMBIE_PROCESS);
    });
  });

  describe("checkInstance Integration with DB", () => {
    let orgId: number;
    let appId: number;
    let deploymentId: number;
    let instanceId: number;

    beforeEach(async () => {
      const [org] = await db.insert(orgs).values({ name: `checker-test-org-${Date.now()}` }).returning();
      orgId = org.id;

      const randStr = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const [app] = await db.insert(apps).values({
        name: `test-app-${randStr}`,
        slug: `test-app-slug-${randStr}`,
        organizationId: orgId,
        status: "active",
      }).returning();
      appId = app.id;

      const [deployment] = await db.insert(appDeployments).values({
        appId: app.id,
        organizationId: orgId,
      }).returning();
      deploymentId = deployment.id;

      vi.spyOn(appRegistryService, "startApp").mockResolvedValue({} as any);
      vi.spyOn(appRegistryService, "decommissionInstance").mockResolvedValue(undefined);

      const [instance] = await db.insert(appInstances).values({
        deploymentId: deployment.id,
        containerId: "12345",
        port: 8080,
        status: "running",
      }).returning();
      instanceId = instance.id;

      await db.insert(consistencyRemediationConfig).values({
        orgId,
        autoRemediateEnabled: true,
        remediateMissingContainer: true,
        remediateStateMismatch: true,
        remediatePortConflict: false,
      });
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      try { await redis.del(`consistency:restart-attempts:${instanceId}`); } catch { /* redis optional */ }
      await db.delete(stateConsistencyLog).where(eq(stateConsistencyLog.orgId, orgId));
      await db.delete(consistencyRemediationConfig).where(eq(consistencyRemediationConfig.orgId, orgId));
      await db.delete(appInstances).where(eq(appInstances.deploymentId, deploymentId));
      await db.delete(appDeployments).where(eq(appDeployments.id, deploymentId));
      await db.delete(apps).where(eq(apps.id, appId));
      // The checker raises an alert on divergence, and alerts.organization_id has no
      // cascade — leaving them behind makes the org delete fail with an FK violation.
      await db.delete(alerts).where(eq(alerts.organizationId, orgId));
      await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it("should successfully log a check when the state is healthy", async () => {
      vi.spyOn(localProcessService, "isProcessRunning").mockResolvedValue(true);

      const dbInstance = {
        instanceId,
        appId,
        orgId,
        containerId: "12345",
        port: 8080,
        status: "running" as const,
        lastHeartbeat: new Date(),
      };

      const result = await consistencyCheckerService.checkInstance(dbInstance);
      expect(result.outcome).toBe("healthy");
      expect(result.divergenceType).toBe(DivergenceType.NONE);

      const logs = await db.select().from(stateConsistencyLog).where(eq(stateConsistencyLog.instanceId, instanceId));
      expect(logs).toHaveLength(1);
      expect(logs[0].outcome).toBe("healthy");
      expect(logs[0].divergenceType).toBe(DivergenceType.NONE);
    });

    it("should trigger startApp when container is missing and auto-remediation is enabled", async () => {
      vi.spyOn(localProcessService, "isProcessRunning").mockResolvedValue(false);
      const startAppSpy = vi.spyOn(appRegistryService, "startApp").mockResolvedValue({} as any);

      const dbInstance = {
        instanceId,
        appId,
        orgId,
        containerId: "12345",
        port: 8080,
        status: "running" as const,
        lastHeartbeat: new Date(),
      };

      const result = await consistencyCheckerService.checkInstance(dbInstance);
      expect(result.divergenceType).toBe(DivergenceType.CONTAINER_MISSING);
      expect(result.remediationAttempted).toBe(true);
      expect(startAppSpy).toHaveBeenCalledWith(appId, orgId);

      const logs = await db.select().from(stateConsistencyLog).where(eq(stateConsistencyLog.instanceId, instanceId));
      expect(logs).toHaveLength(1);
      expect(logs[0].divergenceType).toBe(DivergenceType.CONTAINER_MISSING);
      expect(logs[0].remediationAttempted).toBe(true);
    });

    it("engages flap protection and stops restarting once the attempt cap is reached", async () => {
      // Pre-seed the restart counter at the default cap (maxRestartAttempts = 3).
      const seeded = await redis
        .set(`consistency:restart-attempts:${instanceId}`, "3", "EX", 600)
        .then(() => true)
        .catch(() => false);
      if (!seeded) return; // Redis unavailable — flap protection can't be exercised here.

      vi.spyOn(localProcessService, "isProcessRunning").mockResolvedValue(false);
      const startAppSpy = vi.spyOn(appRegistryService, "startApp").mockResolvedValue({} as any);

      const dbInstance = {
        instanceId,
        appId,
        orgId,
        containerId: "12345",
        port: 8080,
        status: "running" as const,
        lastHeartbeat: new Date(),
      };

      const result = await consistencyCheckerService.checkInstance(dbInstance);

      expect(result.divergenceType).toBe(DivergenceType.CONTAINER_MISSING);
      expect(result.remediationAttempted).toBe(false);
      expect(result.outcome).toBe("unrecoverable");
      expect((result.divergenceDetails as any).flapping).toBe(true);
      expect(startAppSpy).not.toHaveBeenCalled();

      const logs = await db.select().from(stateConsistencyLog).where(eq(stateConsistencyLog.instanceId, instanceId));
      expect(logs[0].outcome).toBe("unrecoverable");
      expect(logs[0].remediationAttempted).toBe(false);
    });

    it("clears the flap counter after a healthy sweep", async () => {
      const key = `consistency:restart-attempts:${instanceId}`;
      const seeded = await redis.set(key, "2", "EX", 600).then(() => true).catch(() => false);
      if (!seeded) return;

      vi.spyOn(localProcessService, "isProcessRunning").mockResolvedValue(true); // healthy

      await consistencyCheckerService.checkInstance({
        instanceId, appId, orgId,
        containerId: "12345", port: 8080,
        status: "running" as const, lastHeartbeat: new Date(),
      });

      const remaining = await redis.get(key);
      expect(remaining).toBeNull();
    });
  });
});
