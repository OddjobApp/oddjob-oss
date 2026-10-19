import { db } from "@server/database_service.js";
import { forgeReleases } from "@shared/schema/apps/forge-releases.js";
import { apps } from "@shared/schema/apps.js";
import { eq, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const logger = createLogger("ForgeRelease");
const FORGE_WORKSPACE_ROOT = path.resolve("storage/forge-workspace");

export const forgeReleaseService = {
    async createRelease(appId: number, qaEvidence: Record<string, unknown>, organizationId?: number) {
        const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
        if (!app) throw new Error(`App ${appId} not found`);

        // Bump semver
        const [latest] = await db.select().from(forgeReleases)
            .where(eq(forgeReleases.appId, appId))
            .orderBy(desc(forgeReleases.createdAt)).limit(1);
        const prevVersion = latest?.version ?? app.version ?? "0.0.0";
        const [major, minor, patch] = prevVersion.replace(/^v/, "").split(".").map(Number);
        const newVersion = `${major}.${minor ?? 0}.${(patch ?? 0) + 1}`;

        // Compute artifact hash from workspace files
        let artifactHash: string | undefined;
        try {
            const workspacePath = path.join(FORGE_WORKSPACE_ROOT, app.slug ?? String(appId));
            const allFiles: string[] = [];
            async function walk(dir: string) {
                const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    if (["node_modules", ".next", ".git"].includes(e.name)) continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) await walk(full);
                    else allFiles.push(full);
                }
            }
            await walk(workspacePath);
            allFiles.sort();
            const hash = crypto.createHash("sha256");
            for (const f of allFiles.slice(0, 200)) {
                const content = await fs.readFile(f).catch(() => Buffer.from(""));
                hash.update(content);
            }
            artifactHash = hash.digest("hex").slice(0, 16);
        } catch {}

        const [release] = await db.insert(forgeReleases).values({
            appId,
            version: newVersion,
            artifactHash,
            qaEvidence,
            status: "pending",
            organizationId: organizationId ?? null,
        }).returning();

        // Update app version
        await db.update(apps).set({ version: newVersion }).where(eq(apps.id, appId));

        logger.info(`[ForgeRelease] Created release ${release.id} v${newVersion} for app ${appId}`);
        return release;
    },

    async approveRelease(releaseId: number, userId: string) {
        const { decisionRouter } = await import("@domain/governor/core/decision-router.js");
        const [release] = await db.select().from(forgeReleases).where(eq(forgeReleases.id, releaseId)).limit(1);
        if (!release) throw new Error(`Release ${releaseId} not found`);

        const decision = await decisionRouter.requestDecision({
            sessionId: `forge-release-${releaseId}`,
            tool: "forge_deploy",
            params: { releaseId, appId: release.appId, version: release.version },
            goal: `Approve deployment of release v${release.version} for app ${release.appId}`,
            riskLevel: "medium",
            approverType: "internal",
            approverEmail: userId,
            approverId: userId,
            channels: ["inbox"],
            organizationId: release.organizationId ?? undefined,
        });

        if (decision.approved) {
            await db.update(forgeReleases).set({ status: "approved" }).where(eq(forgeReleases.id, releaseId));
        }
        return { approved: decision.approved, reason: decision.reason };
    },

    async deployRelease(releaseId: number, deployedBy: string) {
        const [release] = await db.select().from(forgeReleases).where(eq(forgeReleases.id, releaseId)).limit(1);
        if (!release) throw new Error(`Release ${releaseId} not found`);
        if (release.status !== "approved") throw new Error(`Release ${releaseId} is not approved (status: ${release.status})`);

        const [app] = await db.select().from(apps).where(eq(apps.id, release.appId)).limit(1);
        if (!app) throw new Error(`App ${release.appId} not found`);

        const { appBuilderService } = await import("../app-builder.service.js");
        const buildResult = await appBuilderService.buildContainer(release.appId, app.slug ?? String(release.appId));
        if (!buildResult.success) throw new Error(`Container build failed: ${buildResult.error ?? "unknown"}`);

        await db.update(forgeReleases).set({
            status: "deployed",
            deployedAt: new Date(),
            deployedBy,
        }).where(eq(forgeReleases.id, releaseId));

        await db.update(apps).set({ status: "active" }).where(eq(apps.id, release.appId));
        logger.info(`[ForgeRelease] Deployed release ${releaseId} v${release.version} by ${deployedBy}`);
        return { success: true, releaseId, version: release.version };
    },

    async rollbackToRelease(appId: number, targetReleaseId: number, userId: string) {
        const [target] = await db.select().from(forgeReleases)
            .where(eq(forgeReleases.id, targetReleaseId)).limit(1);
        if (!target || target.appId !== appId) throw new Error(`Release ${targetReleaseId} not found for app ${appId}`);
        if (target.status !== "deployed") throw new Error(`Cannot rollback to non-deployed release ${targetReleaseId}`);

        const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
        if (!app) throw new Error(`App ${appId} not found`);

        // Create a new release record marking this as a rollback
        const [rollbackRelease] = await db.insert(forgeReleases).values({
            appId,
            version: `${target.version}-rollback-${Date.now()}`,
            artifactHash: target.artifactHash,
            qaEvidence: target.qaEvidence as any,
            status: "approved",
            deployedBy: userId,
            deployedAt: new Date(),
            rollbackFromReleaseId: targetReleaseId,
            organizationId: target.organizationId,
        }).returning();

        await db.update(apps).set({ version: target.version }).where(eq(apps.id, appId));
        logger.info(`[ForgeRelease] Rolled back app ${appId} to v${target.version} (new record: ${rollbackRelease.id})`);
        return { success: true, rollbackReleaseId: rollbackRelease.id, version: target.version };
    },

    async listReleases(appId: number) {
        return db.select().from(forgeReleases).where(eq(forgeReleases.appId, appId))
            .orderBy(desc(forgeReleases.createdAt)).limit(50);
    },
};
