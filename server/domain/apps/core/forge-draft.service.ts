import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import type { ForgeOptions } from "./forge-types.js";

const logger = createLogger("ForgeDraftService");
const DRAFT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_DRAFTS_PER_ORG = 100;

export type ForgeDraftStatus =
    | "draft"
    | "queued"
    | "running"
    | "building"
    | "awaiting_strategy_approval"
    | "awaiting_architecture_approval"
    | "awaiting_wave_approval"
    | "completed"
    | "failed"
    | "cancelled"
    | "unknown";

export interface ForgeDraftRecord {
    jobId: string;
    organizationId: number | null;
    blueprintSlug: string;
    options: ForgeOptions;
    name: string;
    slug: string;
    description?: string;
    status: ForgeDraftStatus;
    progress?: number;
    stage?: number;
    step?: string;
    message?: string;
    error?: string;
    appId?: number;
    readiness?: unknown;
    attempt: number;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    failedAt?: string;
    lastEvent?: {
        level?: string;
        message: string;
        timestamp: string;
    };
}

export interface ForgeDraftStatusPatch {
    options?: ForgeOptions;
    status?: ForgeDraftStatus;
    progress?: number;
    stage?: number;
    step?: string;
    message?: string;
    error?: string;
    appId?: number;
    readiness?: unknown;
    lastEvent?: ForgeDraftRecord["lastEvent"];
}

function draftKey(jobId: string): string {
    return `forge:draft:${jobId}`;
}

function orgDraftsKey(orgId: number): string {
    return `forge:drafts:org:${orgId}`;
}

function parseDraft(raw: string | null): ForgeDraftRecord | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as ForgeDraftRecord;
    } catch (err: any) {
        logger.warn(`Corrupt forge draft record ignored: ${err.message}`);
        return null;
    }
}

async function persistDraft(record: ForgeDraftRecord): Promise<void> {
    await redis.setex(draftKey(record.jobId), DRAFT_TTL_SECONDS, JSON.stringify(record));
    if (record.organizationId) {
        await redis.lpush(orgDraftsKey(record.organizationId), record.jobId);
        await redis.ltrim(orgDraftsKey(record.organizationId), 0, MAX_DRAFTS_PER_ORG - 1);
    }
}

export const forgeDraftService = {
    async createOrUpdateDraft(params: {
        jobId: string;
        blueprintSlug: string;
        options: ForgeOptions;
        status?: ForgeDraftStatus;
        progress?: number;
        message?: string;
    }): Promise<ForgeDraftRecord> {
        const now = new Date().toISOString();
        const existing = parseDraft(await redis.get(draftKey(params.jobId)));
        const next: ForgeDraftRecord = {
            jobId: params.jobId,
            organizationId: params.options.organizationId ?? existing?.organizationId ?? null,
            blueprintSlug: params.blueprintSlug,
            options: params.options,
            name: params.options.name,
            slug: params.options.slug,
            description: params.options.description,
            status: params.status ?? existing?.status ?? "queued",
            progress: params.progress ?? existing?.progress ?? 0,
            message: params.message ?? existing?.message,
            attempt: existing?.attempt ?? 1,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            ...(existing?.appId ? { appId: existing.appId } : {}),
            ...(existing?.readiness ? { readiness: existing.readiness } : {}),
        };

        await persistDraft(next);
        return next;
    },

    async updateDraft(jobId: string, patch: ForgeDraftStatusPatch): Promise<ForgeDraftRecord | null> {
        const existing = parseDraft(await redis.get(draftKey(jobId)));
        if (!existing) return null;

        const now = new Date().toISOString();
        const next: ForgeDraftRecord = {
            ...existing,
            ...patch,
            updatedAt: now,
            ...(patch.status === "completed" ? { completedAt: now } : {}),
            ...(patch.status === "failed" ? { failedAt: now } : {}),
        };
        await persistDraft(next);
        return next;
    },

    /**
     * Removes one unit from a draft, so the Assembly Stack can actually unwire a piece
     * rather than only display it.
     *
     * The stack the user sees is a projection of the last mount_builder_pod artifact,
     * but the state that survives the conversation is this draft — options.components
     * (UI fields), options.pipelineSteps (the DAG) and options.dataset.fields. Dropping
     * a unit from the chat view alone would leave it wired here and it would come back
     * on the next deploy, so removal has to happen against the draft.
     *
     * Returns null when the draft is gone (they expire after 30 days) and reports
     * removed:false when nothing matched, so a caller can tell 'already gone' from
     * 'never existed' instead of both looking like success.
     */
    async removeDraftUnit(
        jobId: string,
        unit: { kind: "component" | "pipelineStep" | "datasetField"; id: string },
    ): Promise<{ draft: ForgeDraftRecord; removed: boolean } | null> {
        const existing = parseDraft(await redis.get(draftKey(jobId)));
        if (!existing) return null;

        const options: any = { ...(existing.options ?? {}) };
        const matches = (entry: any) =>
            String(entry?.id ?? entry?.name ?? entry?.key ?? entry) === unit.id;

        let removed = false;
        const drop = (list: any[] | undefined) => {
            if (!Array.isArray(list)) return list;
            const next = list.filter((entry) => !matches(entry));
            if (next.length !== list.length) removed = true;
            return next;
        };

        if (unit.kind === "component") options.components = drop(options.components);
        if (unit.kind === "pipelineStep") options.pipelineSteps = drop(options.pipelineSteps);
        if (unit.kind === "datasetField" && options.dataset) {
            options.dataset = { ...options.dataset, fields: drop(options.dataset.fields) };
        }

        const next: ForgeDraftRecord = { ...existing, options, updatedAt: new Date().toISOString() };
        await persistDraft(next);
        logger.info(
            `Draft ${jobId}: ${removed ? "removed" : "no match for"} ${unit.kind} "${unit.id}"`,
        );
        return { draft: next, removed };
    },

    /**
     * Removes an entire layer from a draft — the UI form, the pipeline DAG, or the
     * dataset.
     *
     * The Assembly Stack rail shows LAYERS, not individual fields: one card for
     * "UI Input Form (9 Inputs)", one for "Pipeline DAG (3 Transform Steps)". So the
     * removal a user reaches for there is layer-shaped, and removeDraftUnit's
     * entry-level granularity does not express it.
     *
     * dataset is deleted outright rather than emptied: a dataset with no fields is not
     * the same statement as no dataset, and leaving { tableName } behind would still
     * provision a table on the next deploy.
     */
    async clearDraftLayer(
        jobId: string,
        layer: "components" | "pipelineSteps" | "dataset",
    ): Promise<{ draft: ForgeDraftRecord; removed: boolean } | null> {
        const existing = parseDraft(await redis.get(draftKey(jobId)));
        if (!existing) return null;

        const options: any = { ...(existing.options ?? {}) };
        let removed = false;

        if (layer === "dataset") {
            removed = options.dataset != null;
            delete options.dataset;
        } else {
            removed = Array.isArray(options[layer]) && options[layer].length > 0;
            options[layer] = [];
        }

        const next: ForgeDraftRecord = { ...existing, options, updatedAt: new Date().toISOString() };
        await persistDraft(next);
        logger.info(`Draft ${jobId}: ${removed ? "cleared" : "nothing to clear in"} layer "${layer}"`);
        return { draft: next, removed };
    },

    async getDraft(jobId: string): Promise<ForgeDraftRecord | null> {
        const draft = parseDraft(await redis.get(draftKey(jobId)));
        if (!draft) return null;

        const rawStatus = await redis.get(`forge:job:${jobId}`);
        if (!rawStatus) return draft;

        try {
            const status = JSON.parse(rawStatus);
            return {
                ...draft,
                status: status.status ?? draft.status,
                progress: status.progress ?? draft.progress,
                stage: status.stage ?? draft.stage,
                step: status.step ?? draft.step,
                message: status.message ?? status.step ?? draft.message,
                error: status.error ?? draft.error,
                appId: status.appId ?? draft.appId,
                readiness: status.readiness ?? draft.readiness,
                updatedAt: status.updatedAt ?? draft.updatedAt,
            };
        } catch {
            return draft;
        }
    },

    async listDrafts(organizationId: number, limit = 50): Promise<ForgeDraftRecord[]> {
        const ids = await redis.lrange(orgDraftsKey(organizationId), 0, Math.max(limit * 3, limit));
        const seen = new Set<string>();
        const drafts: ForgeDraftRecord[] = [];

        for (const jobId of ids) {
            if (seen.has(jobId)) continue;
            seen.add(jobId);
            const draft = await this.getDraft(jobId);
            if (!draft || draft.organizationId !== organizationId) continue;
            drafts.push(draft);
            if (drafts.length >= limit) break;
        }

        return drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    },

    async markRestarting(jobId: string): Promise<ForgeDraftRecord | null> {
        const existing = parseDraft(await redis.get(draftKey(jobId)));
        if (!existing) return null;
        const now = new Date().toISOString();
        const next: ForgeDraftRecord = {
            ...existing,
            status: "queued",
            progress: 0,
            stage: undefined,
            step: "Restart queued",
            message: "Forge restart queued.",
            error: undefined,
            failedAt: undefined,
            completedAt: undefined,
            attempt: existing.attempt + 1,
            updatedAt: now,
        };
        await persistDraft(next);
        return next;
    },
};
