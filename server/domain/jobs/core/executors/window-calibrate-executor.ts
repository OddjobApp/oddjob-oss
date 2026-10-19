/**
 * window_calibrate executor (Sales Opportunity Pipeline).
 *
 * Step FCST-2 of mission-generate-forecast: compare each rung's STATED ceiling
 * against the REALIZED win-rate of the snapshot cohort that passed through it,
 * and flag miscalibrated rungs. Deterministic — reads the labelled decay curve
 * (window_snapshots with a backfilled realized_outcome) that winloss_reconcile
 * produces. Advisory: it flags drift, it does not move ceilings.
 *
 * A rung is miscalibrated when |stated − realized win-rate| exceeds the tolerance
 * (default 15 percentage points). Output feeds the forecast template (FCST-3).
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { SalesCollections } from "../../../sales/core/collections.js";
import { type WindowSnapshot } from "../../../sales/core/opportunity-window.service.js";

const TOLERANCE_PP = 15; // percentage points

interface RungCalibration {
    stated_ceiling: number;
    cohort_size: number;
    realized_win_rate: number; // 0..100
    delta: number;             // realized − stated
    miscalibrated: boolean;
}

export class WindowCalibrateExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "window_calibrate";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "window_calibrate requires an organizationId" };
        }

        const cfg = { ...(context?.data ?? {}), ...(resolvedConfig ?? {}) };
        const tolerance = cfg.tolerance_pp != null ? Number(cfg.tolerance_pp) : TOLERANCE_PP;

        const store = await salesStoreForOrg(orgId);
        const snaps = (await store.list<WindowSnapshot>(SalesCollections.windowSnapshots))
            .map((r) => r.data)
            .filter((s) => s.realized_outcome != null);

        // Group labelled snapshots by the rung (ceiling) they represent. Each
        // snapshot is won (realized_outcome=100) or lost (0) once its deal closed.
        const byRung = new Map<number, { wins: number; total: number }>();
        for (const s of snaps) {
            const rung = s.ceiling_after;
            if (rung <= 0 || rung >= 100) continue; // skip terminal rows
            const bucket = byRung.get(rung) ?? { wins: 0, total: 0 };
            bucket.total++;
            if ((s.realized_outcome ?? 0) >= 100) bucket.wins++;
            byRung.set(rung, bucket);
        }

        const calibration: RungCalibration[] = Array.from(byRung.entries())
            .map(([stated_ceiling, { wins, total }]) => {
                const realized_win_rate = Math.round((wins / total) * 100);
                const delta = realized_win_rate - stated_ceiling;
                return {
                    stated_ceiling,
                    cohort_size: total,
                    realized_win_rate,
                    delta,
                    miscalibrated: Math.abs(delta) > tolerance,
                };
            })
            .sort((a, b) => b.stated_ceiling - a.stated_ceiling);

        const miscalibrated = calibration.filter((c) => c.miscalibrated);

        return {
            success: true,
            output: JSON.stringify({ tolerance_pp: tolerance, labelled_snapshots: snaps.length, calibration }),
            status: "success",
            telemetry: { rungs_evaluated: calibration.length, miscalibrated_count: miscalibrated.length },
        };
    }
}
