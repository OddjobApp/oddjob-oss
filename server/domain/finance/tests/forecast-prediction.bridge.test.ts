import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRecordStore } from "../core/record-store.js";
import { FinanceCollections } from "../core/collections.js";
import type { CashFlowForecast, ForecastWeek } from "../core/cash-flow-forecast.service.js";
import type { TaxEstimate } from "../core/estimated-tax.service.js";
import {
    deriveCashflowPrediction,
    deriveTaxPrediction,
    binaryEntropy,
    registerCashflowPrediction,
    reconcileForecastOutcomes,
    financeContextId,
    type ForecastPredictionPort,
    type ForecastPredictionRecord,
} from "../core/forecast-prediction.bridge.js";

let store: InMemoryRecordStore;
beforeEach(() => {
    store = new InMemoryRecordStore();
});

// ── Test fixtures ──────────────────────────────────────────────────────────

/** Build a CashFlowForecast with a controlled net series + minimum. */
function makeForecast(opts: {
    nets: number[];
    min: number;
    minWeekIdx: number; // 0-based week the min occurs in
    floor?: number;
    shortfall: boolean;
}): CashFlowForecast {
    const floor = opts.floor ?? 0;
    const series: ForecastWeek[] = opts.nets.map((net, i) => ({
        period: `2026-W${String(i + 1).padStart(2, "0")}`,
        inflow: net > 0 ? net : 0,
        outflow: net < 0 ? -net : 0,
        net,
        running_balance: 0,
    }));
    return {
        forecast_id: "fcst_test",
        kind: "rolling_13week",
        generated_at: "2026-06-16T00:00:00.000Z",
        horizon_weeks: opts.nets.length,
        opening_balance: 10000,
        projected_min_balance: opts.min,
        min_balance_period: series[opts.minWeekIdx].period,
        shortfall_flag: opts.shortfall,
        weekly_series: series,
        assumptions: { weekly_recurring_burn: 0, safety_floor: floor, scenario: [] },
    };
}

function makeEstimate(over: Partial<TaxEstimate> = {}): TaxEstimate {
    return {
        estimate_id: "2026-Q1",
        tax_year: "2026",
        period_label: "Q1",
        estimated_income: 40000,
        estimated_se_tax: 5651,
        estimated_income_tax: 8800,
        safe_harbor_amount: 0,
        total_due: 3613,
        status: "PROJECTED",
        ...over,
    };
}

/** Capturing fake port — records calls, returns canned calibration verdict. */
function makeFakePort(calibrationVerdict: Record<string, any> = {}): ForecastPredictionPort & {
    events: any[];
    outcomes: any[];
    matches: any[];
    calibrations: any[];
} {
    const events: any[] = [];
    const outcomes: any[] = [];
    const matches: any[] = [];
    const calibrations: any[] = [];
    return {
        events,
        outcomes,
        matches,
        calibrations,
        async emitEvent(env) {
            events.push(env);
            return { eventId: "evt_1" };
        },
        async recordOutcome(input) {
            outcomes.push(input);
            return { id: "out_1", contextId: input.contextId, label: input.label } as any;
        },
        async matchOutcome(input) {
            matches.push(input);
            return [{ id: "m_1", predictionId: input.predictions[0].id, matchType: "exact", matchScore: 1 }] as any;
        },
        async calibratePrediction(input) {
            calibrations.push(input);
            return {
                id: "cal_1",
                predictionId: input.predictionId,
                topPredictionCorrect: false,
                predictionError: 0.9,
                calibrationError: 0.7,
                brierScore: 0.8,
                overconfident: false,
                underconfident: false,
                ...calibrationVerdict,
            } as any;
        },
    };
}

// ── Confidence model: cash-flow ────────────────────────────────────────────

describe("cash-flow confidence model", () => {
    it("is near-certain when the minimum clears the floor by many volatility units", () => {
        const f = makeForecast({ nets: new Array(13).fill(-50), min: 9350, minWeekIdx: 12, shortfall: false });
        const p = deriveCashflowPrediction(f, { softInflowShare: 0 });
        expect(p.predicted_label).toBe("no_shortfall");
        expect(p.confidence).toBeGreaterThan(0.95);
        expect(p.entropy).toBeLessThan(0.1);
    });

    it("is a coin-flip when the minimum sits right on the floor", () => {
        const f = makeForecast({ nets: new Array(13).fill(500).map((v, i) => (i % 2 ? v : -v)), min: 10, minWeekIdx: 5, shortfall: false });
        const p = deriveCashflowPrediction(f, { softInflowShare: 0 });
        expect(p.confidence).toBeGreaterThan(0.49);
        expect(p.confidence).toBeLessThan(0.55);
        expect(p.entropy).toBeGreaterThan(0.9);
    });

    it("is confident about a deep shortfall", () => {
        const f = makeForecast({ nets: new Array(13).fill(500).map((v, i) => (i % 2 ? v : -v)), min: -5000, minWeekIdx: 3, floor: 0, shortfall: true });
        const p = deriveCashflowPrediction(f, { softInflowShare: 0 });
        expect(p.predicted_label).toBe("shortfall");
        expect(p.confidence).toBeGreaterThan(0.9);
        // Shortfall is knowable at the breach week, not horizon-end.
        expect(p.mature_at).toBe(f.min_balance_period);
    });

    it("pulls confidence toward 0.5 as inflow becomes soft (unbanked receivables)", () => {
        const f = makeForecast({ nets: new Array(13).fill(500).map((v, i) => (i % 2 ? v : -v)), min: -5000, minWeekIdx: 3, floor: 0, shortfall: true });
        const hard = deriveCashflowPrediction(f, { softInflowShare: 0 });
        const soft = deriveCashflowPrediction(f, { softInflowShare: 1 });
        expect(soft.confidence).toBeLessThan(hard.confidence);
        expect(soft.confidence).toBeGreaterThan(0.5);
    });
});

// ── Confidence model: estimated tax ────────────────────────────────────────

describe("estimated-tax confidence model", () => {
    it("grows as the year fills with actuals (Q4 > Q1)", () => {
        const e = makeEstimate();
        const q1 = deriveTaxPrediction(e, new Date("2026-04-01T00:00:00Z"));
        const q4 = deriveTaxPrediction(e, new Date("2026-12-15T00:00:00Z"));
        expect(q4.confidence).toBeGreaterThan(q1.confidence);
    });

    it("anchors high when the prior-year safe harbor governs the payment", () => {
        const e = makeEstimate({ total_due: 1000, safe_harbor_amount: 1000 });
        const early = deriveTaxPrediction(e, new Date("2026-04-01T00:00:00Z"));
        expect(early.confidence).toBeGreaterThanOrEqual(0.85);
        expect(early.snapshot.safe_harbor_governs).toBe(true);
    });
});

// ── Outcome-predicate contract (negation-matching regression guard) ─────────

describe("outcome predicates survive the calibration fuzzy matcher", () => {
    // The calibration outcome-matching plugin tokenises on non-alphanumerics,
    // drops ≤2-char tokens, and scores correctness by whole-token (incl. substring)
    // overlap — so it is blind to negation. A polar state and its antonym must each
    // be a SINGLE alphanumeric token that is not a substring of the other, or a
    // wrong forecast gets scored "correct". This replicates that tokenizer to lock
    // the bridge's predicate contract (the live smoke test proved it end-to-end).
    const tokenise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter((t) => t.length > 2);
    const fuzzyMatches = (a: string, b: string) => {
        const ta = tokenise(a);
        const tb = new Set(tokenise(b));
        return ta.some((t) => tb.has(t) || [...tb].some((x) => t.includes(x) || x.includes(t)));
    };

    it("cash-flow shortfall vs no-shortfall predicates do not fuzzy-match", () => {
        const up = makeForecast({ nets: new Array(13).fill(-50), min: -1, minWeekIdx: 3, floor: 0, shortfall: true });
        const down = makeForecast({ nets: new Array(13).fill(-50), min: 9350, minWeekIdx: 12, floor: 0, shortfall: false });
        const pShort = deriveCashflowPrediction(up).predicate;
        const pClear = deriveCashflowPrediction(down).predicate;
        expect(pShort).toMatch(/^[a-zA-Z0-9]+$/);
        expect(pClear).toMatch(/^[a-zA-Z0-9]+$/);
        expect(fuzzyMatches(pShort, pClear)).toBe(false);
        // The predicted predicate must exact-match its own outcome (a correct call).
        expect(fuzzyMatches(pShort, pShort)).toBe(true);
    });
});

describe("binaryEntropy", () => {
    it("peaks at p=0.5 and bottoms at the extremes", () => {
        expect(binaryEntropy(0.5)).toBeCloseTo(1, 6);
        expect(binaryEntropy(0)).toBe(0);
        expect(binaryEntropy(1)).toBe(0);
    });
});

// ── Registration (Phase A) ─────────────────────────────────────────────────

describe("registerCashflowPrediction", () => {
    it("persists a PENDING prediction and emits a canonical event", async () => {
        const port = makeFakePort();
        const f = makeForecast({ nets: new Array(13).fill(-50), min: 9350, minWeekIdx: 12, shortfall: false });
        const rec = await registerCashflowPrediction(store, port, { orgId: 7, forecast: f, softInflowShare: 0 });

        expect(rec.status).toBe("PENDING");
        expect(rec.event_id).toBe("evt_1");
        expect(port.events).toHaveLength(1);
        expect(port.events[0].action).toBe("cashflow_forecast");

        const stored = await store.list(FinanceCollections.forecastPredictions);
        expect(stored).toHaveLength(1);
        // context_id is a deterministic per-org UUID (PI calibration tables type it as uuid).
        expect(stored[0].data.context_id).toBe(financeContextId(7));
        expect(stored[0].data.context_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    });
});

// ── Reconciliation (Phase B) ───────────────────────────────────────────────

function seedPending(over: Partial<ForecastPredictionRecord> = {}): ForecastPredictionRecord {
    return {
        kind: "cashflow",
        predicted_label: "shortfall",
        predicate: "cashflow:shortfall",
        probability: 0.99,
        confidence: 0.95,
        entropy: 0.08,
        mature_at: "2026-06-01",
        target_period: "2026-W04",
        snapshot: { floor: 0, projected_min_balance: -5000 },
        prediction_id: "fpred_1",
        context_id: "finance-org-9",
        created_at: "2026-05-01T00:00:00.000Z",
        status: "PENDING",
        event_id: "evt_1",
        ...over,
    };
}

describe("reconcileForecastOutcomes", () => {
    it("calibrates a matured prediction and flags miscalibration on a wrong, confident call", async () => {
        const port = makeFakePort({ overconfident: true, topPredictionCorrect: false });
        const pred = seedPending();
        await store.upsert(FinanceCollections.forecastPredictions, pred.prediction_id, pred);
        // Actual: balance stayed above the floor → no shortfall (prediction was wrong).
        await store.upsert(FinanceCollections.balanceSnapshots, "snap_1", {
            captured_at: "2026-05-20T00:00:00.000Z",
            liquid_balance: 5000,
        });

        const res = await reconcileForecastOutcomes(store, port, { orgId: 9, now: new Date("2026-06-16T00:00:00Z") });

        expect(res.reconciled).toBe(1);
        expect(res.miscalibrated).toBe(1);
        expect(port.outcomes).toHaveLength(1);
        expect(port.matches).toHaveLength(1);
        expect(port.calibrations).toHaveLength(1);

        const cal = await store.get(FinanceCollections.forecastCalibrations, "fpred_1");
        expect(cal?.data.observed_label).toBe("no_shortfall");
        expect(cal?.data.overconfident).toBe(true);

        const advanced = await store.get(FinanceCollections.forecastPredictions, "fpred_1");
        expect(advanced?.data.status).toBe("CALIBRATED");

        const recs = await store.list(FinanceCollections.recommendations);
        const miscal = recs.filter((r) => (r.data as any).kind === "forecast_miscalibrated");
        expect(miscal).toHaveLength(1);
        expect((miscal[0].data as any).title).toContain("optimistic");
    });

    it("leaves a not-yet-matured prediction PENDING", async () => {
        const port = makeFakePort();
        const pred = seedPending({ mature_at: "2026-12-01", prediction_id: "fpred_future" });
        await store.upsert(FinanceCollections.forecastPredictions, pred.prediction_id, pred);

        const res = await reconcileForecastOutcomes(store, port, { orgId: 9, now: new Date("2026-06-16T00:00:00Z") });

        expect(res.reconciled).toBe(0);
        expect(res.pending).toBe(1);
        expect(port.calibrations).toHaveLength(0);
    });
});
