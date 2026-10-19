/**
 * §9.7 approval integrity — the gate every mutation passes through.
 *
 * The rule this enforces, stated once so it cannot be argued with elsewhere:
 *
 *   **An approval is a resolved record, checked at apply time. A timestamp,
 *   an `approved: true`, or an approver name carried INSIDE a proposal payload
 *   is not authority and is never treated as such.**
 *
 * That is not a hypothetical distinction. A self-modification executor that
 * reads `payload.approvedAt` and proceeds has granted itself permission from a
 * field the proposer wrote. Everything below exists to make that impossible:
 * the verifier takes the change set and a SEPARATELY-resolved approval record,
 * and refuses unless all eight conditions hold together.
 *
 * Every refusal is a distinct, named reason. "Not authorized" is useless to the
 * operator who has to fix it.
 */

import { createHash } from "node:crypto";

import type {
    ChangeOperation,
    ChangeSetStatus,
    ImprovementChangeSet,
} from "@shared/schema/improvement/index.js";

/** The authoritative approval record, resolved from the approvals store. */
export interface ResolvedApproval {
    id: number;
    organizationId: number | null;
    projectId?: number | null;
    /** The hash the approver actually approved. */
    approvedContentHash: string | null;
    /** Terminal decision. Anything else is not an approval. */
    decision: "approved" | "rejected" | "pending" | "snoozed" | "expired" | string;
    decidedAt: Date | null;
    approverId: string | null;
    /** Whether the approver held the authority the change required. */
    approverHasAuthority: boolean;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    selectedRemediation?: string | null;
}

export type IntegrityRefusalCode =
    | "NO_APPROVAL_RECORD"
    | "NOT_TERMINAL_APPROVAL"
    | "HASH_MISMATCH"
    | "ORG_MISMATCH"
    | "PROJECT_MISMATCH"
    | "APPROVER_LACKS_AUTHORITY"
    | "APPROVAL_EXPIRED"
    | "APPROVAL_REVOKED"
    | "STALE_TARGET_VERSION"
    | "REMEDIATION_MISMATCH"
    | "WRONG_STATUS";

export interface IntegrityFailure {
    code: IntegrityRefusalCode;
    reason: string;
}

export type IntegrityResult =
    | { ok: true }
    | { ok: false; failures: IntegrityFailure[] };

/**
 * Deterministic hash over everything that EXECUTES.
 *
 * `reason`, plans and evidence are deliberately excluded: they are context for
 * a human, and letting prose changes invalidate an approval would train people
 * to re-approve reflexively. Operations, target and expected version are in,
 * because changing any of them changes what runs.
 *
 * Keys are sorted at every depth so serialization order cannot alter identity.
 */
export function computeChangeSetHash(input: {
    targetType: string;
    targetId: string;
    expectedVersion: string;
    operations: ChangeOperation[];
}): string {
    const canonicalize = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(canonicalize);
        if (v && typeof v === "object") {
            return Object.keys(v as Record<string, unknown>)
                .sort()
                .reduce<Record<string, unknown>>((acc, k) => {
                    acc[k] = canonicalize((v as Record<string, unknown>)[k]);
                    return acc;
                }, {});
        }
        return v;
    };

    return createHash("sha256")
        .update(JSON.stringify(canonicalize({
            targetType: input.targetType,
            targetId: input.targetId,
            expectedVersion: input.expectedVersion,
            operations: input.operations,
        })))
        .digest("hex");
}

/** Statuses from which an apply may legally begin. */
const APPLIABLE_STATUSES: ReadonlySet<ChangeSetStatus> = new Set(["approved"]);

export interface VerifyInput {
    changeSet: ImprovementChangeSet;
    /**
     * Resolved from the approvals store by id — NOT read off the change set,
     * and never taken from a request payload.
     */
    approval: ResolvedApproval | null;
    /** The target's CURRENT version, read from the target at apply time. */
    currentTargetVersion: string;
    now?: Date;
}

/**
 * Decide whether this change set may be applied right now.
 *
 * Collects every failure rather than returning the first, so an operator sees
 * the whole picture instead of fixing one condition at a time.
 */
export function verifyApprovalIntegrity(input: VerifyInput): IntegrityResult {
    const { changeSet, approval, currentTargetVersion } = input;
    const now = input.now ?? new Date();
    const failures: IntegrityFailure[] = [];
    const fail = (code: IntegrityRefusalCode, reason: string) => failures.push({ code, reason });

    if (!APPLIABLE_STATUSES.has(changeSet.status)) {
        fail("WRONG_STATUS", `Change set is '${changeSet.status}'; only an approved change set may be applied.`);
    }

    // The recomputed hash is authoritative over the stored one: a stored hash
    // could have been written alongside tampered operations.
    const actualHash = computeChangeSetHash({
        targetType: changeSet.targetType,
        targetId: changeSet.targetId,
        expectedVersion: changeSet.expectedVersion,
        operations: changeSet.operations,
    });

    if (!approval) {
        fail(
            "NO_APPROVAL_RECORD",
            "No approval record resolved. An approval timestamp or flag inside the change set is not authority.",
        );
        // Without a record there is nothing to compare; still check staleness.
        if (currentTargetVersion !== changeSet.expectedVersion) {
            fail(
                "STALE_TARGET_VERSION",
                `Target is at '${currentTargetVersion}' but this was authored against '${changeSet.expectedVersion}'.`,
            );
        }
        return { ok: false, failures };
    }

    if (approval.decision !== "approved") {
        fail("NOT_TERMINAL_APPROVAL", `Approval record is '${approval.decision}', not a terminal approval.`);
    }
    if (!approval.decidedAt) {
        fail("NOT_TERMINAL_APPROVAL", "Approval record carries no decision time.");
    }

    if (!approval.approvedContentHash) {
        fail("HASH_MISMATCH", "The approval records no content hash, so it cannot authorize any particular change.");
    } else if (approval.approvedContentHash !== actualHash) {
        fail(
            "HASH_MISMATCH",
            `Approved hash ${approval.approvedContentHash.slice(0, 12)}… does not match the change set's current hash ${actualHash.slice(0, 12)}…. The operations changed after approval.`,
        );
    }

    if (approval.organizationId !== changeSet.organizationId) {
        fail(
            "ORG_MISMATCH",
            `Approval belongs to organization ${approval.organizationId}, change set to ${changeSet.organizationId}.`,
        );
    }

    const approvalProject = approval.projectId ?? null;
    const changeProject = changeSet.projectId ?? null;
    if (approvalProject !== changeProject) {
        fail("PROJECT_MISMATCH", `Approval project ${approvalProject} does not match change set project ${changeProject}.`);
    }

    if (!approval.approverHasAuthority) {
        fail(
            "APPROVER_LACKS_AUTHORITY",
            `Approver '${approval.approverId ?? "unknown"}' did not hold the authority this change requires.`,
        );
    }

    if (approval.revokedAt) {
        fail("APPROVAL_REVOKED", `Approval was revoked at ${approval.revokedAt.toISOString()}.`);
    }
    if (approval.expiresAt && approval.expiresAt.getTime() <= now.getTime()) {
        fail("APPROVAL_EXPIRED", `Approval expired at ${approval.expiresAt.toISOString()}.`);
    }

    // A selected remediation must be the thing applied. Approving remediation B
    // and then applying proposal A is the failure §9.2 calls out by name.
    const selected = approval.selectedRemediation ?? null;
    if (selected !== (changeSet.selectedRemediation ?? null)) {
        fail(
            "REMEDIATION_MISMATCH",
            `The approver selected remediation '${selected ?? "none"}', but this change set carries '${changeSet.selectedRemediation ?? "none"}'.`,
        );
    }

    if (currentTargetVersion !== changeSet.expectedVersion) {
        fail(
            "STALE_TARGET_VERSION",
            `Target is at '${currentTargetVersion}' but this was authored against '${changeSet.expectedVersion}'. Re-author against the current version.`,
        );
    }

    return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

export class ApprovalIntegrityError extends Error {
    constructor(readonly failures: IntegrityFailure[]) {
        super(`Refusing to apply change set: ${failures.map(f => f.code).join(", ")}`);
        this.name = "ApprovalIntegrityError";
    }
}

export function assertApprovalIntegrity(input: VerifyInput): void {
    const result = verifyApprovalIntegrity(input);
    if (!result.ok) throw new ApprovalIntegrityError(result.failures);
}
