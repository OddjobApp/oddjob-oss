---
id: apps-in-crew
title: Working with Installed Apps from a CREW Room — Reading App Records and Answering App Requests
audience: [AGENT_PRIMARY, HYBRID]
badge: AGENT_PRIMARY
category: 06-agent-runtime-runbooks
autonomy_level: L2-L3
version: 1.2.0
tags: [apps, crew-rooms, app-records, read_app_records, read_app_activity, aggregate, quickbooks, finance-roles, hil, input-request, tenant-scoping, project-spaces, mounted-app, surface-approval]
summary: How a CREW agent finds an installed app, reads or totals the records it holds for this organization, grounds on the mounted app's view and selected record, and handles the requests an app raises for a person — with the tenant, project, room, finance-role and honesty rules that apply to each.
verification_status: verified
applies_when:
  - Someone asks what is IN an app — its transactions, defects, tickets, rescues, backlog
  - Someone asks to compare, total, count or summarise data an installed app holds
  - Someone asks what happened inside an app recently — its app-scoped telemetry
  - The room has an app mounted in App Studio and someone asks about the open view or selected record
  - A turn in an app's "· Requests" room shows an input_request card from that app
do_not_use_when:
  - Someone asks to OPEN or launch an app — use list_installed_apps then render_app_surface
  - Someone asks to BUILD or change an app — use the App Forge / App Studio tools
  - The data lives in a platform dataset, not an app — use list_datasets and get_dataset_items
  - You need live QuickBooks data or a QuickBooks report — use the quickbooks_* tools; an app's QuickBooks collections are a synced copy
  - You would need to WRITE to an app's records — no agent tool does that; propose the change instead
required_tools:
  - list_installed_apps
  - read_app_records
  - read_app_activity
  - propose_app_action
preconditions:
  - The turn carries an organization context; read_app_records and propose_app_action refuse without one
  - The app slug comes from list_installed_apps, never from memory or a guess
approval_requirements:
  - None for reading.
  - Mutations to an app's records (create, update, delete) MUST go through propose_app_action to render an approval card for human review
  - Collections mirrored from QuickBooks need the same finance role the quickbooks_* tools need
success_checks:
  - The answer quotes the tool's summary ("Returned N of M matching record(s)" or "sum of X over N of M")
  - Every figure in the answer comes from a read_app_records result in this turn
  - Totals, averages and counts come from an aggregate call, not from adding up a page of rows
  - A collection name used in a read came from that app's collection listing
stop_conditions:
  - read_app_records threw "No app ... is available to this organization" — the app is absent or not visible to this caller; say so, do not retry with invented slugs
  - read_app_records threw "belongs to a private Project Space other than this room's" — do not try to work around it; say the data must be read from a room in that project
  - A finance-role refusal (a card is shown) — say in one sentence that the access is missing; do not retry
  - The collection listing is empty — the app holds no records for this organization; say so
  - An identical call already failed this turn — change the arguments or stop
escalation:
  - If the person expects data the listing does not show, say what the listing returned and suggest checking the app itself; do not speculate about where else it might be
implementation_evidence:
  - server/domain/tools/v1/capabilities/app-records-tools.ts
  - server/domain/tools/v1/capabilities/app-records-tools.test.ts
  - server/domain/apps/core/app-records-reader.service.ts
  - server/domain/apps/tests/integration/app-records-reader.integration.test.ts
  - server/domain/crew/core/crew-app-requests.service.ts
  - server/domain/crew/tests/integration/crew-app-requests.integration.test.ts
  - server/domain/pipeline/core/hil-requests.service.ts
  - server/domain/pipeline/core/hil.service.ts
  - server/domain/crew/core/crew-mounted-app-context.service.ts
  - server/domain/crew/core/crew-surface-approval.ts
  - server/middleware/crew-app-activity-bridge.ts
  - shared/crew-surface-request.ts
  - client/src/components/agent-chat/CrewCycleAppCanvas.tsx
  - server/domain/apps/platform/blueprint-crew-contract.test.ts
  - client/src/components/agent-chat/turns/TurnAssistantFormCard.tsx
---

# Working with Installed Apps from a CREW Room `[🤖 AGENT]`

> **Audience:** `🤖 Agent-primary` &nbsp;|&nbsp; **Classification:** Agent Runtime Runbook

An installed app is two things to a room: **data it holds** (rows in `app_records`, grouped
into collections) and **questions it asks a person** (pending HIL requests). This runbook covers
both. Opening, building and changing apps are covered by the App Forge tools, not here.

---

## 1. Decide which question you were asked

| The person says… | It is a… | Do this |
| :--- | :--- | :--- |
| "Open / launch / show me the BudgetMaster app" | launch | `list_installed_apps` → `render_app_surface` |
| "Show me the open defects in QA Workbench" | rows | `list_installed_apps` → `read_app_records` (§2) |
| "How much did we spend per vendor?" / "How many rescues are open?" | total / count | `read_app_records` with `aggregate` (§3) |
| "What happened in this app recently?" | activity | `read_app_activity` (§3a) |
| "What's blocking this?" with an app mounted in the room | mounted context | §3b — the binding is already resolved for you |
| "What's our P&L?" / "Aged receivables?" | QuickBooks report | `quickbooks_get_report` — not this runbook |
| "Build me an app that…" / "change this app so…" | build | App Forge / App Studio tools |
| A card from an app in a "· Requests" room | app request | §5 |

Do not open an app to answer a data question. Opening it hands the person a screen and leaves
them to find the answer themselves.

## 2. Reading rows

Always: **discover, then read**.

1. **Resolve the app.** Call `list_installed_apps` and take the app's `slug` from the result.
   A display name also resolves, but a slug is exact.
2. **List its collections.** Call `read_app_records({ app: "<slug>" })` with no collection.
   Each collection comes with its record count, when it last changed, and `quickbooks: true` if
   it is mirrored from QuickBooks (§4).
3. **Read one collection.** `read_app_records({ app, collection })`. Narrow it:
   - `filterField` + `filterValue` — exact match on one top-level field, case-insensitive.
   - `fields` — only these top-level fields per record. **Use it**: records are often wide, and
     fewer fields means more records per call.
   - `limit` (default 25, max 100) is a ceiling, not a promise — see below.
   Rows come newest first, by `updatedAt`.

```json
{ "app": "budgetmaster-workbench" }
{ "app": "budgetmaster-workbench", "collection": "transactions", "fields": ["timestamp", "payee_raw", "amount", "currency"] }
```

**A response holds only what fits.** The tool returns as many records as fit one response and
says so in `summary`: `Returned 6 of 51 matching record(s)… 45 more: call again with offset 6.`
To page, pass the `nextOffset` it gave you — never `offset + limit`, which skips the records that
did not fit.

**Never invent a collection name.** Use one from step 2. Only identifiers are accepted —
letters, digits, `_` and `-`.

## 3. Totals, averages and counts

Do not add up rows yourself. A page is rarely the whole collection, and paging through 50 rows
to sum them wastes the turn. Ask the database:

```json
{ "app": "budgetmaster-workbench", "collection": "transactions",
  "aggregate": { "op": "sum", "field": "amount", "groupBy": "payee_raw" } }
{ "app": "rescue-dispatch", "collection": "active_rescues", "filterField": "status", "filterValue": "open",
  "aggregate": { "op": "count" } }
```

- `op`: `count`, `sum`, `avg`, `min`, `max`. Every op except `count` needs a numeric `field`.
- `groupBy`: one value per distinct value of that field, largest first, top 50.
- **Read the summary.** `sum of amount over 48 of 51 matching record(s) (3 had no numeric amount
  and were skipped)` — say both numbers. Skipped records were not counted as zero.
- **Currencies are not mixed.** A `sum` or `avg` over records in several currencies is refused.
  Group by `currency`, or filter on one, and report each currency separately.

## 3a. App activity — `read_app_activity`

`read_app_activity` returns an app's persisted, app-reported telemetry (`app_telemetry`)
scoped to that app **and** this organization: event ids, names, levels, timestamps, scope,
and a cursor (`nextBeforeId`) for paging backwards. Arbitrary metadata blobs are omitted,
so an app cannot smuggle prompt content into your context through its own telemetry.

- **Activity is not proof.** These are events the app chose to report — not execution
  receipts, not approvals, not deployments. Never cite an `app_telemetry` row as evidence
  that a mission ran or a decision was ratified; mission runs and approvals have their own
  records.
- **It is organization-wide**, not room-bound: the feed reflects what the app reported,
  whoever was looking at it.

## 3b. The mounted app in this room

When the person has an app open in the room's App Studio canvas, the server resolves the
mount itself and injects `[Mounted app binding resolved by server]` into your context:
the canonical app id and slug, the browser-reported path (a **view hint**), the app's
collections with counts, and — when the app reported one — a `selectedRecord` verified
against the app's records under this organization before it was let into context.

- Use the canonical `slug` from the binding with `read_app_records` / `read_app_activity`
  — do not resolve the app from the browser path yourself.
- The path and selected record tell you what the person is *looking at*; they are not
  evidence of record contents or permission. Read the record before quoting it.
- If the binding says context is unavailable under this room's access scope, say so —
  do not infer the app's records or execution state.
- When a `propose_app_action` approval tied to the mounted app resolves, the host signals
  the app to refresh — no action needed from you.

## 4. QuickBooks-mirrored collections

BudgetMaster's `receivables` and `transactions` are copied from the organization's QuickBooks
connection (Invoices → receivables; Payments and Purchases → transactions). They are the same
financial data the `quickbooks_*` tools guard, so they need the **same finance role**, judged
on the project of the QuickBooks connection that wrote them:

| Record type | Readable by |
| :--- | :--- |
| Invoice, Payment | AR, AP, Audit, Executive |
| Purchase | AP, Audit, Executive |

A collection holding several types needs a role that can read all of them — BudgetMaster
`transactions` (Payments **and** Purchases) is refused to an AR-only caller. A refusal renders a
card telling the person what access is missing; say so in one sentence and stop.

The copy is synced periodically. For figures that must be current to the minute, or for P&L,
balance sheet, cash flow and aged receivables/payables, use the `quickbooks_*` tools directly.

## 5. Requests an app raises

When an app needs a person (`POST /api/oddjob/hil` from the app), the request is created as a
pending HIL form **and** posted into a standing room for that app, titled
**"‹App name› · Requests"**, as an `input_request` card. One room per app per organization,
reused for every request, placed in the app's Project Space. The people who answer for the app —
the project's owner and members, or the org admins for an app outside any project — are in that
room and are sent a notification that opens it.

- **The person answers the card, not you.** You have no tool that submits an app's request on
  someone's behalf, and you must not claim one was answered.
- **After someone submits, a message appears:** `I submitted the "<form>" form with: {...}`.
  That message is only posted when the server accepted the answer. Treat it as the decision:
  acknowledge it in one line and, if it helps, say what the app will now do.
- **One answer wins.** A request can be offered in the room and in the app at once; only the first
  answer is recorded. A later submission shows *Not submitted: … is completed, so it cannot be
  submitted* (or *Form already submitted* in a near-simultaneous race) on the card, and no
  message is posted. If asked, say the request was already answered elsewhere.
- **Answering resumes the app.** The app polls `/hil/:formId/poll` for the answer, and a
  pipeline step waiting on the form is resumed. Nothing else needs to be done in the room.

## 6. Proposing writes and record mutations (`propose_app_action`)

Agents in CREW rooms can propose creating, updating, or deleting records in an app's collections
using `propose_app_action`. All mutations are approval-gated and rendered as a structured
`InlineApprovalCard` (via `AppActionApprovalView`) so the user sees the target app, collection,
action, and clean key-value fields before confirming:

1. **Parameters:**
   - `app`: app slug or display name (e.g. `"budgetmaster-workbench"`, `"rescue-dispatch"`).
   - `action`: `"create_record"`, `"update_record"`, or `"delete_record"`.
   - `collection`: target collection name (e.g. `"transactions"`, `"active_rescues"`).
   - `recordId`: optional on `create_record` (auto-generated if omitted); **required** on `update_record` and `delete_record`.
   - `data`: key-value object of record fields to set or merge.
   - `reason`: clear human-readable explanation of why this mutation is proposed.

2. **Execution & Audit:**
   - The tool saves a pending proposal under `approvalRequests` with `kind: "app_record_action"`.
   - The proposal renders with a custom `<Layers />` badge, humanized labels, and zero raw JSON.
   - Upon user approval, the backend executes `executeAppRecordAction`, strictly scoped by `orgId` and `appId`.
   - If the user rejects or discards, the proposal records discarded status and leaves the records unchanged.

```json
{
  "app": "budgetmaster-workbench",
  "action": "create_record",
  "collection": "transactions",
  "data": {
    "amount": 250.00,
    "payee_raw": "AWS Hosting Services",
    "category": "Cloud Infrastructure"
  },
  "reason": "Logging verified server hosting fee for the current cycle."
}
```

## 7. Requests from an app mounted in this room

An app embedded in the room's canvas can also raise a request directly over the surface
bridge (`crew-surface-request`): a `question`/`form` card, or an `approval` card bound to a
persisted `app_record_action` proposal. These appear in the room transcript as governed
input cards, distinct from the "· Requests" rooms of §5.

- **Bound means bound.** The host only renders an approval the server can verify belongs
  to *this app in this room* (`kind: "app_record_action"` matching the mounted app's id and
  the room key). An app cannot surface another app's or another room's approval.
- **The person answers the card**, same as §5 — you have no tool that submits it for them.
- **Answering signals the app.** A submitted bound approval sends a `crew-host-event` back
  to the embedded app so it refreshes itself; nothing else is required in the room.

## 8. Boundaries you can rely on — and must not try to get around

These are enforced in the tool, not by you, but knowing them tells you what a refusal means:

- **This organization only.** Records are always filtered to the caller's org. A shared app
  row (one that several orgs write to) returns only this org's rows.
- **Never another org's app.** Another organization's install copy does not resolve, even by
  its exact slug. Its refusal is identical to "no such app".
- **Private projects stay private.** An app whose deployment (or, failing that, app record) sits
  in a Project Space the person cannot read resolves exactly like a missing one. Inside CREW
  the check is on the person in the room — being an org admin does not bypass it — and a
  governed agent is held to its own project grants as well.
- **The room is the audience.** Your reply is read by everyone in the room. A private project's
  app data is only read into a room **of that same project**; from any other room, including one
  with no project, it is refused even when the person could read it.
- **QuickBooks data needs a finance role** (§4).
- **No organization, no read or write.** Without an org context the tools refuse; they never fall back to
  a default organization.
- **Writes are approval-gated.** Direct silent side-effects to an app's records are prohibited;
  agents must use `propose_app_action` to request human sign-off.

## 9. Failure handling


| What you see | What it means | What to do |
| :--- | :--- | :--- |
| `No app '<x>' is available to this organization` | absent, another org's, or in a private project the person cannot read | Say the app is not available here. Offer `list_installed_apps`. Do not guess other slugs. |
| `… belongs to a private Project Space other than this room's …` | the data is real but this room is the wrong audience | Say it has to be read from a room in that project. |
| A card: *QuickBooks access needed* | no finance role for a record type in the collection | One sentence that access is missing. Do not retry. |
| `These records are in N currencies…` | a sum/avg would mix units | Re-run with `groupBy: "currency"` or a currency filter. |
| `'sum' needs a numeric field.` | aggregate without `field` | Add the field, or use `count`. |
| `Invalid collection name` / `Invalid filter field` | not an identifier | Use a name from the collection listing. |
| `filterValue is required with filterField` | half a filter | Send both, or neither. |
| `Organization context required` | the turn has no org | Stop. This is not something you can fix by retrying. |
| repeat of an identical call that already failed | you sent the same arguments again | Change the arguments or stop calling it. |

## 10. Why it works this way `[🧑 Human]`

App data used to reach CREW only for Rescue Dispatch, through its own tool, so a room could
open BudgetMaster but not answer a question about its transactions. And an app's requests for a
person waited inside the app until someone happened to open it. `read_app_records` and the
"· Requests" rooms close both gaps without giving agents a write path.

Where an org's records live is not uniform: some orgs write against the shared system app row
under their own org id (BudgetMaster, Rescue Dispatch), others to their own install copy
(`<slug>-org<orgId>`). The tool considers both, prefers the one holding this org's records, and
filters every read by org — so the shared row is safe to read.

Responses are sized by the tool because CREW cuts any tool output over 4,000 characters. Before
that, a 25-row page arrived as 6 rows under a header still claiming 25, and agents reported rows
they never saw.

The finance-role check exists because BudgetMaster's QuickBooks copy would otherwise have been a
way around the per-entity roles the QuickBooks tools enforce.

A dedicated requests room was chosen over posting into whichever room was last active: a form
dropped into an unrelated discussion is noise there and easy to lose. Its handlers are made
participants because the room list shows the rooms a person takes part in — a room with no
participants is in nobody's list. The Slack/Teams announcement links to the room.

Known limits:

- Only requests an app raises through the app platform API (`source: "app"`) are posted. A
  pipeline step inside an app's mission that pauses for a form is not yet routed to the room.
- An app can request structured choices (e.g. approve/reject, radio options, dropdowns, custom
  submit labels) by passing `fields` or `schema` to `POST /api/oddjob/hil`. If omitted, it falls
  back to a free-text "Response" field.
- Answering a card posts a message, which starts a short round; the room recruits an agent
  (usually the Copilot) to acknowledge it.
- A card answered elsewhere stays visible in the room; it only reports itself stale on submit.
- The answer endpoint accepts any member of the organization, not only the room's project.
