/**
 * DB-backed RecordStore over `app_records`. Kept separate from record-store.ts
 * so importing a finance service never pulls a database connection (tests use
 * InMemoryRecordStore). Reads/writes are namespaced by (appId, orgId,
 * collection) exactly like the /datasets platform endpoint.
 */

import { and, eq, or } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { apps, appRecords } from "@shared/schema/index.js";
import { RecordStore, FinanceRecord, DuplicateRecordError } from "./record-store.js";

/** The BudgetMaster workbench app owns the finance collections. */
export const FINANCE_APP_SLUG = "budgetmaster-workbench";

/**
 * Resolve the numeric app id that owns the finance datasets for an org.
 *
 * The cycle installer (org-forge.service.ts) registers per-org apps under an
 * org-suffixed slug (`<base>-org<orgId>`) to dodge the global `apps.slug`
 * uniqueness constraint; only the first org to claim a base slug keeps it bare.
 * Resolution therefore mirrors the installer's own lookup: match the base slug
 * OR the org-suffixed variant, scoped to this org.
 */
export async function resolveFinanceAppId(orgId: number, slug: string = FINANCE_APP_SLUG): Promise<number | null> {
    const orgSuffixedSlug = `${slug}-org${orgId}`;
    const [row] = await db
        .select({ id: apps.id })
        .from(apps)
        .where(and(
            or(eq(apps.slug, slug), eq(apps.slug, orgSuffixedSlug)),
            eq(apps.organizationId, orgId),
        ))
        .limit(1);
    if (row) return row.id;
    // Fall back to a slug-only match (system/shared app) when not org-scoped.
    const [shared] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug)).limit(1);
    return shared?.id ?? null;
}

export class AppRecordsStore implements RecordStore {
    constructor(private appId: number, private orgId: number) {}

    static async forOrg(orgId: number, slug?: string): Promise<AppRecordsStore> {
        const appId = await resolveFinanceAppId(orgId, slug);
        if (appId == null) {
            throw new Error(`BudgetMaster app not installed for org ${orgId} (slug ${slug ?? FINANCE_APP_SLUG})`);
        }
        return new AppRecordsStore(appId, orgId);
    }

    private scope(collection: string) {
        return and(
            eq(appRecords.appId, this.appId),
            eq(appRecords.orgId, this.orgId),
            eq(appRecords.collection, collection),
        );
    }

    async list<T = Record<string, any>>(collection: string): Promise<FinanceRecord<T>[]> {
        const rows = await db.select().from(appRecords).where(this.scope(collection));
        return rows.map((r) => ({ recordId: r.recordId, data: r.data as T }));
    }

    async get<T = Record<string, any>>(collection: string, recordId: string): Promise<FinanceRecord<T> | null> {
        const [row] = await db
            .select()
            .from(appRecords)
            .where(and(this.scope(collection), eq(appRecords.recordId, recordId)))
            .limit(1);
        return row ? { recordId: row.recordId, data: row.data as T } : null;
    }

    async upsert<T = Record<string, any>>(
        collection: string,
        recordId: string,
        data: T,
        opts?: { failIfExists?: boolean },
    ): Promise<void> {
        const [existing] = await db
            .select({ id: appRecords.id })
            .from(appRecords)
            .where(and(this.scope(collection), eq(appRecords.recordId, recordId)))
            .limit(1);

        if (existing) {
            if (opts?.failIfExists) throw new DuplicateRecordError(collection, recordId);
            await db
                .update(appRecords)
                .set({ data: data as any, updatedAt: new Date() })
                .where(eq(appRecords.id, existing.id));
            return;
        }

        await db.insert(appRecords).values({
            appId: this.appId,
            orgId: this.orgId,
            collection,
            recordId,
            data: data as any,
        });
    }

    async delete(collection: string, recordId: string): Promise<void> {
        await db.delete(appRecords).where(and(this.scope(collection), eq(appRecords.recordId, recordId)));
    }
}
