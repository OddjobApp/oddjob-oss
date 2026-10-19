/**
 * DB-backed RecordStore for the Sales Opportunity Pipeline. Kept SEPARATE from
 * record-store.ts / opportunity-window.service.ts so importing the engine never
 * pulls a database connection (the engine unit-tests against InMemoryRecordStore).
 *
 * The underlying AppRecordsStore is app-agnostic — it namespaces every read/write
 * by (appId, orgId, collection). We only need to resolve the SALES workbench app
 * id (not BudgetMaster's), so we reuse finance's generic resolver with the sales
 * slug and hand the id to the same store implementation.
 */

import { AppRecordsStore, resolveFinanceAppId } from "../../finance/core/app-records-store.js";

/** The Sales Opportunity Workbench app owns the sales collections. */
export const SALES_APP_SLUG = "sales-opportunity-workbench";

/** Resolve a DB-backed store scoped to the org's sales workbench app. */
export async function salesStoreForOrg(orgId: number): Promise<AppRecordsStore> {
    const appId = await resolveFinanceAppId(orgId, SALES_APP_SLUG);
    if (appId == null) {
        throw new Error(`Sales Opportunity Pipeline app not installed for org ${orgId} (slug ${SALES_APP_SLUG})`);
    }
    return new AppRecordsStore(appId, orgId);
}
