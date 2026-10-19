/**
 * Forecast → Prediction-Intelligence calibration bridge (BudgetMaster).
 *
 * BudgetMaster's forecast engines (projectCashFlow, projectEstimatedTax) emit
 * *deterministic* point projections. This bridge turns each forecast into a
 * scored *prediction* and, on a later run, reconciles it against the actual
 * outcome through the Prediction-Intelligence calibration pod — so forecasts
 * gain confidence, Brier/log-loss scoring, and over/under-confidence detection
 * that tightens over time.
 *
 * Design constraints:
 *   - The forecast engines stay pure + DB-free. All Prediction-Intelligence
 *     coupling lives here and is reached through `ForecastPredictionPort`, so
 *     this module is unit-tested with a fake port + InMemoryRecordStore. The
 *     real pod adapter (`createPodForecastPredictionPort`) is wired only in the
 *     executor layer, which already owns a real org + DB connection.
 *   - The confidence model is a set of *pure* functions (`deriveCashflow*`,
 *     `deriveTax*`) so the math can be reviewed and tested in isolation.
 *
 * We deliberately do NOT route forecasts through predictionPod.generatePredictions
 * (its predicate/branch/hidden-state machinery is the wrong shape for a financial
 * time-series). We construct a single lightweight branch per forecast and use the
 * calibration loop only.
 */

import { v5 as uuidv5 } from "uuid";
import type { RecordStore } from "./record-store.js";
import { FinanceCollections, DefaultContexts } from "./collections.js";
import { createRecommendation } from "./recommendations.js";
import type { CashFlowForecast } from "./cash-flow-forecast.service.js";
import type { Receivable } from "./cash-flow-forecast.service.js";
import type { TaxEstimate } from "./estimated-tax.service.js";
import type { FinanceAccount } from "./cash-drag.service.js";

// Prediction-Intelligence contracts — TYPE-ONLY imports (erased at compile, so
// importing this bridge never pulls the PI runtime).
import type { DomainContext } from "../../prediction-intelligence/quant/types.js";
import type { RawEventEnvelope } from "../../prediction-intelligence/canonical-event/types.js";
import type {
    ObservedOutcome,
    OutcomeIntakeInput,
    OutcomeMatchingInput,
    OutcomeMatch,
    PredictionCalibrationInput,
    CalibrationOutcome,
} from "../../prediction-intelligence/calibration/types.js";
import type { PredictionBranch } from "../../prediction-intelligence/prediction/types.js";

const LIQUID_TYPES = new Set(["CHECKING", "SAVINGS"]);
// Receivables in these statuses are "soft" — promised but not yet scheduled or
// banked, so a forecast leaning on them is less certain than one funded by cash.
const SOFT_RECEIVABLE_STATUSES = new Set(["DRAFT", "SENT"]);
// How hard soft inflows pull confidence back toward a coin-flip (0..1).
const SOFT_INFLOW_PENALTY = 0.5;

// ── Port: the narrow PI surface the bridge depends on ──────────────────────
// Real adapter binds to canonicalEventService + calibrationPod; tests fake it.
export interface ForecastPredictionPort {
    emitEvent(env: RawEventEnvelope, ctx: DomainContext): Promise<{ eventId?: string }>;
    recordOutcome(input: OutcomeIntakeInput, ctx: DomainContext): Promise<ObservedOutcome>;
    matchOutcome(input: OutcomeMatchingInput, ctx: DomainContext): Promise<OutcomeMatch[]>;
    calibratePrediction(input: PredictionCalibrationInput, ctx: DomainContext): Promise<CalibrationOutcome>;
}

export type ForecastKind = "cashflow" | "estimated_tax";

/** The reviewable output of the confidence model for one forecast. */
export interface PredictionDescriptor {
    kind: ForecastKind;
    /** Categorical claim the forecast is making, e.g. "shortfall" / "no_shortfall". */
    predicted_label: string;
    /** Stable predicate string used for branch + outcome matching. */
    predicate: string;
    /** P(the predicted_label is the one that occurs), in [0,1]. */
    probability: number;
    /** Confidence in the stated claim — always >= 0.5, grows with separation. */
    confidence: number;
    /** Shannon entropy (bits) of the underlying binary — high = uncertain. */
    entropy: number;
    /** ISO date when the prediction can be reconciled (outcome is knowable). */
    mature_at: string;
    /** Human-facing period this forecast targets. */
    target_period: string;
    /** Snapshot of the figures we predicted, for reconciliation + audit. */
    snapshot: Record<string, any>;
}

/** Persisted pending prediction (collection: forecast_predictions). */
export interface ForecastPredictionRecord extends PredictionDescriptor {
    prediction_id: string;
    context_id: string;
    created_at: string;
    status: "PENDING" | "CALIBRATED";
    event_id?: string;
}

// ── Pure math helpers ──────────────────────────────────────────────────────

function logistic(x: number): number {
    return 1 / (1 + Math.exp(-x));
}

function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Shannon entropy (bits) of a Bernoulli(p). 0 at p∈{0,1}, 1 at p=0.5. */
export function binaryEntropy(p: number): number {
    const q = clamp01(p);
    if (q === 0 || q === 1) return 0;
    return -(q * Math.log2(q) + (1 - q) * Math.log2(1 - q));
}

function round(n: number, dp = 4): number {
    const f = 10 ** dp;
    return Math.round(n * f) / f;
}

// ── Outcome predicates ──────────────────────────────────────────────────────
// The calibration outcome-matching plugin scores a prediction "correct" by FUZZY
// keyword overlap between the observed outcome's label and the predicted branch
// predicate. That tokenizer splits on every non-alphanumeric and drops ≤2-char
// tokens, so it is blind to negation: "cashflow:no_shortfall" and
// "cashflow:shortfall" tokenize identically ({cashflow, shortfall}) → overlap 1.0,
// scoring a wrong call as correct. Even a shared namespace token (e.g. "cashflow")
// alone clears the 0.50 correctness threshold.
//
// We therefore encode each polar state as a SINGLE alphanumeric token (no
// separators, so it stays one token) whose antonym shares no whole token. A
// correct call then matches its branch exactly (score 1.0); a wrong call matches
// nothing ("missed", score 0). Keep these tokens antonymic and non-substring.
function cashflowPredicate(isShortfall: boolean): string {
    return isShortfall ? "cashflowShortfall" : "cashflowSufficient";
}
function taxPredicate(isAccurate: boolean): string {
    return isAccurate ? "taxEstimateAccurate" : "taxEstimateMissed";
}

// ── Confidence model: cash-flow ────────────────────────────────────────────

export interface CashflowSignals {
    /** Share of total projected inflow that comes from soft receivables, [0,1]. */
    softInflowShare?: number;
}

/**
 * Confidence that the cash-flow forecast's shortfall verdict is correct.
 *
 * The verdict is binary: does the running balance breach the safety floor within
 * the horizon? Confidence is driven by how far the projected minimum sits from
 * the floor, *standardised* by the curve's volatility — a min that clears the
 * floor by one noisy week is a coin-flip; one that clears it by months is near
 * certain. Volatility grows with √(weeks-to-min) (random-walk variance), so a
 * shortfall predicted far out is less certain than one next week. Confidence is
 * then pulled toward 0.5 in proportion to how much of the inflow is "soft"
 * (promised-but-not-banked) receivables.
 */
export function deriveCashflowPrediction(
    forecast: CashFlowForecast,
    signals: CashflowSignals = {},
): PredictionDescriptor {
    const series = forecast.weekly_series;
    const floor = Number(forecast.assumptions?.safety_floor ?? 0);
    const min = forecast.projected_min_balance;
    const margin = min - floor;

    // 1-based index of the week the minimum occurs in (horizon distance).
    const minIdx = series.findIndex((w) => w.period === forecast.min_balance_period);
    const weekToMin = minIdx >= 0 ? minIdx + 1 : 1;

    // Per-step volatility proxy = mean absolute weekly net flow.
    const meanAbsNet =
        series.length > 0
            ? series.reduce((s, w) => s + Math.abs(w.net), 0) / series.length
            : 0;
    const volatility = Math.max(meanAbsNet * Math.sqrt(weekToMin), 1e-6);

    // P(shortfall): logistic of how far below the floor the min sits, in σ units.
    const pShortfall = logistic((floor - min) / volatility);
    const stated = forecast.shortfall_flag ? pShortfall : 1 - pShortfall;

    // Soft-inflow discount toward 0.5.
    const soft = clamp01(signals.softInflowShare ?? 0);
    const confidence = 0.5 + (stated - 0.5) * (1 - soft * SOFT_INFLOW_PENALTY);

    const label = forecast.shortfall_flag ? "shortfall" : "no_shortfall";
    const lastPeriod = series.length ? series[series.length - 1].period : forecast.generated_at.slice(0, 10);
    // Shortfall is knowable by the breach week; a clean run only at horizon end.
    const matureAt = forecast.shortfall_flag ? forecast.min_balance_period : lastPeriod;

    return {
        kind: "cashflow",
        predicted_label: label,
        predicate: cashflowPredicate(forecast.shortfall_flag),
        probability: round(pShortfall),
        confidence: round(clamp01(confidence)),
        entropy: round(binaryEntropy(pShortfall)),
        mature_at: matureAt,
        target_period: forecast.min_balance_period,
        snapshot: {
            forecast_id: forecast.forecast_id,
            floor,
            projected_min_balance: min,
            margin: round(margin, 2),
            week_to_min: weekToMin,
            volatility: round(volatility, 2),
            soft_inflow_share: round(soft, 4),
        },
    };
}

/** Soft-inflow share for the cash-flow signal, computed from the live store. */
export async function computeSoftInflowShare(store: RecordStore): Promise<number> {
    const receivables = await store.list<Receivable>(FinanceCollections.receivables);
    let total = 0;
    let soft = 0;
    for (const { data } of receivables) {
        if (data.status === "PAID" || data.status === "WRITTEN_OFF") continue;
        const outstanding = (data.amount || 0) - (data.amount_paid || 0);
        if (outstanding <= 0) continue;
        total += outstanding;
        if (SOFT_RECEIVABLE_STATUSES.has(data.status)) soft += outstanding;
    }
    return total > 0 ? soft / total : 0;
}

// ── Confidence model: estimated tax ────────────────────────────────────────

/**
 * Confidence that the estimated-tax figure will prove accurate.
 *
 * Early in the year the estimate extrapolates mostly-unknown future income, so
 * confidence is low; it rises as the year fills with booked actuals. When the
 * payment is governed by the prior-year safe-harbor floor (a known, settled
 * number) rather than the projection, confidence is anchored high — safe harbor
 * is reliable by construction.
 */
export function deriveTaxPrediction(estimate: TaxEstimate, now: Date): PredictionDescriptor {
    const year = Number(estimate.tax_year);
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year, 11, 31);
    const elapsed = clamp01((now.getTime() - yearStart) / (yearEnd - yearStart));

    const base = 0.55 + 0.4 * elapsed;
    // Safe harbor is binding when it meets or exceeds the projection-based due.
    const safeHarborGoverns =
        estimate.safe_harbor_amount > 0 && estimate.safe_harbor_amount >= estimate.total_due - 0.01;
    const confidence = clamp01(safeHarborGoverns ? Math.max(base, 0.85) : base);

    const matureAt = estimate.due_date ?? new Date(yearEnd).toISOString().slice(0, 10);

    return {
        kind: "estimated_tax",
        predicted_label: "accurate",
        predicate: taxPredicate(true),
        probability: round(confidence),
        confidence: round(confidence),
        entropy: round(binaryEntropy(confidence)),
        mature_at: matureAt,
        target_period: `${estimate.tax_year} ${estimate.period_label}`,
        snapshot: {
            estimate_id: estimate.estimate_id,
            total_due: estimate.total_due,
            safe_harbor_amount: estimate.safe_harbor_amount,
            safe_harbor_governs: safeHarborGoverns,
            year_fraction: round(elapsed),
        },
    };
}

// ── Registration (Phase A) ─────────────────────────────────────────────────

// The Prediction-Intelligence calibration tables type context_id / prediction_id
// / related_prediction_ids / matched_branch_id as Postgres `uuid` columns, so
// every identifier the bridge hands the pod must be a real UUID. We derive them
// deterministically (UUIDv5) from stable seed strings: the context is stable per
// org (an org's calibration history accumulates under one id) and a prediction's
// branch id is re-derivable during reconciliation. Fixed namespace below was
// generated once and must never change, or historical ids would stop matching.
const FINANCE_UUID_NAMESPACE = "b6e1f2a4-3c7d-5e8f-9a0b-1c2d3e4f5a6b";

/** Deterministic UUID for a finance-domain seed string. */
function financeUuid(seed: string): string {
    return uuidv5(seed, FINANCE_UUID_NAMESPACE);
}

/** Stable per-org calibration context (UUID). Exported for tests. */
export function financeContextId(orgId: number): string {
    return financeUuid(`finance-org-${orgId}`);
}

/** Re-derivable branch UUID for a prediction's single lightweight branch. */
function branchUuid(predictionId: string): string {
    return financeUuid(`branch:${predictionId}`);
}

function buildCtx(orgId: number, now: Date): DomainContext {
    return {
        requestId: `finance-bridge-${now.getTime()}`,
        correlationId: financeContextId(orgId),
        organizationId: orgId,
        now: now.toISOString(),
        mode: "batch",
    };
}

async function persistAndEmit(
    store: RecordStore,
    port: ForecastPredictionPort,
    descriptor: PredictionDescriptor,
    orgId: number,
    action: string,
    objectId: string,
    now: Date,
): Promise<ForecastPredictionRecord> {
    const ctx = buildCtx(orgId, now);
    const contextId = financeContextId(orgId);
    const predictionId = financeUuid(`fpred:${orgId}:${objectId}:${now.toISOString()}`);

    let eventId: string | undefined;
    try {
        const res = await port.emitEvent(
            {
                source: "finance",
                action,
                contextHint: contextId,
                objectId,
                occurredAt: now.toISOString(),
                payload: { ...descriptor, prediction_id: predictionId },
            },
            ctx,
        );
        eventId = res.eventId;
    } catch {
        // Event emission is best-effort telemetry; never block the forecast.
    }

    const record: ForecastPredictionRecord = {
        ...descriptor,
        prediction_id: predictionId,
        context_id: contextId,
        created_at: now.toISOString(),
        status: "PENDING",
        event_id: eventId,
    };
    await store.upsert(FinanceCollections.forecastPredictions, predictionId, record);
    return record;
}

export async function registerCashflowPrediction(
    store: RecordStore,
    port: ForecastPredictionPort,
    opts: { orgId: number; forecast: CashFlowForecast; softInflowShare?: number; now?: Date },
): Promise<ForecastPredictionRecord> {
    const now = opts.now ?? new Date();
    const softInflowShare =
        opts.softInflowShare ?? (await computeSoftInflowShare(store));
    const descriptor = deriveCashflowPrediction(opts.forecast, { softInflowShare });
    return persistAndEmit(store, port, descriptor, opts.orgId, "cashflow_forecast", opts.forecast.forecast_id, now);
}

export async function registerTaxPrediction(
    store: RecordStore,
    port: ForecastPredictionPort,
    opts: { orgId: number; estimate: TaxEstimate; now?: Date },
): Promise<ForecastPredictionRecord> {
    const now = opts.now ?? new Date();
    const descriptor = deriveTaxPrediction(opts.estimate, now);
    return persistAndEmit(store, port, descriptor, opts.orgId, "estimated_tax", opts.estimate.estimate_id, now);
}

// ── Reconciliation (Phase B) ───────────────────────────────────────────────

/** Observed cash-flow outcome from balance snapshots (fallback: live balance). */
export async function deriveCashflowOutcome(
    store: RecordStore,
    pred: ForecastPredictionRecord,
): Promise<{ label: string; observed_min: number } | null> {
    const floor = Number(pred.snapshot?.floor ?? 0);
    const snaps = await store.list<{ captured_at?: string; liquid_balance?: number; total_liquid?: number }>(
        FinanceCollections.balanceSnapshots,
    );
    const inWindow = snaps
        .map((s) => ({
            t: new Date(s.data.captured_at ?? 0).getTime(),
            bal: Number(s.data.liquid_balance ?? s.data.total_liquid ?? NaN),
        }))
        .filter(
            (s) =>
                !isNaN(s.bal) &&
                s.t >= new Date(pred.created_at).getTime() &&
                s.t <= new Date(pred.mature_at).getTime() + 86_400_000,
        );

    let observedMin: number;
    if (inWindow.length > 0) {
        observedMin = Math.min(...inWindow.map((s) => s.bal));
    } else {
        // No snapshots in-window — fall back to the current liquid balance.
        const accounts = await store.list<FinanceAccount>(FinanceCollections.accounts);
        observedMin = accounts
            .filter((a) => LIQUID_TYPES.has(a.data.account_type))
            .reduce((s, a) => s + (a.data.current_balance || 0), 0);
    }

    return { label: observedMin < floor ? "shortfall" : "no_shortfall", observed_min: round(observedMin, 2) };
}

/** Observed tax outcome: settled (APPROVED/PAID) estimate within tolerance. */
export async function deriveTaxOutcome(
    store: RecordStore,
    pred: ForecastPredictionRecord,
    tolerance = 0.15,
): Promise<{ label: string; settled_due: number } | null> {
    const estimateId = String(pred.snapshot?.estimate_id ?? "");
    if (!estimateId) return null;
    const settled = await store.get<TaxEstimate>(FinanceCollections.taxEstimates, estimateId);
    if (!settled || (settled.data.status !== "PAID" && settled.data.status !== "APPROVED")) {
        return null; // not settled yet — leave PENDING
    }
    const predicted = Number(pred.snapshot?.total_due ?? 0);
    const actual = settled.data.total_due;
    const withinTol = predicted > 0 && Math.abs(actual - predicted) <= tolerance * predicted;
    return { label: withinTol ? "accurate" : "inaccurate", settled_due: actual };
}

/** Minimal but interface-valid branch for the calibration loop. */
function buildBranch(pred: ForecastPredictionRecord): PredictionBranch {
    return {
        id: branchUuid(pred.prediction_id),
        predictionId: pred.prediction_id,
        contextId: pred.context_id,
        generation: 0,
        predicate: pred.predicate,
        postPredicates: [],
        probability: pred.probability,
        confidence: pred.confidence,
        branchScore: pred.probability,
        entropy: pred.entropy,
        expectedValue: 0,
        status: "active",
        supportingQuantIds: [],
        interferingQuantIds: [],
        supportingEventIds: pred.event_id ? [pred.event_id] : [],
        opposingEventIds: [],
        realmContributions: [],
        branchInfluences: [],
        constraints: [],
        createdFrom: {
            eventIds: pred.event_id ? [pred.event_id] : [],
            episodeIds: [],
            quantIds: [],
            hiddenStateIds: [],
            patternIds: [],
        },
        createdAt: pred.created_at,
        updatedAt: pred.created_at,
    };
}

export interface ReconcileResult {
    reconciled: number;
    miscalibrated: number;
    pending: number;
}

/**
 * Reconcile every matured pending prediction against its actual outcome and run
 * it through the calibration pod. Writes a forecast_calibrations record per
 * prediction and raises a forecast_miscalibrated recommendation when the pod
 * flags systematic over/under-confidence.
 */
export async function reconcileForecastOutcomes(
    store: RecordStore,
    port: ForecastPredictionPort,
    opts: { orgId: number; now?: Date },
): Promise<ReconcileResult> {
    const now = opts.now ?? new Date();
    const ctx = buildCtx(opts.orgId, now);
    const contextId = financeContextId(opts.orgId);
    const pending = await store.list<ForecastPredictionRecord>(FinanceCollections.forecastPredictions);

    const res: ReconcileResult = { reconciled: 0, miscalibrated: 0, pending: 0 };

    for (const { data: pred } of pending) {
        if (pred.status !== "PENDING") continue;
        if (new Date(pred.mature_at).getTime() > now.getTime()) {
            res.pending++;
            continue; // not yet knowable
        }

        // Observe the actual outcome for this forecast kind.
        const observed =
            pred.kind === "cashflow"
                ? await deriveCashflowOutcome(store, pred)
                : await deriveTaxOutcome(store, pred);
        if (!observed) {
            res.pending++;
            continue; // actual not available yet
        }
        const observedLabel = (observed as any).label as string;
        // Antonymic single-token predicate (see cashflowPredicate/taxPredicate) so
        // the fuzzy matcher scores a wrong call as "missed", not a false match.
        const outcomePredicate =
            pred.kind === "cashflow"
                ? cashflowPredicate(observedLabel === "shortfall")
                : taxPredicate(observedLabel === "accurate");

        // recordOutcome → matchOutcome → calibratePrediction.
        const outcome = await port.recordOutcome(
            {
                contextId,
                label: outcomePredicate,
                outcomeType: pred.kind === "cashflow" ? "cashflow_actual" : "tax_actual",
                source: "finance",
                occurredAt: pred.mature_at,
                relatedPredictionIds: [pred.prediction_id],
                payload: { ...(observed as any), predicted_label: pred.predicted_label },
            },
            ctx,
        );

        const matches = await port.matchOutcome(
            {
                outcome,
                predictions: [
                    {
                        id: pred.prediction_id,
                        topPredicate: pred.predicate,
                        branches: [
                            { id: branchUuid(pred.prediction_id), predicate: pred.predicate, status: "active", probability: pred.probability },
                        ],
                    },
                ],
            },
            ctx,
        );

        const calibration = await port.calibratePrediction(
            {
                contextId,
                predictionId: pred.prediction_id,
                topPredicate: pred.predicate,
                confidence: pred.confidence,
                entropy: pred.entropy,
                branches: [buildBranch(pred)],
                outcome,
                outcomeMatches: matches,
                mode: "batch",
            },
            ctx,
        );

        // Persist the scored result + advance the prediction.
        await store.upsert(FinanceCollections.forecastCalibrations, pred.prediction_id, {
            prediction_id: pred.prediction_id,
            kind: pred.kind,
            predicted_label: pred.predicted_label,
            observed_label: observedLabel,
            confidence_at_prediction: pred.confidence,
            top_prediction_correct: calibration.topPredictionCorrect,
            prediction_error: calibration.predictionError,
            calibration_error: calibration.calibrationError,
            brier_score: calibration.brierScore ?? null,
            overconfident: calibration.overconfident,
            underconfident: calibration.underconfident,
            calibrated_at: now.toISOString(),
        });
        await store.upsert(FinanceCollections.forecastPredictions, pred.prediction_id, {
            ...pred,
            status: "CALIBRATED",
        });
        res.reconciled++;

        if (calibration.overconfident || calibration.underconfident) {
            const dir = calibration.overconfident ? "optimistic" : "conservative";
            await createRecommendation(store, {
                kind: "forecast_miscalibrated",
                title: `${pred.kind === "cashflow" ? "Cash-flow" : "Estimated-tax"} forecasts running ${dir}`,
                body: `The ${pred.target_period} ${pred.kind} forecast predicted "${pred.predicted_label}" at ${(pred.confidence * 100).toFixed(0)}% confidence but observed "${observedLabel}". Calibration error ${calibration.calibrationError.toFixed(2)} — forecasts have been ${dir}. Future confidence will be adjusted.`,
                payload: {
                    prediction_id: pred.prediction_id,
                    kind: pred.kind,
                    overconfident: calibration.overconfident,
                    underconfident: calibration.underconfident,
                    calibration_error: calibration.calibrationError,
                },
                now,
            });
            res.miscalibrated++;
        }
    }

    return res;
}

// ── Real pod adapter (wired only in executors) ─────────────────────────────

/**
 * Build the live port bound to the Prediction-Intelligence pods. Imports the
 * pods lazily so the bridge module itself stays free of PI runtime coupling.
 */
export async function createPodForecastPredictionPort(): Promise<ForecastPredictionPort> {
    const { canonicalEventService } = await import(
        "../../prediction-intelligence/canonical-event/canonical-event.service.js"
    );
    const { calibrationPod } = await import(
        "../../prediction-intelligence/calibration/calibration-pod.service.js"
    );

    return {
        async emitEvent(env, ctx) {
            const result = await canonicalEventService.canonicalize(env, ctx);
            return { eventId: result.accepted ? result.event?.id : undefined };
        },
        recordOutcome: (input, ctx) => calibrationPod.recordOutcome(input, ctx),
        matchOutcome: (input, ctx) => calibrationPod.matchOutcome(input, ctx),
        calibratePrediction: (input, ctx) => calibrationPod.calibratePrediction(input, ctx),
    };
}
