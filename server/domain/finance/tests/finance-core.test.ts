import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRecordStore } from "../core/record-store.js";
import { FinanceCollections, routeContextForPath, DefaultContexts } from "../core/collections.js";
import {
    ingestParsedTransactions,
    createSplit,
    countTransactions,
    SplitMismatchError,
    type LedgerTransaction,
} from "../core/transaction.service.js";
import { parseOfx, parseQif, parseCsv, parseStatement } from "../core/statement-parser.service.js";
import { evaluateSwitches, type DeadMansSwitch } from "../core/dead-mans-switch.service.js";
import { scanIdleCash } from "../core/cash-drag.service.js";
import { scanSubscriptions } from "../core/subscription-decay.service.js";
import { simulateAmortization } from "../core/amortization.service.js";
import { lockBalanceSheet, computeCapexBurn } from "../core/balance-lock.service.js";
import { projectCashFlow } from "../core/cash-flow-forecast.service.js";
import { scanReceivables } from "../core/receivables.service.js";
import { generateStatements } from "../core/statements.service.js";
import { projectEstimatedTax } from "../core/estimated-tax.service.js";
import { compileSalesTax } from "../core/sales-tax.service.js";
import { assembleInformationReturns } from "../core/information-returns.service.js";

let store: InMemoryRecordStore;
beforeEach(() => {
    store = new InMemoryRecordStore();
});

// ── PRD §7 Test 1: Split-ledger constraint ─────────────────────────────────
describe("split-ledger constraint", () => {
    const parent: LedgerTransaction = {
        fitid: "TX-PARENT",
        account_id: "acc1",
        context_id: DefaultContexts.household,
        timestamp: new Date().toISOString(),
        payee_raw: "WHOLESALE CLUB",
        amount: -100.0,
        current_status: "UNRECONCILED",
        is_split: false,
    };

    it("rejects a split whose children do not sum to the parent, writing nothing", async () => {
        await expect(
            createSplit(store, {
                parent,
                children: [
                    { fitid: "TX-C1", amount: -60.0 },
                    { fitid: "TX-C2", amount: -39.99 }, // sums to -99.99, not -100.00
                ],
            }),
        ).rejects.toBeInstanceOf(SplitMismatchError);

        // Safe rollback: no rows written at all.
        expect(await countTransactions(store)).toBe(0);
    });

    it("accepts a balanced split and links children to the parent", async () => {
        await createSplit(store, {
            parent,
            children: [
                { fitid: "TX-C1", amount: -60.0, category_id: "groceries" },
                { fitid: "TX-C2", amount: -40.0, category_id: "household" },
            ],
        });
        expect(await countTransactions(store)).toBe(3);
        const p = await store.get<LedgerTransaction>(FinanceCollections.transactions, "TX-PARENT");
        const c1 = await store.get<LedgerTransaction>(FinanceCollections.transactions, "TX-C1");
        expect(p?.data.is_split).toBe(true);
        expect(c1?.data.parent_tx_id).toBe("TX-PARENT");
    });
});

// ── PRD §7 Test 2: FITID dedupe ─────────────────────────────────────────────
describe("FITID dedupe on re-ingest", () => {
    const parsed = [
        { fitid: "F1", timestamp: "2026-01-02T00:00:00Z", payee_raw: "COFFEE", amount: -4.5 },
        { fitid: "F2", timestamp: "2026-01-03T00:00:00Z", payee_raw: "PAYROLL", amount: 2500 },
    ];

    it("inserts once and skips duplicates on the second pass", async () => {
        const first = await ingestParsedTransactions(store, {
            accountId: "acc1",
            contextId: DefaultContexts.household,
            parsed,
        });
        expect(first.inserted).toBe(2);
        expect(first.skipped).toBe(0);

        const second = await ingestParsedTransactions(store, {
            accountId: "acc1",
            contextId: DefaultContexts.household,
            parsed,
        });
        expect(second.inserted).toBe(0);
        expect(second.skipped).toBe(2);
        expect(await countTransactions(store)).toBe(2);
    });
});

// ── PRD §7 Test 3: Hot-folder context routing + parsing ─────────────────────
describe("folder watcher routing", () => {
    it("routes sub-folders to the correct budget context", () => {
        expect(routeContextForPath("processing_zone/business/jan.ofx")).toBe(DefaultContexts.scheduleE);
        expect(routeContextForPath("processing_zone/projects/reno.csv")).toBe(DefaultContexts.capex);
        expect(routeContextForPath("processing_zone/personal/visa.qif")).toBe(DefaultContexts.household);
        expect(routeContextForPath("C:/inbox/unknown/file.csv")).toBe(DefaultContexts.household);
    });

    it("parses OFX, QIF and CSV into normalized transactions", async () => {
        const ofx = `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115<TRNAMT>-42.10<FITID>OFX1<NAME>GROCERY</STMTTRN>`;
        const o = parseOfx(ofx);
        expect(o).toHaveLength(1);
        expect(o[0]).toMatchObject({ fitid: "OFX1", amount: -42.1, payee_raw: "GROCERY" });

        const qif = `!Type:Bank\nD01/15'26\nT-42.10\nPGROCERY\n^\n`;
        const q = parseQif(qif);
        expect(q).toHaveLength(1);
        expect(q[0].amount).toBeCloseTo(-42.1);

        const csv = `Date,Description,Amount\n2026-01-15,GROCERY,-42.10\n`;
        const c = await parseCsv(csv);
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ payee_raw: "GROCERY", amount: -42.1 });
        // synthetic fitid is stable
        expect(c[0].fitid).toBe((await parseCsv(csv))[0].fitid);
    });

    it("parseStatement dispatches by extension and end-to-end ingests deduped", async () => {
        const csv = `Date,Description,Amount,FITID\n2026-01-15,GROCERY,-42.10,Z1\n2026-01-16,GAS,-30.00,Z2\n`;
        const parsed = await parseStatement("business/feed.csv", csv);
        const res = await ingestParsedTransactions(store, {
            accountId: "acc1",
            contextId: routeContextForPath("business/feed.csv"),
            parsed,
        });
        expect(res.inserted).toBe(2);
        const tx = await store.get<LedgerTransaction>(FinanceCollections.transactions, "Z1");
        expect(tx?.data.context_id).toBe(DefaultContexts.scheduleE);
    });
});

// ── PRD §7 Test 4: Dead Man's Switch timeout ───────────────────────────────
describe("dead man's switch timeout", () => {
    const armed: DeadMansSwitch = {
        switch_id: "dms1",
        label: "Monthly Payroll",
        account_id: "acc1",
        expected_direction: "INFLOW",
        amount_floor: 2500,
        payee_token: "ACME PAYROLL",
        cron_expected_interval: "0 0 1 * *",
        grace_period_hours: 48,
        status: "ARMED",
        expiration_deadline: "2026-02-01T00:00:00Z",
    };

    it("trips to FAULT and shields safe-to-spend when the deadline+grace passes", async () => {
        await store.upsert(FinanceCollections.deadMansSwitches, armed.switch_id, armed);
        // now is well past deadline + 48h grace
        const result = await evaluateSwitches(store, new Date("2026-02-10T00:00:00Z"));
        expect(result.faulted).toContain("dms1");
        expect(result.shieldedAmount).toBe(2500);

        const sw = await store.get<DeadMansSwitch>(FinanceCollections.deadMansSwitches, "dms1");
        expect(sw?.data.status).toBe("FAULT");

        const recs = await store.list(FinanceCollections.recommendations);
        expect(recs).toHaveLength(1);
        expect((recs[0].data as any).kind).toBe("dms_fault");
    });

    it("does NOT trip while still inside the grace window", async () => {
        await store.upsert(FinanceCollections.deadMansSwitches, armed.switch_id, armed);
        // 24h after deadline, grace is 48h → still satisfied
        const result = await evaluateSwitches(store, new Date("2026-02-02T00:00:00Z"));
        expect(result.faulted).toHaveLength(0);
        const sw = await store.get<DeadMansSwitch>(FinanceCollections.deadMansSwitches, "dms1");
        expect(sw?.data.status).toBe("ARMED");
    });
});

// ── Engine coverage: cash drag, subscription decay, amortization, lock ──────
describe("cash drag engine", () => {
    it("flags idle checking cash above the floor and creates a sweep rec", async () => {
        await store.upsert(FinanceCollections.accounts, "acc1", {
            account_id: "acc1", name: "Everyday Checking", account_type: "CHECKING",
            base_currency: "USD", current_balance: 25000,
        });
        const res = await scanIdleCash(store, { floor: 5000, yieldDelta: 0.045 });
        expect(res.sweeps).toHaveLength(1);
        expect(res.sweeps[0].idle).toBe(20000);
        const recs = await store.list(FinanceCollections.recommendations);
        expect((recs[0].data as any).kind).toBe("sweep");
    });
});

describe("subscription decay engine", () => {
    it("quarantines a zero-usage stale subscription", async () => {
        await store.upsert(FinanceCollections.subscriptions, "s1", {
            subscription_id: "s1", payee_token: "STREAMR", monthly_cost: 19.99, cadence: "monthly",
            usage_hours_logged: 0, quarantine_flag: false, last_seen_at: "2025-10-01T00:00:00Z",
        });
        const res = await scanSubscriptions(store, { staleDays: 60, now: new Date("2026-01-01T00:00:00Z") });
        expect(res.quarantined).toHaveLength(1);
        const sub = await store.get(FinanceCollections.subscriptions, "s1");
        expect((sub?.data as any).quarantine_flag).toBe(true);
    });
});

describe("amortization engine", () => {
    it("computes a positive interest amortization that fully pays down the balance", () => {
        const r = simulateAmortization({ principal: 40000, downPayment: 8000, annualRate: 0.069, termMonths: 60 });
        expect(r.financed).toBe(32000);
        expect(r.monthlyPayment).toBeGreaterThan(600);
        expect(r.totalInterest).toBeGreaterThan(0);
        expect(r.schedule).toHaveLength(60);
        expect(r.schedule[59].balance).toBe(0); // fully amortized
        expect(r.opportunityCostOfDownPayment).toBeGreaterThan(0);
    });

    it("handles a zero-interest loan", () => {
        const r = simulateAmortization({ principal: 1200, downPayment: 0, annualRate: 0, termMonths: 12 });
        expect(r.monthlyPayment).toBe(100);
        expect(r.totalInterest).toBe(0);
    });
});

describe("balance sheet lock", () => {
    beforeEach(async () => {
        await store.upsert(FinanceCollections.accounts, "chk", { account_id: "chk", name: "Checking", account_type: "CHECKING", base_currency: "USD", current_balance: 10000 });
        await store.upsert(FinanceCollections.accounts, "cc", { account_id: "cc", name: "Card", account_type: "CREDIT_CARD", base_currency: "USD", current_balance: -2500 });
    });

    it("snapshots net worth and is immutable for a period", async () => {
        const first = await lockBalanceSheet(store, { period: "2026-01" });
        expect(first.alreadyLocked).toBe(false);
        expect(first.snapshot.net_worth).toBe(7500);
        expect(first.snapshot.total_liabilities).toBe(2500);

        const second = await lockBalanceSheet(store, { period: "2026-01" });
        expect(second.alreadyLocked).toBe(true); // cannot be silently rewritten
        expect(await store.list(FinanceCollections.balanceSnapshots)).toHaveLength(1);
    });

    it("flags CapEx overruns", async () => {
        await store.upsert(FinanceCollections.budgetContexts, DefaultContexts.capex, { context_id: DefaultContexts.capex, name: "Kitchen Reno", archetype_mode: "CAPEX_PROJECT" });
        await store.upsert(FinanceCollections.budgetCategories, "cat1", { category_id: "cat1", context_id: DefaultContexts.capex, allocation_cap: 10000 });
        await store.upsert(FinanceCollections.transactions, "t1", { context_id: DefaultContexts.capex, amount: -12000 });
        const res = await computeCapexBurn(store);
        expect(res.overruns).toHaveLength(1);
        expect(res.overruns[0].spent).toBe(12000);
    });
});

// ── Cadence additions: cash-flow forecast ──────────────────────────────────
describe("cash-flow forecast engine", () => {
    const now = new Date("2026-06-01T00:00:00Z");

    it("projects a rolling forecast and flags a shortfall below the floor", async () => {
        await store.upsert(FinanceCollections.accounts, "chk", {
            account_id: "chk", name: "Checking", account_type: "CHECKING", base_currency: "USD", current_balance: 500,
        });
        // The next installment payment (1000) lands in week 2 → balance goes negative.
        await store.upsert(FinanceCollections.installmentTokens, "tok1", {
            token_id: "tok1", remaining_amount: 4000, installments_total: 4, installments_paid: 0,
            next_due_date: "2026-06-10T00:00:00Z",
        });
        const f = await projectCashFlow(store, { horizonWeeks: 13, safetyFloor: 0, persist: true, now });
        expect(f.kind).toBe("rolling_13week");
        expect(f.weekly_series).toHaveLength(13);
        expect(f.opening_balance).toBe(500);
        expect(f.shortfall_flag).toBe(true);
        const recs = await store.list(FinanceCollections.recommendations);
        expect((recs[0].data as any).kind).toBe("cashflow_shortfall");
    });

    it("layers a scenario delta and marks the run as a scenario", async () => {
        await store.upsert(FinanceCollections.accounts, "chk", {
            account_id: "chk", name: "Checking", account_type: "CHECKING", base_currency: "USD", current_balance: 5000,
        });
        const baseline = await projectCashFlow(store, { now });
        const scenario = await projectCashFlow(store, {
            scenario: [{ label: "New hire", recurring_weekly: -500 }], scenarioLabel: "New hire", now,
        });
        expect(scenario.kind).toBe("scenario");
        // Extra weekly burn pushes the trough below the baseline.
        expect(scenario.projected_min_balance).toBeLessThan(baseline.projected_min_balance);
    });
});

// ── Cadence additions: receivables ─────────────────────────────────────────
describe("receivables engine", () => {
    it("flips a past-due invoice to OVERDUE and raises one rec (idempotent)", async () => {
        await store.upsert(FinanceCollections.receivables, "inv1", {
            invoice_id: "inv1", customer_token: "ACME", amount: 1200, amount_paid: 0,
            status: "SENT", due_date: "2026-05-01T00:00:00Z",
        });
        const now = new Date("2026-06-01T00:00:00Z");
        const r1 = await scanReceivables(store, { now });
        expect(r1.overdue).toHaveLength(1);
        expect(r1.totalOverdue).toBe(1200);
        const inv = await store.get(FinanceCollections.receivables, "inv1");
        expect((inv?.data as any).status).toBe("OVERDUE");
        // Second pass: already OVERDUE → no duplicate recommendation.
        await scanReceivables(store, { now });
        const recs = await store.list(FinanceCollections.recommendations);
        expect(recs.filter((x) => (x.data as any).kind === "receivable_overdue")).toHaveLength(1);
    });
});

// ── Cadence additions: monthly statements ──────────────────────────────────
describe("statements engine", () => {
    it("computes P&L, cash-flow, and budget-vs-actual for a period", async () => {
        await store.upsert(FinanceCollections.transactions, "i1", { fitid: "i1", context_id: DefaultContexts.scheduleE, timestamp: "2026-05-10T00:00:00Z", amount: 5000, is_split: false });
        await store.upsert(FinanceCollections.transactions, "e1", { fitid: "e1", context_id: DefaultContexts.scheduleE, category_id: "supplies", timestamp: "2026-05-12T00:00:00Z", amount: -1800, is_split: false });
        await store.upsert(FinanceCollections.transactions, "old", { fitid: "old", context_id: DefaultContexts.scheduleE, timestamp: "2026-04-30T00:00:00Z", amount: -999, is_split: false });
        await store.upsert(FinanceCollections.budgetCategories, "supplies", { category_id: "supplies", name: "Supplies", allocation_cap: 1000 });

        const s = await generateStatements(store, { period: "2026-05" });
        expect(s.profit_and_loss.income).toBe(5000);
        expect(s.profit_and_loss.expense).toBe(1800);
        expect(s.profit_and_loss.net_profit).toBe(3200);
        expect(s.transaction_count).toBe(2); // April row excluded
        const supplies = s.budget_vs_actual.find((r) => r.category_id === "supplies");
        expect(supplies?.over_budget).toBe(true); // 1800 actual vs 1000 cap
    });
});

// ── Cadence additions: estimated tax ───────────────────────────────────────
describe("estimated tax engine", () => {
    it("projects SE + income tax on business net profit and persists an estimate", async () => {
        await store.upsert(FinanceCollections.budgetContexts, DefaultContexts.scheduleE, { context_id: DefaultContexts.scheduleE, archetype_mode: "TAX_SCHEDULE_E" });
        await store.upsert(FinanceCollections.transactions, "b1", { fitid: "b1", context_id: DefaultContexts.scheduleE, timestamp: "2026-03-01T00:00:00Z", amount: 40000, is_split: false });
        await store.upsert(FinanceCollections.transactions, "b2", { fitid: "b2", context_id: DefaultContexts.scheduleE, timestamp: "2026-03-15T00:00:00Z", amount: -10000, is_split: false });

        const est = await projectEstimatedTax(store, {
            taxYear: "2026", periodLabel: "Q1", dueDate: "2026-04-15", incomeTaxRate: 0.22, persist: true,
            now: new Date("2026-04-05T00:00:00Z"),
        });
        // net profit 30000 → SE 30000*0.9235*0.153 ≈ 4238.87; income 30000*0.22 = 6600
        expect(est.estimated_income).toBe(30000);
        expect(est.estimated_se_tax).toBeCloseTo(4238.87, 1);
        expect(est.estimated_income_tax).toBe(6600);
        expect(est.total_due).toBeCloseTo((4238.865 + 6600) / 4, 1);
        const stored = await store.get(FinanceCollections.taxEstimates, "2026-Q1");
        expect((stored?.data as any).status).toBe("PROJECTED");
        const recs = await store.list(FinanceCollections.recommendations);
        expect((recs[0].data as any).kind).toBe("estimated_tax_due");
    });
});

// ── Cadence additions: sales tax ───────────────────────────────────────────
describe("sales tax engine", () => {
    it("aggregates quarterly taxable sales and applies the rate", async () => {
        await store.upsert(FinanceCollections.budgetContexts, DefaultContexts.scheduleE, { context_id: DefaultContexts.scheduleE, archetype_mode: "TAX_SCHEDULE_E" });
        await store.upsert(FinanceCollections.transactions, "s1", { fitid: "s1", context_id: DefaultContexts.scheduleE, timestamp: "2026-02-10T00:00:00Z", amount: 10000, is_split: false });
        await store.upsert(FinanceCollections.transactions, "s2", { fitid: "s2", context_id: DefaultContexts.scheduleE, timestamp: "2026-02-20T00:00:00Z", amount: -500, is_split: false });

        const summary = await compileSalesTax(store, { taxYear: "2026", quarter: 1, rate: 0.0825, persist: true });
        expect(summary.taxable_sales).toBe(10000);
        expect(summary.tax_collected).toBeCloseTo(825, 2);
        const recs = await store.list(FinanceCollections.recommendations);
        expect((recs[0].data as any).kind).toBe("sales_tax_due");
    });
});

// ── Cadence additions: information returns ─────────────────────────────────
describe("information returns engine", () => {
    it("builds 1099 docs over the threshold and flags missing W-9s", async () => {
        await store.upsert(FinanceCollections.budgetContexts, DefaultContexts.scheduleE, { context_id: DefaultContexts.scheduleE, archetype_mode: "TAX_SCHEDULE_E" });
        await store.upsert(FinanceCollections.transactions, "p1", { fitid: "p1", context_id: DefaultContexts.scheduleE, payee_clean: "Jane Contractor", timestamp: "2025-06-01T00:00:00Z", amount: -2000, is_split: false });
        await store.upsert(FinanceCollections.transactions, "p2", { fitid: "p2", context_id: DefaultContexts.scheduleE, payee_clean: "Jane Contractor", timestamp: "2025-08-01T00:00:00Z", amount: -1500, is_split: false });
        await store.upsert(FinanceCollections.transactions, "p3", { fitid: "p3", context_id: DefaultContexts.scheduleE, payee_clean: "Tiny Vendor", timestamp: "2025-09-01T00:00:00Z", amount: -200, is_split: false });

        const res = await assembleInformationReturns(store, { taxYear: "2025", persist: true });
        expect(res.documents).toHaveLength(1); // only Jane cleared $600
        expect(res.documents[0].total_paid).toBe(3500);
        expect(res.documents[0].filing_status).toBe("PENDING"); // no W-9 yet
        expect(res.missingW9).toContain("Jane Contractor");
    });

    it("marks a doc READY and preserves flags once the W-9 is on file", async () => {
        await store.upsert(FinanceCollections.budgetContexts, DefaultContexts.scheduleE, { context_id: DefaultContexts.scheduleE, archetype_mode: "TAX_SCHEDULE_E" });
        await store.upsert(FinanceCollections.transactions, "p1", { fitid: "p1", context_id: DefaultContexts.scheduleE, payee_clean: "Jane Contractor", timestamp: "2025-06-01T00:00:00Z", amount: -3500, is_split: false });
        // Pre-existing doc with verified W-9/TIN.
        await store.upsert(FinanceCollections.taxDocuments, "2025-jane-contractor", {
            doc_id: "2025-jane-contractor", tax_year: "2025", recipient_name: "Jane Contractor",
            recipient_type: "CONTRACTOR_1099", form_type: "1099-NEC", total_paid: 0,
            w9_on_file: true, tin_verified: true, filing_status: "PENDING",
        });
        const res = await assembleInformationReturns(store, { taxYear: "2025", persist: true });
        expect(res.documents[0].filing_status).toBe("READY");
        expect(res.missingW9).toHaveLength(0);
    });
});
