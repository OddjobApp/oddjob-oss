import { db } from "../database_service.js";
import { apps, appDeployments, operationalCycles } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { appBuilderService } from "../domain/apps/app-builder.service.js";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { resolveForgeWorkspacePath } from "../domain/apps/core/forge-paths.js";
import fs from "fs/promises";
import path from "path";

async function rebuild() {
    const cycleId = Number(process.env.RESEARCH_CYCLE_ID || 82);
    const requestedOrgId = Number(process.env.RESEARCH_ORG_ID || 0);
    const [cycle] = await db
        .select({ organizationId: operationalCycles.organizationId })
        .from(operationalCycles)
        .where(eq(operationalCycles.id, cycleId))
        .limit(1);
    const orgId = requestedOrgId > 0 ? requestedOrgId : cycle?.organizationId;
    if (!orgId) throw new Error(`Could not resolve organization for cycle ${cycleId}`);

    const [app] = await db
        .select()
        .from(apps)
        .where(and(eq(apps.organizationId, orgId), eq(apps.slug, `research-workbench-org${orgId}`)))
        .limit(1);
    if (!app) {
        console.log(`App research-workbench-org${orgId} not found`);
        process.exit(1);
    }

    const blueprintPath = path.resolve(process.cwd(), "server", "blueprints", "apps", "research-workbench");
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
        blueprint: "research-workbench",
        blueprintSlug: "research-workbench",
        dockerImage: `oddjob-app/${app.slug}:v1`,
        updatedAt: new Date(),
    }).where(eq(apps.id, app.id));
    await db.update(appDeployments).set({
        status: "active",
        isPublished: true,
        updatedAt: new Date(),
    }).where(and(eq(appDeployments.appId, app.id), eq(appDeployments.organizationId, orgId)));

    console.log(`Restored committed blueprint and rebuilding ${app.slug} (id: ${app.id})...`);
    const result = await appBuilderService.buildContainer(app.id, app.slug);

    if (result.success) {
        console.log("✅ Rebuild successful! The workbench will restart automatically.");
    } else {
        console.log(`❌ Rebuild failed: ${result.error}`);
    }
    process.exit(result.success ? 0 : 1);
}

rebuild();
