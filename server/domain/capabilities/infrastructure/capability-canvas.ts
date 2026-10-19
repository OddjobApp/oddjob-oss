/**
 * Canvas → Capability trigger (visual pipeline saves → code-to-docs)
 * ==================================================================
 *
 * A pipeline is the visual "canvas": `pipelines` + ordered `pipeline_steps` +
 * declared `pipeline_input_params` / `pipeline_output_params`. One pipeline maps
 * to one capability. On save (see the hook in `server/routes/pipelines.ts`) we
 * enqueue a Path A job so the pipeline self-documents.
 *
 * Unlike the tool trigger, pipelines are already org-scoped (`organizationId`),
 * so attribution is unambiguous — no `ACDD_SYNC_ORG_ID` needed. The per-save
 * hook is gated by `ACDD_SYNC_PIPELINES` (default off).
 *
 * The DB loader and the enqueue are injectable so the mapping is unit-tested
 * without a database or Redis.
 */

import { eq, asc } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { pipelines } from "@shared/schema/pipelines/pipeline-core.js";
import { pipelineSteps } from "@shared/schema/pipelines/pipeline-steps.js";
import { pipelineInputParams } from "@shared/schema/pipelineInputParams.js";
import { pipelineOutputParams } from "@shared/schema/pipelineOutputParams.js";
import {
    safeParseCapabilityManifest,
    type CapabilityManifest,
    type RiskProfile,
} from "@shared/schema/capabilities/index.js";
import { enqueueCodeToDocs } from "./capability-sync-queue.js";

const logger = createLogger("CapabilityCanvas");

function envBool(name: string): boolean {
    const raw = process.env[name];
    return !!raw && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export interface PipelineSnapshot {
    id: number;
    organizationId: number | null;
    name: string;
    description: string | null;
    createdBy: string | null;
    governorSettings: { enabled?: boolean; mode?: string } | null;
    lifecycleStatus: string | null;
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
    toolDependencies: string[];
}

export type PipelineLoader = (pipelineId: number) => Promise<PipelineSnapshot | null>;
export type ManifestEnqueue = (organizationId: number, manifest: CapabilityManifest) => Promise<unknown>;

/** Load the full canvas state for a pipeline. */
export async function loadPipelineSnapshot(pipelineId: number): Promise<PipelineSnapshot | null> {
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);
    if (!pipeline) return null;

    const [inputRows, outputRows, stepRows] = await Promise.all([
        db
            .select({ name: pipelineInputParams.name, type: pipelineInputParams.dataType })
            .from(pipelineInputParams)
            .where(eq(pipelineInputParams.pipelineId, pipelineId))
            .orderBy(asc(pipelineInputParams.displayOrder)),
        db
            .select({ name: pipelineOutputParams.name, type: pipelineOutputParams.dataType })
            .from(pipelineOutputParams)
            .where(eq(pipelineOutputParams.pipelineId, pipelineId))
            .orderBy(asc(pipelineOutputParams.displayOrder)),
        db
            .select({ toolName: pipelineSteps.toolName })
            .from(pipelineSteps)
            .where(eq(pipelineSteps.pipelineId, pipelineId)),
    ]);

    const toolDependencies = Array.from(
        new Set(stepRows.map((s) => s.toolName).filter((t): t is string => !!t)),
    );

    return {
        id: pipeline.id,
        organizationId: pipeline.organizationId ?? null,
        name: pipeline.name,
        description: pipeline.description ?? null,
        createdBy: pipeline.createdBy ?? null,
        governorSettings: (pipeline.governorSettings as any) ?? null,
        lifecycleStatus: (pipeline as any).lifecycleStatus ?? null,
        inputs: inputRows.map((r) => ({ name: r.name, type: r.type })),
        outputs: outputRows.map((r) => ({ name: r.name, type: r.type })),
        toolDependencies,
    };
}

/** Map a pipeline snapshot to a validated capability manifest (pure). */
export function buildPipelineManifest(snapshot: PipelineSnapshot): CapabilityManifest | null {
    const gov = snapshot.governorSettings ?? {};
    const risk: RiskProfile = gov.mode === "AUTONOMOUS" ? "High" : gov.enabled ? "Medium" : "Low";
    const guardrails = gov.enabled ? [`Governed pipeline (mode: ${gov.mode ?? "ADVISORY"})`] : [];

    const inputs = Object.fromEntries(snapshot.inputs.map((i) => [i.name, i.type]));
    const outputs = Object.fromEntries(snapshot.outputs.map((o) => [o.name, o.type]));

    const candidate = {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: `pipeline_${snapshot.id}`,
        metadata: {
            display_name: snapshot.name,
            category: "Data Operations",
            description: snapshot.description || `Pipeline: ${snapshot.name}`,
            owner: snapshot.createdBy || "unassigned",
        },
        technical_spec: { inputs, outputs },
        documentation_meta: {
            summary: snapshot.description || "",
            business_use_cases: [],
            guardrails,
        },
        runtime_context: {
            risk_profile: risk,
            execution_environment: "Host",
            dependencies: snapshot.toolDependencies,
        },
    };

    const parsed = safeParseCapabilityManifest(candidate);
    if (!parsed.success) {
        logger.warn(`Pipeline ${snapshot.id} did not map to a valid manifest: ${parsed.error.message}`);
        return null;
    }
    return parsed.data;
}

export interface PipelineSyncDeps {
    load?: PipelineLoader;
    enqueue?: ManifestEnqueue;
}

/** Load a pipeline, map it, and enqueue a code-to-docs job. Returns whether enqueued. */
export async function enqueuePipelineSync(pipelineId: number, deps: PipelineSyncDeps = {}): Promise<boolean> {
    const load = deps.load ?? loadPipelineSnapshot;
    const enqueue = deps.enqueue ?? enqueueCodeToDocs;

    const snapshot = await load(pipelineId);
    if (!snapshot) return false;
    if (snapshot.organizationId == null) {
        logger.warn(`Pipeline ${pipelineId} has no organization; skipping capability sync.`);
        return false;
    }
    const manifest = buildPipelineManifest(snapshot);
    if (!manifest) return false;

    await enqueue(snapshot.organizationId, manifest);
    return true;
}

/**
 * Fire-and-forget hook called from the pipeline save routes. Gated by
 * `ACDD_SYNC_PIPELINES`; never throws into the request path.
 */
export function onPipelineSaved(pipelineId: number): void {
    if (!envBool("ACDD_SYNC_PIPELINES")) return;
    if (!Number.isInteger(pipelineId)) return;
    void enqueuePipelineSync(pipelineId)
        .then((ok) => {
            if (ok) logger.info(`Enqueued canvas→docs for pipeline ${pipelineId}`);
        })
        .catch((err) => logger.warn(`Pipeline sync failed for ${pipelineId}: ${String(err)}`));
}
