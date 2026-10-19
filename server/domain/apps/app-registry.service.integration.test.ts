import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appRegistryService } from "./app-registry.service";
import { db } from "@server/database_service";
import { portAuthority } from "@domain/core/infrastructure/port-authority.js";
import { localProcessService } from "./infrastructure/local-process.service.js";
import { orgs, apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

// Regression coverage for the orphaned-process leak: reconcileRunningApps() used to
// treat "no DB instance row" as equivalent to "process is dead" and would unconditionally
// relaunch on a fresh port, abandoning whatever was still bound to the old one. Every
// server restart cleared the in-memory process registry, so this fired constantly and
// leaked one zombie `next start` process per app per restart.
describe("AppRegistryService.reconcileRunningApps", () => {
    let orgId: number;
    const createdAppIds: number[] = [];

    beforeEach(async () => {
        const [org] = await db.insert(orgs).values({ name: `reconcile-test-org-${Date.now()}-${Math.random()}` }).returning();
        orgId = org.id;
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        for (const appId of createdAppIds) {
            await db.delete(appDeployments).where(eq(appDeployments.appId, appId));
            await db.delete(apps).where(eq(apps.id, appId));
        }
        createdAppIds.length = 0;
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    async function makeRunningAppWithNoInstance(slug: string, assignedPort: number) {
        const [app] = await db.insert(apps).values({
            name: slug,
            slug,
            organizationId: orgId,
            runtimeMetadata: { status: "running", assignedPort, lastInstanceId: 999 },
        }).returning();
        createdAppIds.push(app.id);

        const [deployment] = await db.insert(appDeployments).values({
            appId: app.id,
            organizationId: orgId,
        }).returning();

        return { app, deployment };
    }

    it("does not claim an occupied port without proof that this app owns its process", async () => {
        const { app, deployment } = await makeRunningAppWithNoInstance("reconcile-orphan-still-alive", 19001);

        vi.spyOn(portAuthority, "isPortAvailable").mockImplementation(async (port: number) => port !== 19001);
        const startAppSpy = vi.spyOn(appRegistryService, "startApp");

        await appRegistryService.reconcileRunningApps();

        expect(startAppSpy).not.toHaveBeenCalled();

        const instances = await db.select().from(appInstances).where(eq(appInstances.deploymentId, deployment.id));
        expect(instances).toHaveLength(0);



        const [refreshedApp] = await db.select().from(apps).where(eq(apps.id, app.id));
        expect((refreshedApp.runtimeMetadata as any)?.status).toBe("stopped");
    });

    it("marks the app stopped (not relaunched) when the port is free and no workspace is built", async () => {
        const { app } = await makeRunningAppWithNoInstance("reconcile-orphan-truly-dead", 19002);

        vi.spyOn(portAuthority, "isPortAvailable").mockResolvedValue(true);
        const startProcessSpy = vi.spyOn(localProcessService, "startProcess");

        await appRegistryService.reconcileRunningApps();

        expect(startProcessSpy).not.toHaveBeenCalled();

        const [refreshedApp] = await db.select().from(apps).where(eq(apps.id, app.id));
        expect((refreshedApp.runtimeMetadata as any)?.status).toBe("stopped");
    });
});

/**
 * POD_EVENTS.APP.DEPLOYED had listeners from the day it was defined — the X-Ray
 * listener indexes the app→mission edge and warms the composition cache, the
 * prefetch listener warms that app's manifests — but nothing in the repo ever
 * published it. A newly installed app therefore had no X-Ray presence at all
 * until somebody opened its scope and paid the full graph build.
 *
 * The emission lives in installApp rather than in the scaffold path so that
 * every route into an org is covered by one publish.
 */
describe("AppRegistryService.installApp — deployment announcement", () => {
    let orgId: number;
    const createdAppIds: number[] = [];

    beforeEach(async () => {
        const [org] = await db.insert(orgs).values({ name: `install-event-org-${Date.now()}-${Math.random()}` }).returning();
        orgId = org.id;
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        for (const appId of createdAppIds) {
            await db.delete(appDeployments).where(eq(appDeployments.appId, appId));
            await db.delete(apps).where(eq(apps.id, appId));
        }
        createdAppIds.length = 0;
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    async function makeApp(slug: string) {
        const [app] = await db.insert(apps).values({ name: slug, slug, organizationId: orgId }).returning();
        createdAppIds.push(app.id);
        return app;
    }

    it("publishes app.deployed with the payload its listeners read", async () => {
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        const { POD_EVENTS } = await import("@domain/core/infrastructure/pod-events.contract.js");
        const publishSpy = vi.spyOn(eventStream, "publish").mockResolvedValue("test-event-id");

        const app = await makeApp(`install-event-app-${Date.now()}`);
        const { deployment } = await appRegistryService.installApp(app.id, orgId);

        const deployedCall = publishSpy.mock.calls.find((c) => c[0] === POD_EVENTS.APP.DEPLOYED);
        expect(deployedCall, "installApp must announce the deployment").toBeDefined();

        // Both listeners bail out early unless appSlug AND organizationId are
        // present, so an event missing either is the same as never sending it.
        const payload = deployedCall![1] as Record<string, any>;
        expect(payload.appSlug).toBe(app.slug);
        expect(payload.organizationId).toBe(orgId);
        expect(payload.appId).toBe(app.id);
        expect(payload.deploymentId).toBe(deployment.id);
    });

    it("does not fail the install when the announcement cannot be sent", async () => {
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        vi.spyOn(eventStream, "publish").mockRejectedValue(new Error("event bus unavailable"));

        const app = await makeApp(`install-event-nobus-${Date.now()}`);

        // The deployment row exists by the time we publish. A cache that failed
        // to warm must not read as a failed install.
        const result = await appRegistryService.installApp(app.id, orgId);
        expect(result.deployment.id).toBeGreaterThan(0);

        const [row] = await db.select().from(appDeployments).where(eq(appDeployments.appId, app.id));
        expect(row).toBeDefined();
    });
});

