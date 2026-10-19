/**
 * Restore TECHHEAD7's Autonomous Codegen Portal from the committed Next.js blueprint.
 *
 * This repairs app records that were accidentally converted to Tokenized UI by
 * removing config.tokenizedUI, re-materializing the workspace from
 * server/blueprints/apps/codegen-pipeline-workbench, rebuilding, publishing, and
 * starting the app.
 *
 * Usage:
 *   npx tsx server/scripts/restore-autonomous-codegen-portal-techhead7.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "../database_service.js";
import { apps, appDeployments, appInstances, orgs } from "@shared/schema/index.js";
import { appBuilderService } from "../domain/apps/app-builder.service.js";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { resolveForgeWorkspacePath } from "../domain/apps/core/forge-paths.js";

const ORG_NAME = "TECHHEAD7";
const BLUEPRINT = "codegen-pipeline-workbench";
const PUBLIC_SLUG = "codegen-pipeline-workbench";

async function findTargetApp(orgId: number) {
    const [app] = await db
        .select()
        .from(apps)
        .where(and(
            eq(apps.organizationId, orgId),
            or(
                eq(apps.slug, BLUEPRINT),
                eq(apps.slug, `${BLUEPRINT}-org${orgId}`),
                eq(apps.blueprint, BLUEPRINT),
                eq(apps.blueprintSlug, BLUEPRINT),
                ilike(apps.slug, `%${BLUEPRINT}%`),
            ),
        ))
        .limit(1);

    return app ?? null;
}

async function ensureDeployment(appId: number, orgId: number) {
    const strayDeployments = await db
        .select()
        .from(appDeployments)
        .where(eq(appDeployments.appId, appId));

    const owned = strayDeployments.find((deployment) => deployment.organizationId === orgId);
    for (const stray of strayDeployments) {
        if (stray.organizationId === orgId) continue;
        if (owned) {
            await db
                .update(appInstances)
                .set({ deploymentId: owned.id, updatedAt: new Date() })
                .where(eq(appInstances.deploymentId, stray.id));
        }
        await db.delete(appDeployments).where(eq(appDeployments.id, stray.id));
    }

    const [existing] = await db
        .select()
        .from(appDeployments)
        .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId)))
        .limit(1);

    const deploymentValues = {
        status: "active" as const,
        isPublished: true,
        publicSlug: PUBLIC_SLUG,
        url: null,
        updatedAt: new Date(),
    };

    if (existing) {
        const [deployment] = await db
            .update(appDeployments)
            .set(deploymentValues)
            .where(eq(appDeployments.id, existing.id))
            .returning();
        return deployment;
    }

    const [deployment] = await db
        .insert(appDeployments)
        .values({
            appId,
            organizationId: orgId,
            config: {},
            accessPolicy: "org",
            ...deploymentValues,
        } as any)
        .returning();
    return deployment;
}

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, ORG_NAME)).limit(1);
    if (!org) throw new Error(`${ORG_NAME} org not found`);

    const app = await findTargetApp(org.id);
    if (!app) throw new Error(`No ${BLUEPRINT} app found for org ${org.id}`);

    const blueprintPath = path.resolve(process.cwd(), "server", "blueprints", "apps", BLUEPRINT);
    const workspacePath = await resolveForgeWorkspacePath(app.slug);

    console.log(`Restoring ${app.name} (#${app.id}) for ${ORG_NAME} (${org.id})`);
    console.log(`Blueprint: ${blueprintPath}`);
    console.log(`Workspace: ${workspacePath}`);

    await fs.access(path.join(blueprintPath, "package.json"));
    await appRegistryService.stopApp(app.id).catch((error: any) => {
        console.warn(`Stop skipped/failed: ${error?.message ?? error}`);
    });

    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.cp(blueprintPath, workspacePath, {
        recursive: true,
        filter: (src: string) => {
            const normalized = src.split(path.sep).join("/");
            return !normalized.includes("/.next") && !normalized.includes("/node_modules");
        },
    });

    const currentConfig = (app.config ?? {}) as Record<string, unknown>;
    const { tokenizedUI: _tokenizedUI, ...configWithoutTokenizedUI } = currentConfig;
    const runtimeMetadata = (app.runtimeMetadata ?? {}) as Record<string, unknown>;

    await db
        .update(apps)
        .set({
            config: {
                ...configWithoutTokenizedUI,
                cycleApp: (currentConfig as any).cycleApp ?? (runtimeMetadata as any).cycleApp,
            },
            dockerImage: `oddjob-app/${app.slug}:v1`,
            blueprint: BLUEPRINT,
            blueprintSlug: BLUEPRINT,
            updatedAt: new Date(),
        })
        .where(eq(apps.id, app.id));

    const deployment = await ensureDeployment(app.id, org.id);
    console.log(`Deployment #${deployment.id} active + published at /app/${PUBLIC_SLUG}`);

    const build = await appBuilderService.buildContainer(app.id, app.slug);
    if (!build.success) {
        throw new Error(build.error ?? "Build failed");
    }

    console.log("Autonomous Codegen Portal restored and started.");
    process.exit(0);
}

main().catch((error) => {
    console.error("Restore failed:", error);
    process.exit(1);
});
