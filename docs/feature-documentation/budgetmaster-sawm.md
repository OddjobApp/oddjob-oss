# BudgetMaster — Sovereign Algorithmic Wealth Matrix (SAWM)

> Self-contained Oddjob **Cycle Blueprint** + two dependent apps that turn the BudgetMaster
> PRD (`Oddjob-Docs/BudgetMaster.md`) into a native, install-once personal-finance engine.
> Installing the `budgetmaster` cycle provisions every dataset, agent, form, mission,
> schedule, escalation, and app for an org — **no database migration is run**.

**Status:** Implemented. 14/14 unit tests green · cycle YAML schema-valid · typecheck at baseline (zero new errors).

---

## **Feature Overview**

### **Purpose & Business Value**
Personal finance in Oddjob: hot-folder statement ingestion (OFX/QIF/CSV), AI categorization
and reconciliation, net-worth/forecast analytics, and four autonomous "treasury" engines that
watch cash, recurring expenses, expected income, and capital purchases — surfacing advice as
**HIL-gated recommendations**. It demonstrates that a full vertical product (datasets + agents +
missions + UI) can ship as a single declarative cycle with zero bespoke schema.

### **User Personas & Use Cases**
- **Household CFO / Owner** — drops statements in a watched folder, reviews the ledger, approves
  cash sweeps / subscription cancellations, runs purchase "what-if" sandboxes, asks the advisor
  natural-language questions.
- **Treasury Supervisor (agent)** — orchestrates the monthly close and triages anomalies to HIL.

### **Key Requirements & Constraints (must preserve)**
1. **Datasets, not Drizzle.** Finance entities are declared as `knowledge_datasets` in the cycle
   YAML; rows live in `appRecords` (org-isolated JSONB). **No migration, no `shared/schema/finance/`.**
2. **FITID = recordId.** `transactions` primary key is `fitid`, so the `appRecords` unique index
   gives idempotent dedupe for free.
3. **Advisory-only money movement.** No bank rails. Every sweep / lock / cancel is a
   `finance_recommendations` row + an HIL form — money never moves automatically
   (`guardrails.advisory_only_money_movement: true`).
4. **Gemini-first.** `ai_provider: google / gemini-2.0-flash`; full transaction context is sent to
   Gemini by deliberate user choice (overrides the PRD "zero outbound" stance).
5. **Determinism out of the LLM.** All money math (splits, amortization, drag, decay, locks) is in
   plain TypeScript services so it is unit-testable; the LLM only categorizes and advises.

### **Success Metrics**
- Re-ingesting a statement adds **zero** duplicate rows (FITID dedupe).
- Split transactions reject atomically when `sum(children) ≠ parent` (no partial write).
- An armed Dead Man's Switch past its deadline produces a FAULT + recommendation + HIL within one
  `dms_evaluate` tick.

---

## **User Interface Documentation**

### **Screens & Navigation**
Two Next.js (App Router) apps under `server/blueprints/apps/`:

**`budgetmaster-workbench`** — split-pane shell (`app/page.tsx`) routing to six modules
(`app/<module>/{page,content}.tsx`):

| Module | Route | Purpose |
| :-- | :-- | :-- |
| `ledger` | `/ledger` | Register grid, NL semantic search, account/status/text filters, click-to-cycle reconcile status, hides split children. |
| `accounts` | `/accounts` | Grouped account tree; assets / liabilities / net-worth KPIs. |
| `dashboard` | `/dashboard` | Recharts: net-worth/flow KPIs, spend-by-category bar, net-worth-trend line. |
| `forecast` | `/forecast` | 40-yr nominal vs inflation-adjusted projection with volatility band + assumption sliders. |
| `sandboxes` | `/sandboxes` | Capital purchase what-if; sliders trigger the `mission-capital-sandbox`. |
| `alerts` | `/alerts` | Dead Man's Switch pane + recommendation approve/dismiss (writes `finance_recommendations.status`). |

**`budgetmaster-advisor`** — single-page Gemini chat (`AgentChat` bound to **"Personal Financial
Advisor"**) with a live snapshot rail (net worth, accounts tracked, transactions on file).

### **Component Hierarchy**
- `app/page.tsx` → `dynamic(() => import('./content'), { ssr: false })` → `content.tsx` (`"use client"`).
- Shared `app/components/AgentChat.tsx` (emerald theme; resolves the agent's `jobId` by matching an
  `ai_agent` job by name, persists history to `localStorage`, POSTs to `/agents/{jobId}/chat`).
- `lib/platform-client.ts` — `records`, `knowledge`, `FinanceCollections`, finance types, `fmtCurrency`.

### **User Interactions**
Reconcile cycling (UNRECONCILED → CLEARED → RECONCILED), NL search over vectorized transactions,
slider-driven sandbox recompute (mirrors the server amortization), approve/dismiss recommendations,
chat. **Money-moving actions only ever create a recommendation + HIL form** — never a transfer.

### **Responsive Design**
Tailwind; dark-first (`#090d16`). Workbench inherits the platform UI system (virtualization,
filtering, dark mode, comparison view, a11y/i18n). Advisor uses a `lg:` two-column grid that
collapses to a single column on mobile.

---

## **API Documentation**

No bespoke finance API. Both apps talk to the platform through a same-origin proxy
`app/api/oddjob/[...path]/route.ts` → `${ODDJOB_PLATFORM_URL}/api/platform/app/*` with
`Authorization: Bearer ${ODDJOB_APP_TOKEN}`.

| Client call | Proxied endpoint | Purpose |
| :-- | :-- | :-- |
| `records.list(collection)` | `GET /datasets?collection=` | Read dataset rows from `appRecords`. |
| `records.upsert(...)` (workbench) | `POST /datasets` | Write/patch a row (e.g. reconcile status). |
| `knowledge.query(q, collection)` | `POST /knowledge/query` | Semantic search over vectorized rows. |
| `AgentChat` | `GET /jobs`, `POST /agents/{jobId}/chat` | Resolve + converse with an `ai_agent` job. |

Server-side, the engines read/write the **same `appRecords` table** via the `RecordStore`
abstraction (`AppRecordsStore.forOrg(orgId, slug?)`), org-scoped.

---

## **Component Architecture (server)**

### **Datasets (10 collections — `knowledge_datasets`)**
`budget_contexts` (pk `context_id`) · `budget_categories` (`category_id`) ·
`finance_accounts` (`account_id`) · **`transactions` (`fitid`, vectorized)** ·
`dead_mans_switches` (`switch_id`) · `installment_tokens` (`token_id`) ·
`subscriptions` (`subscription_id`) · `purchase_sandboxes` (`sandbox_id`) ·
`balance_snapshots` (`snapshot_id`) · **`finance_recommendations` (`rec_id`, vectorized)**.

### **Services** (`server/domain/finance/core/`, all over `appRecords`)
`statement-parser` (OFX/QIF/CSV + `routeContextForPath`) · `transaction` (split-ledger constraint
`SplitMismatchError`, FITID dedupe, balance update) · `dead-mans-switch` · `cash-drag` ·
`subscription-decay` · `amortization` (incl. zero-interest) · `balance-lock` (immutable snapshots,
CapEx burn).

### **Job types & executors**
Six types in `shared/schema/jobs/types.ts` with config schemas in `config-data.ts` and discriminated-union
entries in `table.ts`. Executors auto-discovered (`*-executor.ts`, `canExecute` + `execute`):

| Job type | Executor | Fired by |
| :-- | :-- | :-- |
| `statement_ingest` | `statement-ingest-executor.ts` | `mission-ingest` / `sched-ingest` (`*/15 * * * *`) |
| `dms_evaluate` | `dms-evaluate-executor.ts` | `mission-dms-watch` / `sched-dms` (`0 * * * *`) |
| `cash_drag_scan` | `cash-drag-scan-executor.ts` | `mission-cash-sweep` / `sched-cash-drag` (`0 0 * * *`) |
| `subscription_scan` | `subscription-scan-executor.ts` | `mission-subscription-decay` / `sched-subscription-decay` (`0 6 1 * *`) |
| `balance_lock` | `balance-lock-executor.ts` | `mission-monthly-lock` (`0 0 1 * *`) + `mission-capex-burn` (`0 12 * * 0`) |
| `amortize_sim` | `amortize-sim-executor.ts` | `mission-capital-sandbox` (on-demand from sandbox UI) |

### **Agents**
`ai-finance-categorizer` (worker) · `ai-financial-advisor` (worker, content-guardrailed: must cite
dataset rows, must not fabricate figures) · `ai-treasury-supervisor` (supervisor, monthly close + HIL triage).

### **HIL forms**
`cash_sweep_authorization` · `subscription_cancellation` · `dms_fault_response` · `capital_purchase_decision`.

---

## **Integration Points**

- **External:** Google Gemini (`gemini-2.0-flash`) via the cycle `ai_provider`; key from
  `${ENV.GEMINI_API_KEY}` / encrypted credentials. `escalations` route DMS-FAULT and cash-sweep
  events to Slack/email with `fallback_provider: oddjob` (in-app); optional calendar bill reminders.
- **Database:** none added. Rows live in `appRecords`; datasets registered into the `datasets`
  registry by `org-forge.service.ts installCycleApp` at install time.
- **Knowledge graph:** `vectorize: true` on `transactions` + `finance_recommendations` powers the
  advisor's RAG and the ledger's NL search.
- **Internal services:** `org-forge` (provisioning), mission/schedule engine, HIL/forms, the
  `/datasets` platform route, `AutoDiscoveryExecutorRegistry`.

---

## **Error Handling & Edge Cases**

- **Split-ledger:** `sum(children) ≠ parent` → `SplitMismatchError`, **no rows written**; balanced
  splits link children to `parent_tx_id`.
- **FITID dedupe:** duplicate `fitid` rejected by the `appRecords` unique index → counted as
  `skipped`, count unchanged.
- **DMS grace:** stays `ARMED` inside `grace_period_hours`; crosses to `FAULT` only past
  `deadline + grace`, emitting a `dms_fault` recommendation.
- **Ingest tolerance:** `collectFiles()` accepts `config.content` / `config.files` / `context.named.files`;
  context routed by subfolder unless `config.contextId` is set.
- **Amortization:** zero-interest handled (straight-line); sandbox persistence is best-effort try/catch.

---

## **Security & Permissions**
Org row-isolation on every `appRecords` access. Advisor/categorizer bounded by cycle `guardrails`
and budget/token caps. Money movement is structurally impossible (advisory records + HIL only).
App↔platform calls authenticated with `ODDJOB_APP_TOKEN`. **Privacy note:** full transaction
context is sent to Gemini by explicit user decision — this overrides the PRD's local-only stance and
is documented as such.

---

## **Testing Requirements**

### **Unit Tests** — `server/domain/finance/tests/finance-core.test.ts` (14, all passing)
Split-ledger reject + balanced link · FITID dedupe (re-ingest → `skipped:2`, count stable) ·
folder routing + parseOfx/parseQif/parseCsv/parseStatement · DMS timeout (FAULT past deadline+grace,
ARMED within grace) · cash drag · subscription decay · amortization (incl. zero-interest) ·
balance-lock immutability + CapEx overrun. Uses `InMemoryRecordStore` (no DB).

The four **PRD §7 acceptance gates** map to: split-ledger constraint, FITID dedupe, folder→context
routing, DMS timeout→FAULT.

### **Integration / E2E (recommended next)**
Install the cycle to a test org → assert `installCycleApp` provisions 10 datasets, 3 agents, 4 forms,
7 missions, 6 schedules, 2 apps with zero migrations. Drop sample `.ofx`/`.csv` into the hot-folder →
transactions land deduped + categorized + archived. Seed an armed DMS past deadline → FAULT + rec + HIL.

### **Verification commands**
```bash
# unit tests
npx vitest run server/domain/finance/tests/

# cycle YAML schema validation (Ajv against cycle-blueprint.schema.json)
node -e "const fs=require('fs'),yaml=require('js-yaml'),Ajv=require('ajv'); \
  const d=yaml.load(fs.readFileSync('server/cycles/budgetmaster.cycle.yaml','utf8')); \
  const s=JSON.parse(fs.readFileSync('server/cycles/cycle-blueprint.schema.json','utf8')); \
  const v=new (Ajv.default||Ajv)({allErrors:true,strict:false}).compile(s); \
  console.log(v(d)?'SCHEMA VALID':JSON.stringify(v.errors,null,2));"

# typecheck (baseline 241, expect zero new in touched files)
node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit
```

---

## **Migration Considerations**
- **No data migration** — `appRecords` JSONB store, no DDL.
- **Breaking changes:** none; six new job types are additive and the job config discriminated union
  is non-exhaustive (missing entries don't break creation).
- **Deployment:** install order is just "register the `budgetmaster` app slug → install to org";
  `installCycleApp` does the rest.

---

## **Current Issues & Technical Debt**
- Money math is duplicated client-side in the `sandboxes` module (mirrors `amortization.service.ts`)
  for instant slider feedback — keep the two in sync.
- App typechecking happens in each app's own Next build, not the root `tsc` run.
- Escalation channels and the calendar integration are declared in YAML but depend on org-level
  Slack/email/calendar credentials being configured.

---

## **Documentation References**
- **PRD:** `Oddjob-Docs/BudgetMaster.md` (SAWM).
- **Plan:** `~/.claude/plans/iterative-churning-wall.md`.
- **Cycle:** `server/cycles/budgetmaster.cycle.yaml`; schema `server/cycles/cycle-blueprint.schema.json`.
- **Cycles overview:** `docs/CYCLES.md`. **Provisioning:** `server/domain/org/core/org-forge.service.ts`.
- **Reference app pattern:** `server/blueprints/apps/research-workbench/`.
