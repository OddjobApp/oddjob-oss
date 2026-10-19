import { describe, it, expect } from "vitest";
import { WindowEvaluateExecutor } from "../../../core/executors/window-evaluate-executor.js";
import { WinLossReconcileExecutor } from "../../../core/executors/winloss-reconcile-executor.js";
import { WindowOpenExecutor } from "../../../core/executors/window-open-executor.js";
import { PipelinePostExecutor } from "../../../core/executors/pipeline-post-executor.js";
import { LeadQualifyExecutor } from "../../../core/executors/lead-qualify-executor.js";
import { WindowScoreExecutor } from "../../../core/executors/window-score-executor.js";
import { ForecastRollupExecutor } from "../../../core/executors/forecast-rollup-executor.js";
import { WindowCalibrateExecutor } from "../../../core/executors/window-calibrate-executor.js";
import type { JobExecutor } from "../../../core/executors/executor-types.js";

/**
 * Binding contract: each executor's jobType must exactly match the `tool:` name
 * used by the cycle.yaml mission steps, or auto-discovery dispatch silently
 * misses them. Pure structural check — no DB / store needed.
 */
describe("sales window executor bindings", () => {
    it("WindowEvaluateExecutor claims exactly window_evaluate", () => {
        const ex = new WindowEvaluateExecutor();
        expect(ex.canExecute("window_evaluate")).toBe(true);
        expect(ex.canExecute("winloss_reconcile")).toBe(false);
        expect(ex.canExecute("dms_evaluate")).toBe(false);
    });

    it("WinLossReconcileExecutor claims exactly winloss_reconcile", () => {
        const ex = new WinLossReconcileExecutor();
        expect(ex.canExecute("winloss_reconcile")).toBe(true);
        expect(ex.canExecute("window_evaluate")).toBe(false);
    });

    // Every sales tool named in sales-opportunity-pipeline.cycle.yaml must bind to
    // exactly one executor whose jobType equals the tool name. Drift here means a
    // mission step silently has no executor.
    const TOOL_BINDINGS: Array<[string, JobExecutor]> = [
        ["window_evaluate", new WindowEvaluateExecutor()],
        ["winloss_reconcile", new WinLossReconcileExecutor()],
        ["window_open", new WindowOpenExecutor()],
        ["pipeline_post", new PipelinePostExecutor()],
        ["lead_qualify", new LeadQualifyExecutor()],
        ["window_score", new WindowScoreExecutor()],
        ["forecast_rollup", new ForecastRollupExecutor()],
        ["window_calibrate", new WindowCalibrateExecutor()],
    ];

    it.each(TOOL_BINDINGS)("%s binds to exactly its own tool name", (tool, ex) => {
        expect(ex.canExecute(tool)).toBe(true);
        for (const [other] of TOOL_BINDINGS) {
            if (other !== tool) expect(ex.canExecute(other)).toBe(false);
        }
    });

    it.each(TOOL_BINDINGS)("%s fails cleanly without an organizationId", async (_tool, ex) => {
        const res = await ex.execute({ organizationId: null } as any, {}, {} as any, {} as any);
        expect(res.success).toBe(false);
        expect(res.status).toBe("failure");
        expect(res.error).toMatch(/organizationId/);
    });
});
