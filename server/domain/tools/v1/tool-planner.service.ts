/**
 * Cost-aware action planning for the agent loop (ToolChain*, adapted).
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a textbook A* that searches a tool tree offline. Two properties of this
 * system make that impossible, and pretending otherwise would produce a planner
 * that looks rigorous and quietly misbehaves:
 *
 *   1. The goal test is an LLM call. The loop terminates on `thought.isFinal`
 *      (agent-orchestrator.ts:274), so "is this state a goal?" cannot be
 *      evaluated for a frontier of hypothetical states — only for states the
 *      model has actually been asked about.
 *   2. Tools have side effects and there is no simulator. You cannot expand a
 *      node by calling trigger_pipeline and then backtrack; the pipeline ran.
 *
 * WHAT THIS IS
 * ------------
 * The tractable core of ToolChain* for this architecture: best-first selection
 * over the alternatives the model actually proposes, priced with measured cost
 * (tool-cost-model.service.ts), under an explicit cost budget.
 *
 * That addresses the real failure mode. The loop today runs `while
 * (currentIteration < maxIterations)` with a cap of 20, taking the model's
 * actions in whatever order they arrive and treating a 1ms status check and a
 * 7s pipeline trigger as equally cheap. Tool-heavy tasks exhaust the cap rather
 * than converging.
 *
 * SAFETY
 * ------
 * Speculation is fail-closed. Only tools explicitly declaring `read-safe` or
 * `idempotent` may be executed speculatively; anything else — including the 349
 * of 392 registered tools that declare no idempotency at all — is treated as
 * side-effecting. An undeclared tool is never assumed safe.
 */
import type { ToolCost, ToolCostTable } from "./tool-cost-model.service.js";
import { toolCostModelService } from "./tool-cost-model.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToolPlanner");

/** A tool action the model has proposed. */
export interface CandidateAction {
    toolName: string;
    params?: unknown;
    /** From the tool definition. Absent means unknown, which is treated as unsafe. */
    idempotency?: string;
}

export interface PlannedAction extends CandidateAction {
    cost: ToolCost;
    /** True when this tool may be run speculatively / in parallel. */
    speculative: boolean;
    /** Cumulative expected cost through this action, in order. */
    cumulativeCostMs: number;
}

export interface PlanResult {
    /** Actions in the order they should be attempted, cheapest-first. */
    ordered: PlannedAction[];
    /** Actions dropped because the budget ran out before them. */
    deferred: PlannedAction[];
    totalCostMs: number;
    budgetMs: number;
    budgetExhausted: boolean;
    /** True when no proposed action had measured history. */
    allEstimated: boolean;
}

export interface PlanOptions {
    /** Cost ceiling for this round. Actions beyond it are deferred, not run. */
    budgetMs?: number;
    /** Cost already spent, so the budget spans the whole task rather than one round. */
    spentMs?: number;
}

/** Idempotency values that make a tool safe to execute speculatively. */
const SPECULATION_SAFE = new Set(["read-safe", "idempotent"]);

/**
 * Default cost ceiling for one agent task.
 *
 * Deliberately generous — this is a stop-the-runaway bound, not a target, and it
 * is meant to be lowered once there is evidence to lower it against.
 *
 * Basis, such as it is: the only two executions in `agent_tool_usage` that carry
 * a correlation id spent 29.5s and 44.4s of tool time across 14–17 tool calls.
 * 120s is ~2.7x that observed maximum, so it should not truncate a legitimate
 * task today while still bounding one that has genuinely run away.
 *
 * Treat that basis as weak: 252 of 281 usage rows carry no correlation id at
 * all, so per-task cost is unmeasurable for 90% of the history. Tightening this
 * number sensibly requires fixing that first.
 *
 * Override without a code change via AGENT_TOOL_BUDGET_MS.
 */
const FALLBACK_BUDGET_MS = 120_000;

function resolveDefaultBudgetMs(): number {
    const raw = process.env.AGENT_TOOL_BUDGET_MS;
    if (!raw) return FALLBACK_BUDGET_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        logger.warn(`Ignoring invalid AGENT_TOOL_BUDGET_MS=${raw}; using ${FALLBACK_BUDGET_MS}ms`);
        return FALLBACK_BUDGET_MS;
    }
    return parsed;
}

export class ToolPlannerService {
    /**
     * Order proposed actions cheapest-first under a cost budget.
     *
     * Ordering is stable for equal costs, so the model's own preference survives
     * as a tiebreak rather than being shuffled.
     */
    plan(
        candidates: CandidateAction[],
        table: ToolCostTable,
        options: PlanOptions = {},
    ): PlanResult {
        const budgetMs = options.budgetMs ?? resolveDefaultBudgetMs();
        const spentMs = options.spentMs ?? 0;
        const remaining = Math.max(0, budgetMs - spentMs);

        const priced = candidates.map((c, index) => ({
            candidate: c,
            index,
            cost: toolCostModelService.costOf(table, c.toolName),
        }));

        priced.sort((a, b) =>
            a.cost.expectedCostMs !== b.cost.expectedCostMs
                ? a.cost.expectedCostMs - b.cost.expectedCostMs
                : a.index - b.index,
        );

        const ordered: PlannedAction[] = [];
        const deferred: PlannedAction[] = [];
        let cumulative = 0;
        let exhausted = false;

        for (const p of priced) {
            const next = cumulative + p.cost.expectedCostMs;
            const action: PlannedAction = {
                ...p.candidate,
                cost: p.cost,
                speculative: this.isSpeculationSafe(p.candidate),
                cumulativeCostMs: next,
            };

            // The first action always runs even if it alone exceeds the budget:
            // refusing to act at all would stall the task rather than bound it.
            if (next > remaining && ordered.length > 0) {
                exhausted = true;
                deferred.push(action);
                continue;
            }

            cumulative = next;
            ordered.push(action);
        }

        const allEstimated = priced.length > 0 && priced.every((p) => !p.cost.measured);
        if (allEstimated) {
            logger.debug(
                `Planning with no measured history for any of: ${candidates.map((c) => c.toolName).join(", ")}`,
            );
        }

        return {
            ordered,
            deferred,
            totalCostMs: cumulative,
            budgetMs,
            budgetExhausted: exhausted,
            allEstimated,
        };
    }

    /**
     * Fail-closed: only an explicit read-safe/idempotent declaration permits
     * speculative execution. Missing metadata means unsafe, never "probably fine".
     */
    isSpeculationSafe(candidate: CandidateAction): boolean {
        return candidate.idempotency !== undefined && SPECULATION_SAFE.has(candidate.idempotency);
    }

    /**
     * The leading run of speculation-safe actions, which may be executed
     * concurrently. Stops at the first side-effecting action so ordering
     * relative to writes is preserved.
     */
    parallelizablePrefix(plan: PlanResult): PlannedAction[] {
        const prefix: PlannedAction[] = [];
        for (const action of plan.ordered) {
            if (!action.speculative) break;
            prefix.push(action);
        }
        return prefix;
    }

    /**
     * Whether the task should stop spending and synthesise an answer.
     *
     * This is the convergence bound the loop lacks: today it only stops at
     * `currentIteration < maxIterations`, so an expensive task burns 20
     * iterations regardless of what they cost.
     */
    shouldStopForBudget(spentMs: number, budgetMs?: number): boolean {
        return spentMs >= (budgetMs ?? resolveDefaultBudgetMs());
    }

    /** The ceiling currently in force, for logging and for surfacing in traces. */
    defaultBudgetMs(): number {
        return resolveDefaultBudgetMs();
    }
}

export const toolPlannerService = new ToolPlannerService();
