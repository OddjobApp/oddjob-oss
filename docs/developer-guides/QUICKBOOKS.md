# QuickBooks Online integration

Uses Intuit OAuth 2.0 and the QuickBooks Online Accounting API. This does not
connect QuickBooks Desktop. Existing `saas_connectors` and encrypted OAuth token
storage are reused. Mirrored remote↔local record pairs are tracked in
`saas_sync_links` (migration 0145).

## Enable a connection

1. Create a QuickBooks Online app at https://developer.intuit.com/ with the
   `com.intuit.quickbooks.accounting` scope.
2. Configure the server's `QUICKBOOKS_CLIENT_ID` and
   `QUICKBOOKS_CLIENT_SECRET`. Keep the secret on the server.
3. Set `QUICKBOOKS_ENVIRONMENT=sandbox` initially. Choose production explicitly
   with the corresponding production app credentials when ready.
4. Restart the server. Open project Integrations (or organization Integrations)
   and register the exact callback URL displayed in the QuickBooks setup card.
   Default local callback:
   `http://localhost:5000/api/saas/connectors/quickbooks/oauth/callback`.
   Use an Intuit-approved HTTPS callback for production. `API_BASE_URL` can pin
   a stable public/tunnel address. Register the same URI in the Intuit portal.
5. Click Connect QuickBooks, select the company in Intuit, and authorize it.
   The callback stores the returned company `realmId` and environment.
6. Click Test connection to verify the actual company name. Organization
   connections are inherited; project connections take precedence.

## CREW tools and cards

- `connect_platform` with `platform: quickbooks` creates the project connection card.
- `quickbooks_get_company`, `quickbooks_list_records`, `quickbooks_get_record`,
  and `quickbooks_get_report` perform deterministic reads. List queries are
  built from an entity allowlist, with bounded pagination and escaped search.
- Entities: Customer, Vendor, Account, Item, Invoice, Bill, Purchase, Payment, Estimate.
- Reports: ProfitAndLoss, BalanceSheet, CashFlow, AgedReceivables, AgedPayables.
- Financial report cards (`FinancialReportItemView`) render statement reads with
  executive KPI summary chips (Net Income, Total Revenue, OpEx, Gross Profit, Cash),
  aligned tabular rows, in-card search filtering, and raw/table mode toggles.
- Financial report cards include an "Insert in Scribe" action that dispatches the
  `scribe:insert-text` event, embedding formatted Markdown financial tables
  directly into the active Scribe Studio manuscript station.
- Result cards support selection, summarize/discuss, variance analysis, and platform-specific
  source reads. Invoice proposals have a separate persisted review card.
- `quickbooks_propose_invoice` validates the actual customer and items and
  saves an approval. Only approval creates the unpaid invoice. It never emails
  an invoice, charges a customer, or edits/deletes existing records.
- `quickbooks_propose_customer`, `quickbooks_propose_payment` and
  `quickbooks_propose_void_invoice` save the same kind of review card for
  customer creation, payments against open invoices, and invoice voids.
- Approval rechecks the company, currency, customer and items. The persisted
  approval ID is used as Intuit's request ID to prevent retry-created duplicates.
- Disconnect revokes the Intuit token and removes encrypted token storage.

## Sync

Enabling bidirectional-sync on the connector (`POST
/api/saas/connectors/quickbooks/bidirectional-sync`, or the shared sync-config
route) registers a `saas_sync_configs` row the `SaaSSyncWorker` picks up on its
five-minute poll, honoring `syncInterval`. `filters.entities` restricts the
entity set; `filters.contextId` routes mirrored finance records to a budget
context (default `ctx_business_schedule_e`).

- First sync is a full paged pull of each entity into the
  `platform:quickbooks` dataset. Later syncs use Intuit Change Data Capture
  (`/cdc?entities=…&changedSince=…`) with a watermark on the connector config;
  a watermark older than the ~30-day CDC lookback falls back to a full pull.
- Invoices, payments and purchases also mirror into the BudgetMaster
  `receivables`/`transactions` collections under
  `qbo:{realmId}:{connectorId}:{entity}:{id}` record ids, so the receivables
  sweep and cash-flow forecast see them. Orgs without BudgetMaster installed
  get dataset-only sync. Local annotations (reminder timestamps, context
  overrides) survive re-sync; QuickBooks wins mirrored fields.
- Records deleted in QuickBooks are removed from the finance mirror and the
  link table. Dataset items are append-only and keep the original discovery.
- Approval-created records write an `out` link row so inbound sync upserts
  rather than duplicating them.

## Webhooks

`POST /api/webhook/quickbooks` accepts Intuit change notifications when
`QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN` is configured. The endpoint verifies
`intuit-signature` (base64 HMAC-SHA256 of the raw body) and parses both the
legacy `eventNotifications` envelope and the CloudEvents format. Notifications
only carry ids; each changed entity is fetched through its connector and
mirrored the same way as a sync pull, and `quickbooks.<entity>_<operation>`
events are published for `saas_event_workflows` triggers. Deliveries for
unregistered or disconnected companies are acknowledged and skipped. Register
`{API_BASE_URL}/api/webhook/quickbooks` in the Intuit app, choosing the entity
operations needed; the scheduled CDC sync reconciles anything webhooks miss.

Tokens refresh automatically; simultaneous refresh requests are coalesced in
each server process. No recurring AI calls are added. Intuit API limits and
applicable Intuit app charges still apply. Accounting reads can contain
sensitive customer information: all calls resolve through the current
organization and authorized project scope.

Live OAuth, company permissions and invoice creation need an actual Intuit app
and sandbox company; mocked checks do not establish live connectivity.

## Tenant isolation

OAuth credentials remain organization/project scoped. Verified webhook events fan
out only to active connections for the matching company and configured environment;
each connection refreshes and publishes under its own organization. Sync refuses
an organization/connector mismatch before fetching or accessing local records.
Sync link reads, writes, and deletes include the organization boundary.

New dataset and finance identities include company realm ID and connector ID:
`qbo:<realmId>:<connectorId>:<entity>:<remoteId>`. Approved writes use that same
identity. Reauthorizing clears the CDC watermark so a changed company receives a
full initial sync. Legacy unqualified mirror rows are not automatically deleted
or reassigned because their company ownership can be ambiguous; review those
historical rows before including both legacy and new mirrors in financial totals.

Disconnect removes only the chosen connection's tokens. When another active
organization/project connection uses the same company grant, the integration
retains the Intuit authorization; revoking it would break that other connection.
When the last connection is removed, Intuit authorization is revoked as well.


## Financial relationships and calculations

Every supported entity keeps its latest source snapshot in `saas_sync_links.remote_data` (runtime migration `0146_financial_source_snapshots`). The first sync after upgrading automatically performs a full pull to backfill existing links before using CDC. Newly enabled entity types also receive a full initial pull. Defaults seed on ontology reads for existing organizations as well as new ones.

The financial ontology registers all supported QuickBooks entity types plus Financial Record, Financial Line, Financial Allocation and Financial Currency. Identities include company and connector; customer, vendor, account, item and applied-transaction links never join remote IDs across connections. Line detail types distinguish subtotals, discounts, tax and actual charges. Multi-target linked transaction lines retain relationships but do not invent per-target allocation amounts. Company home currency is sourced from [QuickBooks Preferences](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/preferences) during sync when a record does not specify its own currency.

Graph calculation inputs accept an explicit `field` and expected `currency` on input references or `INPUT_TO` edge data. A currency-valued output (`outputUnit` is an ISO code) requires explicit fields and matching source currencies. Missing inputs fail rather than defaulting to zero; monetary sums use decimal arithmetic.

`quickbooks_calculate_total` reads current source records across all pages, selecting a specific monetary field and reporting separate currency totals with record counts. CREW preflights simple unfiltered sums (including open invoice balances) through this executed tool. Customer/date/selected-record questions retain the regular tool path rather than incorrectly calculating an unfiltered company total. Generic dataset financial aggregation also refuses mixed/unknown currencies and incomplete inputs.

## Financial reporting cards & Scribe Studio bridge

Financial statement queries (`quickbooks_get_report`) return interactive report structures containing headers, columns, and rows (for Profit & Loss, Balance Sheet, Cash Flow, and Aging reports).

### Component architecture:
- `FinancialReportItemView` (`client/src/components/agent-chat/FinancialReportItemView.tsx`):
  - Renders Intuit financial reports with sticky headers and responsive column alignment.
  - Automatically extracts and displays KPI summary chips (*Net Income*, *Total Revenue*, *Total Expenses*, *Gross Profit*, *Cash Balance*).
  - Provides in-card line-item search filtering and Table/Raw view modes.
  - Includes **"Copy table"** to extract GitHub-Flavored Markdown tables.
  - Includes **"Insert in Scribe"** which broadcasts the `scribe:insert-text` window event.
- `GeneratedImageCard` (`client/src/components/agent-chat/GeneratedImageCard.tsx`):
  - Renders generated image artifacts with title, prompt details, zoom modal, markdown copy, and direct **"Insert in Scribe"** button.

### Scribe Studio document structure & placement:
- Scribe Studio documents are organized into sequential stations along the left-rail **Vertical Subway Spine** (`VerticalSubwaySpine.tsx`).
- Injected content lands in the **active station** on the canvas (`LivingDocumentCanvas.tsx`). If the station only has template scaffolding, the inserted table replaces it; otherwise, it appends to the bottom of the section.
- Authors identify placement via the highlighted station beacon on the subway spine, station title anchor, and real-time word count telemetry.
- Content can be moved within stations using standard rich-text or markdown cut/paste, across stations by switching active spine nodes, or reordered structurally using the subway spine `▲` / `▼` station reordering controls.

