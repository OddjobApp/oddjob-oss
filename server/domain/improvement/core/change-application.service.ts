/**
 * §9.2 / §9.8 apply orchestration.
 *
 * The sequence the spec sets out, in one place:
 *
 *   verify approval → validate structure → quiesce → apply approved hash →
 *   record new version → verify runtime → resume, or roll back
 *
 * Three properties this file exists to guarantee, none of which can be turned
 * off by a caller:
 *
 * 1. **The flag defaults OFF, and the disabled path REFUSES.** It does not fall
 *    through to a direct mutation. A disabled feature that silently degrades
 *    into the unguarded version is worse than one that never shipped.
 *
 * 2. **There is no bypass parameter.** Every apply passes approval integrity
 *    and structural validation. If an executor needs an escape hatch, that is a
 *    design problem, not a flag.
 *
 * 3. **No mutators are registered by default.** The registry ships empty, so
 *    apply refuses with NO_MUTATOR until someone deliberately registers one for
 *    a target type. The pipeline is complete and tested; the ability to change
 *    a real blueprint, schedule, pipeline or app is a separate, explicit act.
 *
 * On failed verification the target is left QUIESCED, not resumed. §9.8:
 * "failed verification leaves the target paused until rollback succeeds or a
 * human intervenes." Resuming a target that failed its own health check is how
 * a bad change becomes a bad day.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    improvementChangeSets,
    type ChangeOperation,
    type ChangeTargetType,
    type ImprovementChangeSet,
} from "@shared/schema/improvement/index.js";

import {
    verifyApprovalIntegrity,
    type IntegrityFailure,
    type ResolvedApproval,
} from "./change-approval-integrity.service.js";
import {
    validateBlueprintChange,
    type BlueprintRefusal,
    type BlueprintSnapshot,
    type RuntimeState,
} from "./blueprint-evolution-validator.service.js";
import { targetVersionService } from "./target-version.service.js";

const logger = createLogger("ChangeApplication");

/** Off unless explicitly enabled. §24.2. */
export function changeSetsEnabled(): boolean {
    return process.env.IMPROVEMENT_CHANGE_SETS_ENABLED === "true";
}

/**
 * What a target type must provide before anything can be applied to it.
 *
 * Every method is a real operation against a real target, which is why none is
 * supplied here. Registering one is the moment a target becomes mutable.
 */
export interface TargetMutator {
    targetType: ChangeTargetType;
    /** Current state, for validation and for the pre-change version record. */
    snapshot(organizationId: number, targetId: string): Promise<BlueprintSnapshot>;
    /** What the target is doing right now. */
    runtimeState(organizationId: number, targetId: string): Promise<RuntimeState>;
    /** Pause at a safe checkpoint. Returns false if it could not be paused. */
    quiesce(organizationId: number, targetId: string): Promise<boolean>;
    /** Apply the approved operations. Throws on failure. */
    apply(organizationId: number, targetId: string, operations: ChangeOperation[]): Promise<void>;
    /** Health check after apply. False means roll back. */
    verify(organizationId: number, targetId: string): Promise<boolean>;
    /** Restore a previously verified snapshot. Throws if it cannot. */
    restore(organizationId: number, targetId: string, snapshot: Record<string, unknown>): Promise<void>;
    /** Return to normal operation. */
    resume(organizationId: number, targetId: string): Promise<void>;
}

/** Empty on purpose. See the file header. */
const mutators = new Map<ChangeTargetType, TargetMutator>();

export function registerTargetMutator(mutator: TargetMutator): void {
    mutators.set(mutator.targetType, mutator);
    logger.warn(
        `[Improvement] Target mutator registered for '${mutator.targetType}'. This target is now mutable by an approved change set.`,
    );
}

export function clearTargetMutators(): void {
    mutators.clear();
}

export function registeredMutatorTypes(): ChangeTargetType[] {
    return [...mutators.keys()];
}

export type ApplyRefusalCode =
    | "FEATURE_DISABLED"
    | "NO_MUTATOR"
    | "APPROVAL_INTEGRITY"
    | "STRUCTURAL_VALIDATION"
    | "QUIESCE_FAILED";

export type ApplyOutcome =
    | { status: "refused"; code: ApplyRefusalCode; reasons: string[] }
    | { status: "verified"; versionId: number }
    | { status: "rolled_back"; reason: string; restoredVersionId: number }
    | { status: "paused_for_human"; reason: string };

export interface ApplyInput {
    organizationId: number;
    changeSetId: number;
    /** Resolved SEPARATELY from the approvals store — never from a payload. */
    resolveApproval: (approvalRequestId: number | null) => Promise<ResolvedApproval | null>;
    now?: Date;
}

export class ChangeApplicationService {
    /**
     * Apply an approved change set, or explain precisely why not.
     *
     * Refusals are cheap and reversible; a wrong apply is neither. Every gate
     * below runs before the target is touched.
     */
    async apply(input: ApplyInput): Promise<ApplyOutcome> {
        const { organizationId, changeSetId } = input;

        if (!changeSetsEnabled()) {
            return {
                status: "refused",
                code: "FEATURE_DISABLED",
                reasons: [
                    "IMPROVEMENT_CHANGE_SETS_ENABLED is not 'true'. Change-set application is disabled and refuses rather than falling back to a direct mutation.",
                ],
            };
        }

        const [changeSet] = await db
            .select()
            .from(improvementChangeSets)
            .where(and(
                eq(improvementChangeSets.id, changeSetId),
                eq(improvementChangeSets.organizationId, organizationId),
            ));
        if (!changeSet) {
            return { status: "refused", code: "APPROVAL_INTEGRITY", reasons: [`Change set ${changeSetId} not found.`] };
        }

        const mutator = mutators.get(changeSet.targetType);
        if (!mutator) {
            return {
                status: "refused",
                code: "NO_MUTATOR",
                reasons: [
                    `No mutator is registered for target type '${changeSet.targetType}', so nothing can be applied to it. Registering one is a deliberate act.`,
                ],
            };
        }

        // ── gate 1: approval integrity, against the LIVE target version ─────
        const currentTargetVersion = await targetVersionService.currentVersionString(
            organizationId, changeSet.targetType, changeSet.targetId,
        );
        const approval = await input.resolveApproval(changeSet.approvalRequestId);
        const integrity = verifyApprovalIntegrity({
            changeSet, approval, currentTargetVersion, now: input.now,
        });
        if (!integrity.ok) {
            return {
                status: "refused",
                code: "APPROVAL_INTEGRITY",
                reasons: integrity.failures.map((f: IntegrityFailure) => `${f.code}: ${f.reason}`),
            };
        }

        // ── gate 2: structural validation against the projected result ──────
        const snapshot = await mutator.snapshot(organizationId, changeSet.targetId);
        const runtime = await mutator.runtimeState(organizationId, changeSet.targetId);
        const structural = validateBlueprintChange(snapshot, changeSet.operations, runtime);
        if (!structural.ok) {
            return {
                status: "refused",
                code: "STRUCTURAL_VALIDATION",
                reasons: structural.refusals.map((r: BlueprintRefusal) => `${r.code} (${r.missionId}): ${r.reason}`),
            };
        }

        // Snapshot the pre-change state so rollback has a verified target.
        const before = await targetVersionService.record(organizationId, {
            targetType: changeSet.targetType,
            targetId: changeSet.targetId,
            snapshot: snapshot as unknown as Record<string, unknown>,
            source: "runtime_customization",
            createdBy: "change-application",
        });
        if (!before.version.verifiedAt) {
            await targetVersionService.markVerified(organizationId, before.version.id);
        }

        // ── gate 3: quiesce ─────────────────────────────────────────────────
        const quiesced = await mutator.quiesce(organizationId, changeSet.targetId);
        if (!quiesced) {
            return {
                status: "refused",
                code: "QUIESCE_FAILED",
                reasons: ["The target could not be paused at a safe checkpoint, so nothing was applied."],
            };
        }

        await this.setStatus(organizationId, changeSetId, "applying");

        // ── apply ───────────────────────────────────────────────────────────
        try {
            await mutator.apply(organizationId, changeSet.targetId, changeSet.operations);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.error(`[Improvement] Apply failed for change set ${changeSetId}: ${reason}`);
            return this.rollback(input, changeSet, mutator, `Apply failed: ${reason}`);
        }

        await db.update(improvementChangeSets)
            .set({ status: "applied", appliedAt: new Date(), updatedAt: new Date() })
            .where(eq(improvementChangeSets.id, changeSetId));

        // ── verify ──────────────────────────────────────────────────────────
        let healthy = false;
        try {
            healthy = await mutator.verify(organizationId, changeSet.targetId);
        } catch (error) {
            healthy = false;
            logger.error(
                `[Improvement] Verification threw for change set ${changeSetId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        if (!healthy) {
            return this.rollback(input, changeSet, mutator, "Runtime verification failed after apply.");
        }

        // Healthy: record and mark the new version verified, then resume.
        const after = await targetVersionService.record(organizationId, {
            targetType: changeSet.targetType,
            targetId: changeSet.targetId,
            snapshot: (await mutator.snapshot(organizationId, changeSet.targetId)) as unknown as Record<string, unknown>,
            source: "runtime_customization",
            producedByChangeSetId: changeSetId,
            createdBy: "change-application",
        });
        await targetVersionService.markVerified(organizationId, after.version.id);

        await db.update(improvementChangeSets)
            .set({ status: "verified", verifiedAt: new Date(), updatedAt: new Date() })
            .where(eq(improvementChangeSets.id, changeSetId));

        await mutator.resume(organizationId, changeSet.targetId);
        logger.info(`[Improvement] Change set ${changeSetId} applied and verified.`);
        return { status: "verified", versionId: after.version.id };
    }

    /**
     * Restore the last VERIFIED version.
     *
     * The target stays quiesced throughout, and stays quiesced if restore
     * fails: §9.8 leaves a target paused until rollback succeeds or a human
     * intervenes. Resuming a target that failed its own health check is how a
     * bad change becomes a bad day.
     */
    private async rollback(
        input: ApplyInput,
        changeSet: ImprovementChangeSet,
        mutator: TargetMutator,
        reason: string,
    ): Promise<ApplyOutcome> {
        const { organizationId } = input;

        const target = await targetVersionService.lastVerified(
            organizationId, changeSet.targetType, changeSet.targetId,
        );
        if (!target) {
            await this.fail(organizationId, changeSet.id, `${reason} No verified version exists to restore.`);
            return {
                status: "paused_for_human",
                reason: `${reason} No verified version exists to restore, so the target is left paused.`,
            };
        }

        try {
            await mutator.restore(organizationId, changeSet.targetId, target.snapshot);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            await this.fail(organizationId, changeSet.id, `${reason} Rollback also failed: ${detail}`);
            return {
                status: "paused_for_human",
                reason: `${reason} Rollback to ${target.versionNumber} also failed (${detail}); the target remains paused.`,
            };
        }

        await db.update(improvementChangeSets)
            .set({
                status: "rolled_back",
                rolledBackAt: new Date(),
                failureReason: reason,
                updatedAt: new Date(),
            })
            .where(eq(improvementChangeSets.id, changeSet.id));

        // Resume only because the target is back at a state known to be healthy.
        await mutator.resume(organizationId, changeSet.targetId);
        logger.warn(`[Improvement] Change set ${changeSet.id} rolled back to v${target.versionNumber}: ${reason}`);

        return { status: "rolled_back", reason, restoredVersionId: target.id };
    }

    private async setStatus(organizationId: number, id: number, status: ImprovementChangeSet["status"]) {
        await db.update(improvementChangeSets)
            .set({ status, updatedAt: new Date() })
            .where(and(
                eq(improvementChangeSets.id, id),
                eq(improvementChangeSets.organizationId, organizationId),
            ));
    }

    private async fail(organizationId: number, id: number, failureReason: string) {
        await db.update(improvementChangeSets)
            .set({ status: "failed", failureReason, updatedAt: new Date() })
            .where(and(
                eq(improvementChangeSets.id, id),
                eq(improvementChangeSets.organizationId, organizationId),
            ));
    }
}

export const changeApplicationService = new ChangeApplicationService();
