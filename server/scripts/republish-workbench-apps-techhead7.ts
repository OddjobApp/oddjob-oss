/**
 * Rebuild and republish updated workbench apps for TECHHEAD7.
 *
 * Usage:
 *   npx tsx server/scripts/republish-workbench-apps-techhead7.ts
 */
import { db } from "../database_service.js";
import { apps, appDeployments, orgs } from "@shared/schema/index.js";
import { appBuilderService } from "../domain/apps/app-builder.service.js";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { and, eq, ilike, or } from "drizzle-orm";

const TARGETS = [
    {
        label: "SDLC Workbench",
        slug: "sdlc-workbench",
        blueprint: "sdlc-workbench",
        publicSlug: "sdlc-workbench",
    },
    {
        label: "Autonomous Codegen Workbench",
        slug: "codegen-pipeline-workbench",
        blueprint: "codegen-pipeline-workbench",
        publicSlug: "codegen-pipeline-workbench",
    },
    {
        label: "Sales Opportunity Workbench",
        slug: "sales-opportunity-workbench",
        blueprint: "sales-opportunity-workbench",
        publicSlug: "sales-opportunity-workbench",
    },
];

async function findOrgApp(orgId: number, target: typeof TARGETS[number]) {
    const [app] = await db
        .select()
        .from(apps)
        .where(and(
            eq(apps.organizationId, orgId),
            or(
                eq(apps.slug, target.slug),
                eq(apps.slug, `${target.slug}-org${orgId}`),
                eq(apps.blueprint, target.blueprint),
                ilike(apps.slug, `%${target.slug}%`),
            )
        ))
        .limit(1);

    return app ?? null;
}

async function ensurePublishedDeployment(appId: number, orgId: number, publicSlug: string) {
    const [existing] = await db
        .select()
        .from(appDeployments)
        .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId)))
        .limit(1);

    const update = {
        status: "active" as const,
        isPublished: true,
        publicSlug,
        updatedAt: new Date(),
    };

    if (existing) {
        const [deployment] = await db
            .update(appDeployments)
            .set(update)
            .where(eq(appDeployments.id, existing.id))
            .returning();
        return deployment;
    }

    const [deployment] = await db
        .insert(appDeployments)
        .values({
            appId,
            organizationId: orgId,
            ...update,
            config: {},
            accessPolicy: "org",
        } as any)
        .returning();
    return deployment;
}

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) throw new Error("TECHHEAD7 org not found");

    console.log(`TECHHEAD7 org id: ${org.id}`);

    for (const target of TARGETS) {
        console.log(`\n=== ${target.label} ===`);
        const app = await findOrgApp(org.id, target);
        if (!app) {
            console.warn(`Skipped: app matching ${target.slug} / ${target.blueprint} not found in TECHHEAD7.`);
            continue;
        }

        console.log(`App #${app.id}: ${app.slug} (blueprint=${app.blueprint ?? "none"})`);

        const build = await appBuilderService.buildContainer(app.id, app.slug);
        if (!build.success) {
            console.error(`Build failed for ${app.slug}: ${build.error ?? "unknown error"}`);
            continue;
        }
        console.log(`Build ok for ${app.slug}.`);

        const deployment = await ensurePublishedDeployment(app.id, org.id, target.publicSlug);
        console.log(`Deployment #${deployment.id} active + published at /app/${target.publicSlug}`);

        try {
            const start = await appRegistryService.startApp(app.id, org.id);
            console.log(`Start result: ${JSON.stringify(start)}`);
        } catch (error: any) {
            console.warn(`Start queued/failed for ${app.slug}: ${error?.message ?? error}`);
        }
    }

    console.log("\nDone.");
    process.exit(0);
}

main().catch((error) => {
    console.error("Republish failed:", error);
    process.exit(1);
});
