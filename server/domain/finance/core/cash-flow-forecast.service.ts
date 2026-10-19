/**
 * 13-Week Rolling Cash-Flow Forecast engine (cadence addition).
 *
 * Direct-method short-horizon liquidity projection: start from today's liquid
 * balance and walk forward week-by-week, applying recurring burn, scheduled
 * installment outflows, and expected receivable inflows. If the running balance
 * breaches the safety floor in any week we raise a cashflow_shortfall
 * recommendation. The same engine powers the ad-hoc what-if scenario by layering
 * scenario deltas on top of the baseline series.
 */

import crypto from "crypto";
import { RecordStore } from "./record-store.js";
import { FinanceCollections } from "./collections.js";
import { createRecommendation } from "./recommendations.js";
import type { FinanceAccount } from "./cash-drag.service.js";

const LIQUID_TYPES = new Set(["CHECKING", "SAVINGS"]);
const WEEK_MS = 7 * 86_400_000;

export interface Receivable {
    invoice_id: string;
    context_id?: string;
    customer_token?: string;
    issued_date?: string;
    due_date?: string;
    amount: number;
    amount_paid?: number;
    status: string;
    last_reminder_at?: string;
}

interface InstallmentToken {
    token_id: string;
    remaining_amount?: number;
    installments_total?: number;
    installments_paid?: number;
    next_due_date?: string;
}

interface Subscription {
    monthly_cost?: number;
    quarantine_flag?: boolean;
}

/** A single hypothetical layered onto the baseline forecast. */
export interface ScenarioDelta {
    label?: string;
    /** Steady weekly net change applied every week (negative = extra burn). */
    recurring_weekly?: number;
    /** One-off amount applied in `at_week` (1-based; default week 1). */
    one_time?: number;
    at_week?: number;
}

export interface ForecastOptions {
    horizonWeeks?: number; // default 13
    safetyFloor?: number; // shortfall threshold for the running balance
    scenario?: ScenarioDelta[]; // ad-hoc what-if layers (empty for the rolling baseline)
    scenarioLabel?: string;
    persist?: boolean; // write a cash_flow_forecasts record + shortfall rec
    now?: Date;
}

export interface ForecastWeek {
    period: string; // ISO date of the week's start (Monday-agnostic; +7d steps from now)
    inflow: number;
    outflow: number;
    net: number;
    running_balance: number;
}

export interface CashFlowForecast {
    forecast_id: string;
    kind: "rolling_13week" | "scenario" | "annual";
    scenario_label?: string;
    generated_at: string;
    horizon_weeks: number;
    opening_balance: number;
    projected_min_balance: number;
    min_balance_period: string;
    shortfall_flag: boolean;
    weekly_series: ForecastWeek[];
    assumptions: Record<string, any>;
    recId?: string;
}

const DEFAULTS = { horizonWeeks: 13, safetyFloor: 0 };

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Index of the forecast week (0-based) a date falls into, or -1 if outside the horizon. */
function weekIndexOf(date: string | undefined, start: number, horizon: number): number {
    if (!date) return -1;
    const t = new Date(date).getTime();
    if (isNaN(t) || t < start) return -1;
    const idx = Math.floor((t - start) / WEEK_MS);
    return idx < horizon ? idx : -1;
}

export async function projectCashFlow(
    store: RecordStore,
    opts: ForecastOptions = {},
): Promise<CashFlowForecast> {
    const now = opts.now ?? new Date();
    const horizon = opts.horizonWeeks ?? DEFAULTS.horizonWeeks;
    const floor = opts.safetyFloor ?? DEFAULTS.safetyFloor;
    const scenario = opts.scenario ?? [];
    const startMs = now.getTime();

    // Opening liquid balance.
    const accounts = await store.list<FinanceAccount>(FinanceCollections.accounts);
    const openingBalance = accounts
        .filter((a) => LIQUID_TYPES.has(a.data.account_type))
        .reduce((s, a) => s + (a.data.current_balance || 0), 0);

    // Steady recurring burn from active subscriptions, weekly-ized (12 mo / 52 wk).
    const subs = await store.list<Subscription>(FinanceCollections.subscriptions);
    const monthlyBurn = subs
        .filter((s) => !s.data.quarantine_flag)
        .reduce((s2, s) => s2 + (s.data.monthly_cost || 0), 0);
    const weeklyBurn = (monthlyBurn * 12) / 52;

    // Per-week inflow/outflow buckets seeded with the steady burn.
    const inflow = new Array(horizon).fill(0);
    const outflow = new Array(horizon).fill(0);
    for (let w = 0; w < horizon; w++) outflow[w] += weeklyBurn;

    // Outstanding receivables land as inflow in their due week.
    const receivables = await store.list<Receivable>(FinanceCollections.receivables);
    for (const { data } of receivables) {
        if (data.status === "PAID" || data.status === "WRITTEN_OFF") continue;
        const outstanding = (data.amount || 0) - (data.amount_paid || 0);
        if (outstanding <= 0) continue;
        const w = weekIndexOf(data.due_date, startMs, horizon);
        if (w >= 0) inflow[w] += outstanding;
    }

    // Next installment payment lands as outflow in its due week.
    const tokens = await store.list<InstallmentToken>(FinanceCollections.installmentTokens);
    for (const { data } of tokens) {
        const remainingCount = (data.installments_total || 0) - (data.installments_paid || 0);
        if (remainingCount <= 0) continue;
        const per = (data.remaining_amount || 0) / remainingCount;
        const w = weekIndexOf(data.next_due_date, startMs, horizon);
        if (w >= 0) outflow[w] += per;
    }

    // Layer scenario deltas (ad-hoc what-if).
    for (const d of scenario) {
        if (d.recurring_weekly) {
            for (let w = 0; w < horizon; w++) {
                if (d.recurring_weekly >= 0) inflow[w] += d.recurring_weekly;
                else outflow[w] += -d.recurring_weekly;
            }
        }
        if (d.one_time) {
            const w = Math.min(horizon - 1, Math.max(0, (d.at_week ?? 1) - 1));
            if (d.one_time >= 0) inflow[w] += d.one_time;
            else outflow[w] += -d.one_time;
        }
    }

    // Walk the running balance.
    const series: ForecastWeek[] = [];
    let running = openingBalance;
    let minBalance = openingBalance;
    let minPeriod = new Date(startMs).toISOString().slice(0, 10);
    for (let w = 0; w < horizon; w++) {
        const net = inflow[w] - outflow[w];
        running += net;
        const period = new Date(startMs + w * WEEK_MS).toISOString().slice(0, 10);
        series.push({
            period,
            inflow: round(inflow[w]),
            outflow: round(outflow[w]),
            net: round(net),
            running_balance: round(running),
        });
        if (running < minBalance) {
            minBalance = running;
            minPeriod = period;
        }
    }

    const shortfall = minBalance < floor;
    const kind: CashFlowForecast["kind"] = scenario.length > 0 ? "scenario" : "rolling_13week";
    const forecast: CashFlowForecast = {
        forecast_id: `fcst_${now.getTime()}_${crypto.randomBytes(3).toString("hex")}`,
        kind,
        scenario_label: opts.scenarioLabel,
        generated_at: now.toISOString(),
        horizon_weeks: horizon,
        opening_balance: round(openingBalance),
        projected_min_balance: round(minBalance),
        min_balance_period: minPeriod,
        shortfall_flag: shortfall,
        weekly_series: series,
        assumptions: {
            weekly_recurring_burn: round(weeklyBurn),
            safety_floor: floor,
            scenario,
        },
    };

    if (opts.persist) {
        if (shortfall) {
            const rec = await createRecommendation(store, {
                kind: "cashflow_shortfall",
                title: `Projected cash shortfall in week of ${minPeriod}`,
                body: `The ${horizon}-week forecast dips to ${minBalance.toFixed(2)}, below your ${floor.toFixed(2)} floor, the week of ${minPeriod}. Pull receivables forward or defer outflows.`,
                payload: {
                    forecast_id: forecast.forecast_id,
                    projected_min_balance: forecast.projected_min_balance,
                    min_balance_period: minPeriod,
                },
                now,
            });
            forecast.recId = rec.rec_id;
        }
        await store.upsert(FinanceCollections.cashFlowForecasts, forecast.forecast_id, forecast);
    }

    return forecast;
}
