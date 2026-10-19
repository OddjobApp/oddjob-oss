/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import { requireTestDatabaseUrl } from "../../../../tests/configure-test-environment.js";
import * as schema from "@shared/schema/index.js";
import {
    formatVersion,
    parseVersion,
    hashSnapshot,
} from "../core/target-version.service.js";
import { verifyApprovalIntegrity, computeChangeSetHash } from "../core/change-approval-integrity.service.js";

/**
 * Versions exist so `expectedVersion` names something checkable. These tests
 * run the real table, then feed a real version string into the approval
 * verifier — the point being that the two halves agree, not that each works
 * alone.
 */
describe("target versions against the real schema", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;
    let orgId: number;

    const targetType = "cycle_blueprint" as const;
    const targetId = `cycle-${Date.now()}`;

    beforeAll(async () => {
        pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 3 });
        db = drizzle(pool, { schema });
        const [org] = await db
            .insert(schema.orgs)
            .values({ name: `Versions ${Date.now()}`, slug: `versions_${Date.now()}` } as any)
            .returning();
        orgId = (org as any).id ?? (org as any).orgId;
    }, 60_000);

    afterAll(async () => {
        if (!pool) return;
        await db.delete(schema.improvementTargetVersions)
            .where(eq(schema.improvementTargetVersions.organizationId, orgId));
        await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
        await pool.end();
    }, 30_000);

    async function record(snapshot: Record<string, unknown>, versionNumber: number, verified = false) {
        const [row] = await db.insert(schema.improvementTargetVersions).values({
            organizationId: orgId,
            targetType,
            targetId,
            versionNumber,
            contentHash: hashSnapshot(snapshot),
            snapshot,
            source: "runtime_customization",
            createdBy: "test",
            verifiedAt: verified ? new Date() : null,
        } as any).returning();
        return row;
    }

    it("writes and reads a version through the real columns", async () => {
        const row = await record({ missions: ["a", "b"] }, 1, true);
        expect(row.versionNumber).toBe(1);
        expect(row.contentHash).toHaveLength(64);
        expect(row.snapshot).toEqual({ missions: ["a", "b"] });
        expect(row.verifiedAt).toBeInstanceOf(Date);
    });

    it("refuses a duplicate version number for the same target", async () => {
        await expect(record({ missions: ["x"] }, 1)).rejects.toThrow();
    });

    it("keeps history ordered and immutable", async () => {
        await record({ missions: ["a", "b", "c"] }, 2);
        const rows = await db
            .select()
            .from(schema.improvementTargetVersions)
            .where(eq(schema.improvementTargetVersions.organizationId, orgId));
        expect(rows.map(r => r.versionNumber).sort()).toEqual([1, 2]);
        // v1's snapshot is untouched by v2 existing.
        expect(rows.find(r => r.versionNumber === 1)!.snapshot).toEqual({ missions: ["a", "b"] });
    });

    it("only the verified version is a rollback target", async () => {
        const rows = await db
            .select()
            .from(schema.improvementTargetVersions)
            .where(eq(schema.improvementTargetVersions.organizationId, orgId));
        const verified = rows.filter(r => r.verifiedAt !== null);
        expect(verified).toHaveLength(1);
        expect(verified[0].versionNumber).toBe(1);
    });

    describe("versions and the approval verifier agree", () => {
        const operations = [{ kind: "update_limits" as const, payload: { maxCases: 20 } }];

        function changeSetAt(expectedVersion: string) {
            const hash = computeChangeSetHash({ targetType, targetId, expectedVersion, operations });
            return {
                id: 1, organizationId: orgId, projectId: null, opportunityId: null,
                targetType, targetId, expectedVersion,
                reason: "r", evidenceIds: [], operations,
                validationPlan: {}, rolloutPlan: {}, rollbackPlan: {},
                status: "approved" as const, contentHash: hash,
                approvalRequestId: 1, approvedContentHash: hash, approvedBy: "u", approvedAt: new Date(),
                approvalExpiresAt: null, selectedRemediation: null,
                appliedAt: null, verifiedAt: null, rolledBackAt: null, failureReason: null,
                createdBy: "t", createdAt: new Date(), updatedAt: new Date(),
            } as any;
        }

        const approvalFor = (hash: string) => ({
            id: 1, organizationId: orgId, projectId: null,
            approvedContentHash: hash, decision: "approved" as const, decidedAt: new Date(),
            approverId: "u", approverHasAuthority: true, expiresAt: null, revokedAt: null,
            selectedRemediation: null,
        });

        it("permits a change set authored against the current version", async () => {
            const current = formatVersion(2); // history above ends at v2
            const cs = changeSetAt(current);
            const r = verifyApprovalIntegrity({
                changeSet: cs, approval: approvalFor(cs.contentHash), currentTargetVersion: current,
            });
            expect(r.ok).toBe(true);
        });

        // The whole reason the table exists.
        it("refuses one authored against a version the target has moved past", async () => {
            const cs = changeSetAt(formatVersion(1));
            const r = verifyApprovalIntegrity({
                changeSet: cs, approval: approvalFor(cs.contentHash), currentTargetVersion: formatVersion(2),
            });
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.failures.map(f => f.code)).toContain("STALE_TARGET_VERSION");
        });

        // An unsnapshotted target reports v0, which no real version matches.
        it("refuses a change set against a target nobody has captured", async () => {
            const cs = changeSetAt(formatVersion(3));
            const r = verifyApprovalIntegrity({
                changeSet: cs, approval: approvalFor(cs.contentHash), currentTargetVersion: "v0",
            });
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.failures.map(f => f.code)).toContain("STALE_TARGET_VERSION");
        });
    });
});

describe("version string handling", () => {
    it("round-trips", () => {
        expect(parseVersion(formatVersion(7))).toBe(7);
    });

    it.each(["", "v", "v0", "vx", "7", "v-1", "v1.2"])("rejects %s", (v) => {
        expect(parseVersion(v)).toBeNull();
    });

    it("hashes snapshots independently of key order", () => {
        expect(hashSnapshot({ a: 1, b: { c: 2, d: 3 } }))
            .toBe(hashSnapshot({ b: { d: 3, c: 2 }, a: 1 }));
    });
});
