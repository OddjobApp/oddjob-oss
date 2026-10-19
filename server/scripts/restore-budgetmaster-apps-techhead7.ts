/**
 * Restore TECHHEAD7 BudgetMaster apps from committed Next.js blueprints.
 *
 * Repairs accidental Tokenized UI conversions for:
 * - budgetmaster-workbench
 * - budgetmaster-advisor
 *
 * Usage:
 *   npx tsx server/scripts/restore-budgetmaster-apps-techhead7.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "../database_service.js";
import { apps, appDeployments, appInstances, operationalCycles, orgs } from "@shared/schema/index.js";
import { appBuilderService } from "../domain/apps/app-builder.service.js";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { resolveForgeWorkspacePath } from "../domain/apps/core/forge-paths.js";

const ORG_NAME = process.env.BUDGETMASTER_ORG_NAME || "TECHHEAD7";
const TARGETS = [
    {
        label: "BudgetMaster Workbench",
        blueprint: "budgetmaster-workbench",
    },
    {
        label: "BudgetMaster Financial Advisor",
        blueprint: "budgetmaster-advisor",
    },
];

async function findTargetApp(orgId: number, blueprint: string) {
    const [app] = await db
        .select()
        .from(apps)
        .where(and(
            eq(apps.organizationId, orgId),
            or(
                eq(apps.slug, blueprint),
                eq(apps.slug, `${blueprint}-org${orgId}`),
                eq(apps.blueprint, blueprint),
                eq(apps.blueprintSlug, blueprint),
                ilike(apps.slug, `%${blueprint}%`),
            ),
        ))
        .limit(1);

    return app ?? null;
}

async function ensureDeployment(appId: number, orgId: number, fallbackPublicSlug: string) {
    const deployments = await db
        .select()
        .from(appDeployments)
        .where(eq(appDeployments.appId, appId));

    const owned = deployments.find((deployment) => deployment.organizationId === orgId);
    for (const stray of deployments) {
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

    const publicSlug = existing?.publicSlug || fallbackPublicSlug;
    const deploymentValues = {
        status: "active" as const,
        isPublished: true,
        publicSlug,
        url: null,
        accessPolicy: "org" as const,
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
            ...deploymentValues,
        } as any)
        .returning();
    return deployment;
}

async function restoreTarget(orgId: number, target: typeof TARGETS[number]) {
    const app = await findTargetApp(orgId, target.blueprint);
    if (!app) {
        console.warn(`Skipped ${target.label}: app not found for org ${orgId}`);
        return;
    }

    const blueprintPath = path.resolve(process.cwd(), "server", "blueprints", "apps", target.blueprint);
    const workspacePath = await resolveForgeWorkspacePath(app.slug);

    console.log(`\nRestoring ${target.label}: ${app.name} (#${app.id})`);
    console.log(`Blueprint: ${blueprintPath}`);
    console.log(`Workspace: ${workspacePath}`);

    await fs.access(path.join(blueprintPath, "package.json"));
    await appRegistryService.stopApp(app.id).catch((error: any) => {
        console.warn(`Stop skipped/failed for ${app.slug}: ${error?.message ?? error}`);
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

    await db
        .update(apps)
        .set({
            config: configWithoutTokenizedUI,
            dockerImage: `oddjob-app/${app.slug}:v1`,
            blueprint: target.blueprint,
            blueprintSlug: target.blueprint,
            updatedAt: new Date(),
        })
        .where(eq(apps.id, app.id));

    const deployment = await ensureDeployment(app.id, orgId, app.slug.replace(/-org\d+$/, ""));
    console.log(`Deployment #${deployment.id} active + published at /app/${deployment.publicSlug}`);

    const build = await appBuilderService.buildContainer(app.id, app.slug);
    if (!build.success) {
        throw new Error(`${target.label} build failed: ${build.error ?? "unknown error"}`);
    }

    console.log(`${target.label} restored and started.`);
}

async function main() {
    const requestedOrgId = Number(process.env.BUDGETMASTER_ORG_ID || 0);
    const requestedCycleId = Number(process.env.BUDGETMASTER_CYCLE_ID || 0);
    let orgId = Number.isInteger(requestedOrgId) && requestedOrgId > 0 ? requestedOrgId : 0;

    if (!orgId && Number.isInteger(requestedCycleId) && requestedCycleId > 0) {
        const [cycle] = await db
            .select({ organizationId: operationalCycles.organizationId })
            .from(operationalCycles)
            .where(eq(operationalCycles.id, requestedCycleId))
            .limit(1);
        orgId = cycle?.organizationId ?? 0;
        if (!orgId) throw new Error(`Cycle ${requestedCycleId} has no organization`);
    }

    const [org] = orgId
        ? await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1)
        : await db.select().from(orgs).where(eq(orgs.name, ORG_NAME)).limit(1);
    if (!org) throw new Error(orgId ? `Organization ${orgId} not found` : `${ORG_NAME} org not found`);

    const requestedTarget = process.env.BUDGETMASTER_TARGET?.trim();
    const selectedTargets = requestedTarget
        ? TARGETS.filter((target) => target.blueprint === requestedTarget)
        : TARGETS;
    if (requestedTarget && selectedTargets.length === 0) {
        throw new Error(`Unknown BudgetMaster target: ${requestedTarget}`);
    }

    console.log(`Restoring BudgetMaster apps for ${org.name} (${org.id})`);
    for (const target of selectedTargets) {
        await restoreTarget(org.id, target);
    }

    console.log("\nBudgetMaster restore complete.");
    process.exit(0);
}

main().catch((error) => {
    console.error("BudgetMaster restore failed:", error);
    process.exit(1);
});
