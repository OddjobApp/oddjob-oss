/**
 * Policy Violation Service
 *
 * Persistent write/read path for capability policy violations.
 *
 * WRITE: Called by CapabilityPolicyLoader whenever a check() evaluates
 *        (regardless of outcome — both blocked and warned events are recorded).
 *
 * READ:  Called by the Governor API to surface violation logs in the UI.
 *
 * The service is a thin wrapper around the `policy_violations` table.
 * All heavy aggregation (e.g. trend analysis) is deferred to the query layer.
 */

import { db } from '@server/database_service.js';
import { policyViolations } from '@shared/schema/policy-violations.js';
import { eq, desc, and, gte, type SQL } from 'drizzle-orm';
import { createLogger } from '@server/utils/logger.js';
import type { NewPolicyViolation, PolicyViolationRecord } from '@shared/schema/policy-violations.js';

const logger = createLogger('PolicyViolationService');

// ---------------------------------------------------------------------------
// Query filter type
// ---------------------------------------------------------------------------

export interface ViolationFilter {
    organizationId: number;
    /** Return only blocked (true) or warned (false) violations. Omit for all. */
    blockedOnly?: boolean;
    /** Return only unresolved violations. */
    unresolvedOnly?: boolean;
    /** Return violations after this timestamp (ISO string). */
    since?: string;
    /** Maximum number of records to return (default 100, max 500). */
    limit?: number;
    /** Check type filter: 'tool' | 'filePath' | 'network' | 'model' */
    checkType?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PolicyViolationService {
    /**
     * Record a capability policy check outcome.
     * Fire-and-forget — errors are swallowed so as not to interrupt agent execution.
     */
    async record(violation: NewPolicyViolation): Promise<void> {
        try {
            await db.insert(policyViolations).values(violation);
        } catch (err: any) {
            logger.error(`[PolicyViolationService] Failed to record violation: ${err.message}`);
        }
    }

    /**
     * Bulk-record multiple violations in a single INSERT for efficiency.
     */
    async recordBatch(violations: NewPolicyViolation[]): Promise<void> {
        if (violations.length === 0) return;
        try {
            await db.insert(policyViolations).values(violations);
        } catch (err: any) {
            logger.error(`[PolicyViolationService] Batch insert failed: ${err.message}`);
        }
    }

    /**
     * Query violations for an organization.
     */
    async list(filter: ViolationFilter): Promise<PolicyViolationRecord[]> {
        const conditions: SQL[] = [
            eq(policyViolations.organizationId, filter.organizationId),
        ];

        if (filter.blockedOnly === true) {
            conditions.push(eq(policyViolations.blocked, true));
        }

        if (filter.unresolvedOnly === true) {
            conditions.push(eq(policyViolations.resolved, false));
        }

        if (filter.checkType) {
            conditions.push(eq(policyViolations.checkType, filter.checkType));
        }

        if (filter.since) {
            const sinceDate = new Date(filter.since);
            if (!isNaN(sinceDate.getTime())) {
                conditions.push(gte(policyViolations.occurredAt, sinceDate));
            }
        }

        const limit = Math.min(filter.limit ?? 100, 500);

        return db
            .select()
            .from(policyViolations)
            .where(and(...conditions))
            .orderBy(desc(policyViolations.occurredAt))
            .limit(limit);
    }

    /**
     * Mark a violation as resolved (acknowledged by an admin).
     */
    async resolve(id: number, organizationId: number): Promise<boolean> {
        try {
            const result = await db
                .update(policyViolations)
                .set({ resolved: true })
                .where(
                    and(
                        eq(policyViolations.id, id),
                        eq(policyViolations.organizationId, organizationId)
                    )
                )
                .returning({ id: policyViolations.id });

            return result.length > 0;
        } catch (err: any) {
            logger.error(`[PolicyViolationService] resolve() failed for id=${id}: ${err.message}`);
            return false;
        }
    }

    /**
     * Quick summary stats for the dashboard widget.
     */
    async summary(organizationId: number): Promise<{
        totalLast24h: number;
        blockedLast24h: number;
        unresolvedTotal: number;
    }> {
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [all24h, blocked24h, unresolved] = await Promise.all([
            this.list({ organizationId, since: since24h.toISOString(), limit: 500 }),
            this.list({ organizationId, since: since24h.toISOString(), blockedOnly: true, limit: 500 }),
            this.list({ organizationId, unresolvedOnly: true, limit: 500 }),
        ]);

        return {
            totalLast24h:    all24h.length,
            blockedLast24h:  blocked24h.length,
            unresolvedTotal: unresolved.length,
        };
    }
}

export const policyViolationService = new PolicyViolationService();
