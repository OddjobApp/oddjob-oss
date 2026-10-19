import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ForgeStart");

/** GitHub-style short description limit for forge prompts. */
export const FORGE_DESCRIPTION_MAX = 350;

export interface StartForgeRequest {
    name: string;
    slug: string;
    description?: unknown;
    apiInstructions?: string;
    blueprint?: unknown;
    theme?: unknown;
    oddjobMissionId?: number;
    organizationId?: number | null;
    projectId?: number | null;
    referenceAssetIds?: unknown;
    designStyleId?: string;
    allowedPipelineIds?: unknown;
    allowedDatasetIds?: unknown;
    defaultCollections?: unknown;
    scaffoldPacks?: unknown;
    warmLeaseId?: unknown;
    approvedPlan?: unknown;
    skipToAssembly?: boolean;
}

export type StartForgeResult =
    | { started: true; jobId: string }
    /** Another run already holds the slug. `existingJobId` is absent if it expired mid-check. */
    | { started: false; reason: "already_running"; slug: string; existingJobId?: string }
    /** Nothing is able to execute the build, so it was not accepted. */
    | { started: false; reason: "no_executor"; slug: string; detail: string };

/**
 * Begin a forge run and return its job id.
 *
 * Extracted from POST /api/apps/forge so the route and the CREW room start a
 * build the same way. The alternative was a second copy of the concurrency
 * guard, and two SET NX claims that can drift apart is exactly the bug this
 * function exists to make impossible: the lock, the draft record, the org
 * history entry and the async kickoff are one sequence or they are nothing.
 *
 * Returns as soon as the job is claimed and recorded. The build itself runs on
 * a detached callback and reports through the forge event stream, so callers
 * get a job id to attach to rather than waiting several minutes for a result.
 */
export async function startForgeRun(req: StartForgeRequest): Promise<StartForgeResult> {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
    const { forgeDraftService } = await import("./forge-draft.service.js");
    const { appForgeService } = await import("../app-forge.service.js");

    const {
        name, slug, description, apiInstructions, blueprint, theme, oddjobMissionId,
        organizationId, projectId, referenceAssetIds, designStyleId, allowedPipelineIds,
        allowedDatasetIds, defaultCollections, scaffoldPacks, warmLeaseId, approvedPlan,
        skipToAssembly,
    } = req;

    /*
     * Refuse before anything is written.
     *
     * A build is accepted here and executed by a worker that usually lives in
     * another process. If none is running, claiming the slug and writing a
     * "queued" draft creates a build that can never start and a lock that holds
     * the slug for a day — so the executor is checked first, while refusing
     * still costs nothing.
     */
    const { getForgeExecutorHealth } = await import("./forge-executor-health.service.js");
    const executor = await getForgeExecutorHealth();
    if (!executor.available) {
        return { started: false, reason: "no_executor", slug, detail: executor.reason };
    }

    /*
     * Concurrency guard: atomically claim the active slot with SET NX
     * (set-if-not-exists). GET-then-SET would have a TOCTOU race. Without this,
     * retries pile up as parallel setImmediate callbacks — each spawning npm
     * install / webpack builds — which exhausts the DB connection pool and
     * stalls the server.
     */
    const activeKey = `forge:active:${slug}`;
    const jobId = randomUUID();
    const jobKey = `forge:job:${jobId}`;

    const claimed = await redis.set(activeKey, jobId, "EX", 86400, "NX");
    if (!claimed) {
        const existingJobId = await redis.get(activeKey);
        return { started: false, reason: "already_running", slug, existingJobId: existingJobId || undefined };
    }

    await redis.setex(jobKey, 86400, JSON.stringify({ status: "queued", step: "Initializing", jobId, slug }));

    const initialBlueprint =
        typeof blueprint === "object" && (blueprint as any)?.slug
            ? (blueprint as any).slug
            : (typeof blueprint === "string" && blueprint) || "analytics-dashboard";

    const normalizeCollections = (value: unknown): string[] | undefined =>
        Array.isArray(value)
            ? (value as string[])
            : typeof value === "string" && value.trim()
              ? value.split(",").map((s: string) => s.trim()).filter(Boolean)
              : undefined;

    const initialCollections = normalizeCollections(defaultCollections);
    const truncatedDescription = (typeof description === "string" ? description : "").slice(0, FORGE_DESCRIPTION_MAX);

    await forgeDraftService.createOrUpdateDraft({
        jobId,
        blueprintSlug: initialBlueprint,
        options: {
            name,
            slug,
            description: truncatedDescription,
            apiInstructions: apiInstructions || undefined,
            blueprint: initialBlueprint,
            theme,
            oddjobMissionId: oddjobMissionId || 0,
            organizationId: organizationId ?? undefined,
            projectId: projectId ? Number(projectId) : undefined,
            referenceAssetIds: Array.isArray(referenceAssetIds) ? referenceAssetIds : undefined,
            designStyleId: designStyleId || undefined,
            allowedPipelineIds: Array.isArray(allowedPipelineIds) ? allowedPipelineIds : undefined,
            allowedDatasetIds: Array.isArray(allowedDatasetIds) ? allowedDatasetIds : undefined,
            defaultCollections: initialCollections,
            scaffoldPacks: Array.isArray(scaffoldPacks) ? scaffoldPacks : undefined,
            warmLeaseId: typeof warmLeaseId === "string" ? warmLeaseId : undefined,
            approvedPlan: approvedPlan !== undefined && approvedPlan !== null ? approvedPlan : undefined,
            jobId,
            skipToAssembly: !!skipToAssembly,
        } as any,
        status: "queued",
        progress: 0,
        message: "Forge request accepted.",
    });

    if (organizationId) {
        const orgHistoryKey = `forge:history:org:${organizationId}`;
        await redis.lpush(orgHistoryKey, JSON.stringify({ jobId, slug, name, createdAt: new Date().toISOString() }));
        await redis.ltrim(orgHistoryKey, 0, 49); // Keep last 50
    }

    setImmediate(async () => {
        try {
            await redis.setex(jobKey, 86400, JSON.stringify({ status: "running", step: "Igniting Forge", jobId, slug }));

            let resolvedBlueprint: any = blueprint;
            if (typeof blueprint === "object" && (blueprint as any)?.slug) {
                resolvedBlueprint = (blueprint as any).slug;
            }

            if (!resolvedBlueprint && description) {
                try {
                    const { forgeCodegenService } = await import("./forge-codegen.service.js");
                    resolvedBlueprint = await forgeCodegenService.selectBlueprint(
                        description as string,
                        "analytics-dashboard",
                    );
                    await redis.setex(
                        jobKey,
                        86400,
                        JSON.stringify({ status: "running", step: `Blueprint selected: ${resolvedBlueprint}`, jobId, slug, blueprintSlug: resolvedBlueprint }),
                    );
                } catch {
                    resolvedBlueprint = "analytics-dashboard";
                }
            }
            resolvedBlueprint = resolvedBlueprint || "analytics-dashboard";

            const result = await appForgeService.forgeApp(resolvedBlueprint, {
                name,
                slug,
                description: truncatedDescription,
                apiInstructions: apiInstructions || undefined,
                theme,
                oddjobMissionId: oddjobMissionId || 0,
                organizationId: organizationId ?? undefined,
                projectId: projectId ? Number(projectId) : undefined,
                referenceAssetIds: Array.isArray(referenceAssetIds) ? referenceAssetIds : undefined,
                designStyleId: designStyleId || undefined,
                allowedPipelineIds: Array.isArray(allowedPipelineIds) ? allowedPipelineIds : undefined,
                allowedDatasetIds: Array.isArray(allowedDatasetIds) ? allowedDatasetIds : undefined,
                defaultCollections: normalizeCollections(defaultCollections),
                scaffoldPacks: Array.isArray(scaffoldPacks) ? scaffoldPacks : undefined,
                warmLeaseId: typeof warmLeaseId === "string" ? warmLeaseId : undefined,
                approvedPlan: approvedPlan !== undefined && approvedPlan !== null ? approvedPlan : undefined,
                jobId,
                skipToAssembly: !!skipToAssembly,
            } as any);

            if (!result.success) {
                await redis.setex(jobKey, 86400, JSON.stringify({ status: "failed", step: "Forge queuing failed", jobId, slug }));
                await redis.del(activeKey).catch(() => {});
            }
            // On success: the forge worker owns all subsequent status writes.
        } catch (err: any) {
            logger.error(`[Forge] Job ${jobId} failed: ${err.message}`);
            await redis
                .setex(jobKey, 86400, JSON.stringify({ status: "failed", step: err.message, jobId, slug }))
                .catch((redisErr: any) => logger.error(`[Forge] Could not write failure status for job ${jobId}: ${redisErr.message}`));
            await redis.del(activeKey).catch(() => {});
        }
    });

    return { started: true, jobId };
}

/**
 * A slug no forge run in this org already owns.
 *
 * Room-initiated builds have no wizard to pick a slug, and colliding with a
 * live run would be refused by the guard above. Derives from the name, then
 * disambiguates rather than failing.
 */
export function deriveForgeSlug(name: string, taken: Set<string> = new Set()): string {
    const base =
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "app";

    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) {
        const candidate = `${base}-${i}`;
        if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
}
