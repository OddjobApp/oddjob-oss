/**
 * Rebuild the SDLC Workbench shared-server to pick up new platform-connected pages.
 */
import { db } from "../database_service.js";
import { apps, appDeployments, appInstances, operationalCycles } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { appBuilderService } from "../domain/apps/app-builder.service.js";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { resolveForgeWorkspacePath } from "../domain/apps/core/forge-paths.js";
import fs from "node:fs/promises";
import path from "node:path";

async function rebuild() {
    const cycleId = Number(process.env.SDLC_CYCLE_ID || 81);
    const requestedOrgId = Number(process.env.SDLC_ORG_ID || 0);
    const [cycle] = await db.select({ organizationId: operationalCycles.organizationId })
        .from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
    const orgId = requestedOrgId > 0 ? requestedOrgId : cycle?.organizationId;
    if (!orgId) throw new Error(`Could not resolve organization for cycle ${cycleId}`);

    const [app] = await db.select().from(apps)
        .where(and(eq(apps.organizationId, orgId), eq(apps.slug, `sdlc-workbench-org${orgId}`))).limit(1);
    if (!app) { console.log(`App sdlc-workbench-org${orgId} not found`); process.exit(1); }

    const blueprintPath = path.resolve(process.cwd(), "server", "blueprints", "apps", "sdlc-workbench");
    const workspacePath = await resolveForgeWorkspacePath(app.slug);
    await appRegistryService.stopApp(app.id).catch(() => undefined);
    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.cp(blueprintPath, workspacePath, {
        recursive: true,
        filter: (src) => !src.split(path.sep).join("/").includes("/node_modules") && !src.split(path.sep).join("/").includes("/.next"),
    });

    const { tokenizedUI: _tokenizedUI, ...restoredConfig } = (app.config ?? {}) as Record<string, unknown>;
    await db.update(apps).set({
        config: restoredConfig,
        blueprint: "sdlc-workbench",
        blueprintSlug: "sdlc-workbench",
        dockerImage: `oddjob-app/${app.slug}:v1`,
        updatedAt: new Date(),
    }).where(eq(apps.id, app.id));

    const deployments = await db.select().from(appDeployments).where(eq(appDeployments.appId, app.id));
    const owned = deployments.find((deployment) => deployment.organizationId === orgId);
    if (!owned) throw new Error(`No deployment owned by organization ${orgId}`);
    for (const stray of deployments.filter((deployment) => deployment.id !== owned.id)) {
        await db.delete(appInstances).where(eq(appInstances.deploymentId, stray.id));
        await db.delete(appDeployments).where(eq(appDeployments.id, stray.id));
    }
    await db.update(appDeployments).set({ status: "active", isPublished: true, updatedAt: new Date() })
        .where(eq(appDeployments.id, owned.id));

    console.log(`Installed committed SDLC blueprint and rebuilding ${app.slug} (id: ${app.id})...`);
    const result = await appBuilderService.buildContainer(app.id, app.slug);

    if (result.success) {
        console.log("✅ Rebuild successful! The workbench will restart automatically.");
    } else {
        console.log(`❌ Rebuild failed: ${result.error}`);
    }
    process.exit(result.success ? 0 : 1);
}

rebuild();
