/**
 * Durable target versions — what makes `expectedVersion` mean something.
 *
 * Before this, a change set's `expectedVersion` was a string with nothing
 * producing it, so the staleness check in the approval verifier had nothing
 * authoritative to compare against. §9.3 asks for a durable version table
 * rather than metadata-only history, for two reasons that both bite:
 *
 *  - the existing blueprint PATCH keeps at most ten metadata entries, and only
 *    while a cycle is active or paused, so the version a change set was
 *    authored against can vanish before it is applied;
 *  - rollback needs something to restore FROM, and "the previous state" is not
 *    a thing you can restore unless you wrote it down.
 *
 * Rows are immutable. A new state is a new row.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { createHash } from "node:crypto";

import { db } from "@server/database_service.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import {
    improvementTargetVersions,
    type ChangeTargetType,
    type ImprovementTargetVersion,
    type TargetVersionSource,
} from "@shared/schema/improvement/index.js";

const logger = createLogger("TargetVersionService");

/** `v{n}` — the form `expectedVersion` carries on a change set. */
export function formatVersion(versionNumber: number): string {
    return `v${versionNumber}`;
}

export function parseVersion(version: string): number | null {
    const m = /^v(\d+)$/.exec(version.trim());
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** Content hash of a snapshot, keys sorted at every depth. */
export function hashSnapshot(snapshot: Record<string, unknown>): string {
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
    return createHash("sha256").update(JSON.stringify(canonicalize(snapshot))).digest("hex");
}

export interface RecordVersionInput {
    targetType: ChangeTargetType;
    targetId: string;
    snapshot: Record<string, unknown>;
    source: TargetVersionSource;
    producedByChangeSetId?: number | null;
    createdBy: string;
}

export class TargetVersionService {
    private requireOrg(organizationId: number): number {
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            throw new BadRequestError("Target versions require a resolved organization.");
        }
        return organizationId;
    }

    /** The newest recorded version, or null if the target has never been snapshotted. */
    async current(
        organizationId: number,
        targetType: ChangeTargetType,
        targetId: string,
    ): Promise<ImprovementTargetVersion | null> {
        this.requireOrg(organizationId);
        const [row] = await db
            .select()
            .from(improvementTargetVersions)
            .where(and(
                eq(improvementTargetVersions.organizationId, organizationId),
                eq(improvementTargetVersions.targetType, targetType),
                eq(improvementTargetVersions.targetId, targetId),
            ))
            .orderBy(desc(improvementTargetVersions.versionNumber))
            .limit(1);
        return row ?? null;
    }

    /**
     * The version string a change set should be authored against.
     *
     * An unsnapshotted target returns `v0`, which no recorded version can match
     * — so a change set authored against a target nobody has captured fails the
     * staleness check rather than sailing through on a string nobody set.
     */
    async currentVersionString(
        organizationId: number,
        targetType: ChangeTargetType,
        targetId: string,
    ): Promise<string> {
        const row = await this.current(organizationId, targetType, targetId);
        return row ? formatVersion(row.versionNumber) : "v0";
    }

    /**
     * Append a new version.
     *
     * If the snapshot is byte-identical to the current one, the existing row is
     * returned rather than a duplicate written — re-recording an unchanged
     * target should not advance the version and invalidate every change set
     * authored against it.
     */
    async record(
        organizationId: number,
        input: RecordVersionInput,
    ): Promise<{ version: ImprovementTargetVersion; created: boolean }> {
        this.requireOrg(organizationId);
        if (!input.targetId?.trim()) throw new BadRequestError("targetId is required");

        const contentHash = hashSnapshot(input.snapshot);
        const latest = await this.current(organizationId, input.targetType, input.targetId);

        if (latest && latest.contentHash === contentHash) {
            return { version: latest, created: false };
        }

        const [row] = await db
            .insert(improvementTargetVersions)
            .values({
                organizationId,
                targetType: input.targetType,
                targetId: input.targetId.trim(),
                versionNumber: (latest?.versionNumber ?? 0) + 1,
                contentHash,
                snapshot: input.snapshot,
                source: input.source,
                producedByChangeSetId: input.producedByChangeSetId ?? null,
                createdBy: input.createdBy,
            })
            .returning();

        logger.info(
            `[Improvement] ${input.targetType}:${input.targetId} recorded as ${formatVersion(row.versionNumber)} (${input.source})`,
        );
        return { version: row, created: true };
    }

    /** Mark a version verified healthy after application. Only these are rollback targets. */
    async markVerified(
        organizationId: number,
        versionId: number,
    ): Promise<ImprovementTargetVersion> {
        this.requireOrg(organizationId);
        const [row] = await db
            .update(improvementTargetVersions)
            .set({ verifiedAt: new Date() })
            .where(and(
                eq(improvementTargetVersions.id, versionId),
                eq(improvementTargetVersions.organizationId, organizationId),
            ))
            .returning();
        if (!row) throw new NotFoundError(`Target version ${versionId} not found`);
        return row;
    }

    /**
     * The newest version that was verified healthy — the only safe rollback target.
     *
     * Restoring to "the previous version" is not a recovery if that version was
     * itself broken. Returns null when nothing has ever been verified, which is
     * a refusal to roll back rather than a licence to pick the latest.
     */
    async lastVerified(
        organizationId: number,
        targetType: ChangeTargetType,
        targetId: string,
    ): Promise<ImprovementTargetVersion | null> {
        this.requireOrg(organizationId);
        const [row] = await db
            .select()
            .from(improvementTargetVersions)
            .where(and(
                eq(improvementTargetVersions.organizationId, organizationId),
                eq(improvementTargetVersions.targetType, targetType),
                eq(improvementTargetVersions.targetId, targetId),
                isNotNull(improvementTargetVersions.verifiedAt),
            ))
            .orderBy(desc(improvementTargetVersions.versionNumber))
            .limit(1);
        return row ?? null;
    }

    async history(
        organizationId: number,
        targetType: ChangeTargetType,
        targetId: string,
        limit = 50,
    ): Promise<ImprovementTargetVersion[]> {
        this.requireOrg(organizationId);
        return db
            .select()
            .from(improvementTargetVersions)
            .where(and(
                eq(improvementTargetVersions.organizationId, organizationId),
                eq(improvementTargetVersions.targetType, targetType),
                eq(improvementTargetVersions.targetId, targetId),
            ))
            .orderBy(desc(improvementTargetVersions.versionNumber))
            .limit(limit);
    }
}

export const targetVersionService = new TargetVersionService();
