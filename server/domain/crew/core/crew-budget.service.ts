/**
 * Crew Budget Guard
 *
 * A round costs up to five model calls (speakers, plus the supervisor, plus a
 * tool follow-up), and nothing previously stopped a room running indefinitely.
 * Measured on this platform: 34 calls burned $0.85 in a few hours of testing.
 *
 * Spend is read from `llm_router_logs`, which already records real cost per
 * call, against the limits in `governance_budget_policies`.
 *
 * IMPORTANT — this does NOT call governanceService.checkBudget(). That method is
 * fail-closed: it returns `allowed: false` when no budget policy exists *or* the
 * agent has no salary allocation, and `governance_budget_policies` is currently
 * empty. Wiring it in directly would block every crew round in every
 * organisation — a regression wearing a safety feature's clothes.
 *
 * The rule here is the opposite, deliberately: an organisation that has
 * configured a limit gets it enforced; one that has not is not silently given a
 * limit nobody chose. Default-deny is right for tool admission, which is a
 * security boundary. It is wrong for budgets, where the absence of a policy
 * means "unmetered", not "forbidden".
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { governanceBudgetPolicies } from "@shared/schema/index.js";
import { llmRouterLogs } from "@shared/schema/ai/llm-router.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewBudgetService");

export interface BudgetVerdict {
    allowed: boolean;
    /** False when the org has set no policy — spend is unmetered, not blocked. */
    configured: boolean;
    spent: number;
    limit: number | null;
    /**
     * The unit the policy is denominated in. `governance_budget_policies.currency`
     * defaults to "tokens", and its limits are integers like 100000 — comparing
     * those against dollars would be meaningless, so spend is measured in
     * whatever unit the policy actually uses.
     */
    unit: string;
    /** 0-1 against the monthly limit; null when unconfigured. */
    utilization: number | null;
    /** True once past the alert threshold but still under the hard limit. */
    warning: boolean;
    reason?: string;
}

/** Formats an amount for a human, in the policy's own unit. */
function fmt(amount: number, unit: string): string {
    return unit === "tokens"
        ? `${Math.round(amount).toLocaleString()} tokens`
        : `${amount.toFixed(2)} ${unit.toUpperCase()}`;
}

/**
 * Start of the current budget period. `reset_day` is the day of month a policy
 * rolls over; before that day the period began last month.
 */
function periodStart(resetDay: number): Date {
    const now = new Date();
    const day = Math.min(Math.max(resetDay || 1, 1), 28);
    const start = new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0, 0);
    if (start > now) start.setMonth(start.getMonth() - 1);
    return start;
}

export class CrewBudgetService {
    /**
     * Whether this organisation may run another round.
     *
     * Best-effort: a failure to read spend returns `allowed`, because a broken
     * meter should not take the feature down with it.
     */
    async check(orgId: number): Promise<BudgetVerdict> {
        const open: BudgetVerdict = {
            allowed: true,
            configured: false,
            spent: 0,
            limit: null,
            unit: "tokens",
            utilization: null,
            warning: false,
        };

        try {
            const [policy] = await db
                .select()
                .from(governanceBudgetPolicies)
                .where(eq(governanceBudgetPolicies.organizationId, orgId))
                .limit(1);

            // No policy: unmetered by choice, not blocked by omission.
            if (!policy) return open;

            const monthlyLimit = Number(policy.monthlyLimit ?? 0);
            if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) return open;

            const since = periodStart(Number(policy.resetDay ?? 1));
            const unit = policy.currency ?? "tokens";

            // Measure in the policy's own unit — token limits against tokens,
            // currency limits against cost.
            const measure =
                unit === "tokens" ? llmRouterLogs.totalTokens : llmRouterLogs.cost;

            const [row] = await db
                .select({ spent: sql<string | null>`coalesce(sum(${measure}), 0)` })
                .from(llmRouterLogs)
                .where(
                    and(
                        eq(llmRouterLogs.organizationId, orgId),
                        gte(llmRouterLogs.createdAt, since),
                    ),
                );

            const spent = Number(row?.spent ?? 0);
            const utilization = spent / monthlyLimit;

            // hard_limit, when set, is the figure that actually stops work;
            // otherwise the monthly limit is the ceiling.
            const hardLimit = Number(policy.hardLimit ?? 0) || monthlyLimit;
            const alertAt = Number(policy.alertThreshold ?? 0.8);

            if (spent >= hardLimit) {
                logger.warn(
                    `Crew round blocked for org ${orgId}: ${fmt(spent, unit)} of ${fmt(hardLimit, unit)} used this period`,
                );
                return {
                    allowed: false,
                    configured: true,
                    spent,
                    limit: hardLimit,
                    unit,
                    utilization,
                    warning: false,
                    reason:
                        `This organization has used ${fmt(spent, unit)} of its ${fmt(hardLimit, unit)} ` +
                        `budget for the current period. Raise the limit or wait for the period to reset.`,
                };
            }

            return {
                allowed: true,
                configured: true,
                spent,
                limit: monthlyLimit,
                unit,
                utilization,
                warning: utilization >= alertAt,
            };
        } catch (err) {
            // A broken meter must not take the room down.
            logger.warn(
                `Budget check failed for org ${orgId}, allowing round: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return open;
        }
    }
}

export const crewBudgetService = new CrewBudgetService();
