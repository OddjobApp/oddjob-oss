/**
 * Records capabilities that an agent tried to use and could not.
 *
 * This is the emitter behind `capability_gap_events`. Two rules govern it, and
 * both exist because of how the gap was previously lost:
 *
 * 1. **Classification is mechanical.** `failureClass` is derived from two
 *    booleans supplied by the call site, never inferred from an error message.
 *    The old guard produced one string — "not found or not allowed" — for two
 *    different facts, so a permission denial and a missing capability were
 *    indistinguishable downstream.
 * 2. **Emission never becomes a failure path.** A capability gap is telemetry.
 *    If recording it throws, the caller must still return exactly what it would
 *    have returned. Nothing here is allowed to change control flow.
 */

import { createHash } from "node:crypto";

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    capabilityGapEvents,
    type CapabilityGapFailureClass,
    type CapabilityGapRunRefSource,
} from "@shared/schema/capabilities/index.js";

const logger = createLogger("CapabilityGapEvents");

/** Identity fields available at a tool call site. */
export interface CapabilityGapRunIdentity {
    organizationId: unknown;
    projectId?: number | null;
    missionId?: number | null;
    /** Pipeline/step execution id — the most specific "one run" we carry. */
    executionId?: number | null;
    /** W3C trace id, when tracing is active. */
    traceId?: string | null;
    /**
     * The acting user's id. Hashed before storage — never persisted in the
     * clear — because the score needs a DISTINCT count and nothing else.
     */
    userId?: string | null;
}

/**
 * Stable, non-reversible actor key.
 *
 * Same user, same hash, so `count(distinct)` works; the id itself does not
 * survive into the telemetry. Not a secret-grade construction and not meant to
 * be — it exists so an operations metric cannot become a record of who
 * personally hit a missing tool.
 */
export function hashActor(userId: string | null | undefined): string | null {
    const trimmed = userId?.trim();
    if (!trimmed) return null;
    return createHash("sha256").update(`capability-gap-actor:${trimmed}`).digest("hex").slice(0, 32);
}

export interface RecordCapabilityGapInput extends CapabilityGapRunIdentity {
    /** The tool name as the model wrote it. */
    requestedToolName: string;
    /** `normalizeToolName` result, when it resolved to a registered tool. */
    canonicalToolName?: string | null;
    /** The tool exists in the registry. */
    registryHit: boolean;
    /** The tool was in this run's permitted allotment. */
    allotmentHit: boolean;
    /**
     * Overrides the derived class. Only for gaps that do not originate at the
     * registry/allotment guard — an authorization denial raised by a governance
     * or guardrail check, for example. Folding those into the guard would
     * recreate exactly the conflation this service exists to remove.
     */
    failureClassOverride?: CapabilityGapFailureClass;
}

/** Counts events dropped for want of a resolvable tenant (§15 observability). */
let rejectedForUnresolvedOrg = 0;

export function capabilityGapRejectionCount(): number {
    return rejectedForUnresolvedOrg;
}

/** Test seam. */
export function resetCapabilityGapRejectionCount(): void {
    rejectedForUnresolvedOrg = 0;
}

/**
 * The classification table, in one place.
 *
 * | registryHit | allotmentHit | class         |
 * | ----------- | ------------ | ------------- |
 * | false       | false        | `missing`     |
 * | true        | false        | `unavailable` |
 * | true        | true         | not reachable |
 *
 * A registry miss cannot also be an allotment hit, so that row is impossible
 * rather than merely unused.
 */
export function classifyCapabilityGap(
    registryHit: boolean,
    allotmentHit: boolean,
): CapabilityGapFailureClass {
    if (!registryHit) return "missing";
    if (!allotmentHit) return "unavailable";
    // Both true means the tool was usable; the caller should not have emitted.
    return "incompatible";
}

/**
 * Resolve the run identity used for per-run deduplication.
 *
 * Preference is most-specific-first. `jobId` is deliberately absent: jobs are
 * keyed by name and reused across cycles, so a job id names a definition rather
 * than one execution of it, and counting by it would merge unrelated runs.
 */
export function resolveRunRef(
    identity: CapabilityGapRunIdentity,
): { runRef: string | null; runRefSource: CapabilityGapRunRefSource | null } {
    if (typeof identity.executionId === "number" && Number.isFinite(identity.executionId)) {
        return { runRef: `execution:${identity.executionId}`, runRefSource: "execution" };
    }
    if (typeof identity.missionId === "number" && Number.isFinite(identity.missionId)) {
        return { runRef: `mission:${identity.missionId}`, runRefSource: "mission" };
    }
    if (typeof identity.traceId === "string" && identity.traceId.trim()) {
        return { runRef: `trace:${identity.traceId.trim()}`, runRefSource: "trace" };
    }
    return { runRef: null, runRefSource: null };
}

/**
 * Record one capability gap.
 *
 * Fire-and-forget by contract: the returned promise is already guarded, so
 * callers may ignore it. It is started before the caller returns rather than
 * queued for a later flush — a crashing run would otherwise lose precisely the
 * evidence this exists to capture.
 */
export async function recordCapabilityGap(input: RecordCapabilityGapInput): Promise<void> {
    try {
        const organizationId = Number(input.organizationId);
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            // Drop rather than default. Writing this under organization 1 would
            // put one tenant's execution gap in another tenant's evidence.
            rejectedForUnresolvedOrg += 1;
            logger.warn(
                `Dropped capability-gap event for '${input.requestedToolName}': no organization resolved.`,
            );
            return;
        }

        const failureClass =
            input.failureClassOverride ?? classifyCapabilityGap(input.registryHit, input.allotmentHit);
        const { runRef, runRefSource } = resolveRunRef(input);

        await db.insert(capabilityGapEvents).values({
            organizationId,
            projectId: input.projectId ?? null,
            missionId: input.missionId ?? null,
            runRef,
            runRefSource,
            actorUserHash: hashActor(input.userId),
            requestedToolName: input.requestedToolName,
            canonicalToolName: input.canonicalToolName ?? null,
            failureClass,
            registryHit: input.registryHit,
            allotmentHit: input.allotmentHit,
        });
    } catch (error) {
        // Never propagate. A gap is an observation about a failure, not a new one.
        logger.error(
            `Failed to record capability-gap event for '${input.requestedToolName}': ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}
