import { decimalUnits, unitsDecimal, currencyScale } from '@shared/financial-money.js';
/**
 * QuickBooks inbound sync — mirrors company records into the organization.
 *
 * Every synced entity lands in the `platform:quickbooks` dataset (once per
 * remote record — the dataset is append-only, so the sync-link table is what
 * keeps repeated syncs from duplicating items). Invoices, payments and
 * purchases additionally mirror into the BudgetMaster finance collections so
 * the receivables sweep and cash-flow forecast see them; orgs without
 * BudgetMaster installed simply skip the finance mirror.
 *
 * Incremental pulls use Intuit's Change Data Capture endpoint with a
 * watermark on the connector config. The CDC lookback is capped near 30
 * days by Intuit, so a stale watermark falls back to a full paged pull.
 *
 * Conflict handling is `last_write_wins`: QuickBooks is the system of record
 * and wins every mirrored field whenever MetaData.LastUpdatedTime moves;
 * local-only annotations on mirrored records (last_reminder_at, an overridden
 * context_id) are preserved across syncs.
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { saasConnectors, saasSchemaSnapshots, saasSyncConfigs, type SaasConnector } from '@shared/schema/index.js';
import { datasetService } from '../../knowledge/index.js';
import { eventStream } from '../../core/infrastructure/event-stream.service.js';
import { createLogger } from '@server/utils/logger.js';
import { AppRecordsStore } from '@domain/finance/core/app-records-store.js';
import { FinanceCollections, DefaultContexts } from '@domain/finance/core/collections.js';
import { QUICKBOOKS_ENTITIES, type QuickBooksEntity, type QuickBooksClient } from './client.js';
import { assertQuickBooksScope, quickBooksRecordKey, clientForConnector, deleteSyncLink, findSyncLink, upsertSyncLink } from './service.js';

const logger = createLogger('QuickBooksSync');

/** Entities mirrored into finance collections; the rest are dataset-only. */
const FINANCE_ENTITIES = new Set<QuickBooksEntity>(['Invoice', 'Payment', 'Purchase']);
/** CDC lookback is capped near 30 days by Intuit — refresh inside it, with overlap for in-flight writes. */
const CDC_MAX_AGE_MS = 25 * 24 * 3600 * 1000;
const CDC_OVERLAP_MS = 10 * 60 * 1000;
const PAGE_SIZE = 100;

const money = (value: unknown, currency?: string) => { const scale = currency ? currencyScale(currency) : 2; return Number(unitsDecimal(decimalUnits(value, scale), scale)); };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface QuickBooksSyncResult {
    success: boolean;
    platform: 'quickbooks';
    mode: 'full' | 'cdc';
    entities: number;
    records: number;
    mirrored: number;
    deleted: number;
}

function parseEntityFilter(raw: unknown): QuickBooksEntity[] {
    if (!Array.isArray(raw) || raw.length === 0) return [...QUICKBOOKS_ENTITIES];
    const entities = raw.filter((e): e is QuickBooksEntity => (QUICKBOOKS_ENTITIES as readonly string[]).includes(e));
    if (entities.length === 0) throw new Error('QuickBooks sync filter lists no supported entities.');
    return entities;
}

function invoiceToReceivable(invoice: any, contextId: string, existing?: Record<string, any>, homeCurrency?: string) {
    const currency = invoice.CurrencyRef?.value ?? homeCurrency;
    const total = money(invoice.TotalAmt, currency);
    const balance = money(invoice.Balance, currency);
    return {
        invoice_id: String(invoice.DocNumber ?? invoice.Id),
        // context_id is a local assignment — once set (by the mirror or the user) a sync never re-homes it.
        context_id: existing?.context_id ?? contextId,
        customer_token: invoice.CustomerRef?.name ?? invoice.CustomerRef?.value ?? null,
        issued_date: invoice.TxnDate,
        due_date: invoice.DueDate,
        currency: currency ?? null,
        customer_id: invoice.CustomerRef?.value ?? null,
        balance,
        amount: total,
        amount_paid: money(total - balance, currency),
        status: balance <= 0 ? 'PAID' : balance < total ? 'PARTIAL' : 'SENT',
        ...(existing?.last_reminder_at ? { last_reminder_at: existing.last_reminder_at } : {}),
    };
}

function paymentToTransaction(payment: any, contextId: string, homeCurrency?: string) {
    return {
        fitid: `qbo:payment:${payment.Id}`,
        account_id: payment.DepositToAccountRef?.value ?? 'quickbooks',
        context_id: contextId,
        timestamp: payment.TxnDate,
        payee_raw: payment.CustomerRef?.name ?? 'QuickBooks customer',
        currency: payment.CurrencyRef?.value ?? homeCurrency ?? null,
        customer_id: payment.CustomerRef?.value ?? null,
        allocations: (payment.Line ?? []).flatMap((line: any) => (line.LinkedTxn ?? []).map((txn: any) => ({ entity: txn.TxnType, remote_id: txn.TxnId, amount: line.LinkedTxn.length === 1 ? line.Amount : null }))),
        amount: money(payment.TotalAmt, payment.CurrencyRef?.value ?? homeCurrency),
        current_status: 'CLEARED',
        is_split: false,
    };
}

function purchaseToTransaction(purchase: any, contextId: string, homeCurrency?: string) {
    return {
        fitid: `qbo:purchase:${purchase.Id}`,
        account_id: purchase.AccountRef?.value ?? 'quickbooks',
        context_id: contextId,
        timestamp: purchase.TxnDate,
        payee_raw: purchase.EntityRef?.name ?? purchase.PaymentType ?? 'QuickBooks purchase',
        currency: purchase.CurrencyRef?.value ?? homeCurrency ?? null,
        vendor_id: purchase.EntityRef?.type === "Vendor" ? purchase.EntityRef.value : null,
        amount: -money(purchase.TotalAmt, purchase.CurrencyRef?.value ?? homeCurrency),
        current_status: 'CLEARED',
        is_split: false,
    };
}

function financeRecordFor(connector: SaasConnector, entity: QuickBooksEntity, record: any, contextId: string, existing?: Record<string, any>) {
    if (entity === 'Invoice') return { collection: FinanceCollections.receivables, recordId: quickBooksRecordKey(connector, entity, String(record.Id)), data: invoiceToReceivable(record, contextId, existing, (connector.config as any)?.homeCurrency) };
    if (entity === 'Payment') return { collection: FinanceCollections.transactions, recordId: quickBooksRecordKey(connector, entity, String(record.Id)), data: paymentToTransaction(record, contextId, (connector.config as any)?.homeCurrency) };
    if (entity === 'Purchase') return { collection: FinanceCollections.transactions, recordId: quickBooksRecordKey(connector, entity, String(record.Id)), data: purchaseToTransaction(record, contextId, (connector.config as any)?.homeCurrency) };
    return null;
}

function datasetSummary(connector: SaasConnector, entity: QuickBooksEntity, record: any) {
    return {
        id: quickBooksRecordKey(connector, entity, String(record.Id)),
        realmId: (connector.config as any).realmId, connectorId: connector.id, remoteId: String(record.Id),
        entity,
        title: record.DocNumber ?? record.DisplayName ?? record.Name ?? `${entity} ${record.Id}`,
        content: JSON.stringify(record),
        lastUpdated: record.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
        source: 'quickbooks',
        sourceCreatedAt: record.MetaData?.CreateTime ?? record.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
        sourceUpdatedAt: record.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
        syncToken: record.SyncToken ?? null,
        active: record.Active !== false,
    };
}

async function removeMirror(connector: SaasConnector, orgId: number, entity: QuickBooksEntity, remoteId: string, store: AppRecordsStore | null) {
    const link = await findSyncLink(connector.id, entity, remoteId, orgId);
    if (store && link && link.localRecordId === quickBooksRecordKey(connector, entity, remoteId) && FINANCE_ENTITIES.has(entity) && link.localCollection !== 'dataset') {
        await store.delete(link.localCollection, link.localRecordId);
    }
    if (link) await deleteSyncLink(connector.id, entity, remoteId, orgId);
}

/**
 * Apply one remote record to the dataset links and finance mirror. Shared by
 * bulk sync and single-record webhook refresh so both paths mirror identically.
 * Returns 'deleted' | 'unchanged' | 'applied'.
 */
export async function applyQuickBooksRecord(
    connector: SaasConnector,
    record: any,
    entity: QuickBooksEntity,
    orgId: number,
    store: AppRecordsStore | null,
    contextId: string,
): Promise<'deleted' | 'unchanged' | 'applied'> {
    assertQuickBooksScope(connector, orgId);
    const remoteId = String(record.Id);
    if (record.status === 'Deleted') {
        await removeMirror(connector, orgId, entity, remoteId, store);
        return 'deleted';
    }

    const remoteUpdatedAt = record.MetaData?.LastUpdatedTime ? new Date(record.MetaData.LastUpdatedTime) : null;
    const link = await findSyncLink(connector.id, entity, remoteId, orgId);
    const remoteMoved = !link?.remoteUpdatedAt || (remoteUpdatedAt && remoteUpdatedAt > new Date(link.remoteUpdatedAt));

    let localCollection = 'dataset';
    let localRecordId = quickBooksRecordKey(connector, entity, remoteId);
    let localHash: string | null = null;
    let wrote = false;

    const finance = store ? financeRecordFor(connector, entity, record, contextId) : null;
    if (finance) {
        if ('fitid' in finance.data) finance.data.fitid = finance.recordId;
        if ('account_id' in finance.data) finance.data.account_id = quickBooksRecordKey(connector, 'Account', String(record.DepositToAccountRef?.value ?? record.AccountRef?.value ?? '0'));
        const existing = link ? await store!.get(finance.collection, finance.recordId).then(r => r?.data as Record<string, any> | undefined) : undefined;
        if (entity === 'Invoice') finance.data = invoiceToReceivable(record, contextId, existing, (connector.config as any)?.homeCurrency);
        const nextHash = hash(finance.data);
        localHash = nextHash;
        if (remoteMoved || !link || link.localHash !== nextHash || link.localRecordId !== finance.recordId) {
            await store!.upsert(finance.collection, finance.recordId, finance.data);
            wrote = true;
        }
        localCollection = finance.collection;
        localRecordId = finance.recordId;
    }

    if (!link || !link.remoteData || remoteMoved || wrote || link.localCollection !== localCollection || link.localRecordId !== localRecordId) {
        await upsertSyncLink(connector.id, orgId, {
            localCollection, localRecordId,
            remoteEntity: entity, remoteId,
            remoteSyncToken: record.SyncToken ?? null,
            remoteData: record,
            remoteUpdatedAt, localHash,
        });
        return 'applied';
    }
    return 'unchanged';
}

/**
 * Refresh one remote record — the webhook path. Fetches the full entity (a
 * webhook notification carries only ids), mirrors it, and publishes the event
 * the orchestrator listens for.
 */
export async function refreshQuickBooksRecord(
    connector: SaasConnector,
    entity: QuickBooksEntity,
    remoteId: string,
    context: { organizationId: number; userId?: string },
): Promise<'deleted' | 'unchanged' | 'applied'> {
    assertQuickBooksScope(connector, context.organizationId);
    const client = clientForConnector(connector);
    const store = await AppRecordsStore.forOrg(connector.orgId).catch(() => null);
    const [syncConfig] = await db.select().from(saasSyncConfigs)
        .where(eq(saasSyncConfigs.connectorId, connector.id)).limit(1);
    const contextId = typeof (syncConfig?.filters as any)?.contextId === 'string'
        ? (syncConfig!.filters as any).contextId : DefaultContexts.scheduleE;

    let record: any;
    try {
        record = await client.get(entity, remoteId);
    } catch (err: any) {
        if (/not.found|404/i.test(err?.message ?? '')) {
            await removeMirror(connector, connector.orgId, entity, remoteId, store);
            return 'deleted';
        }
        throw err;
    }
    if (!record) {
        await removeMirror(connector, connector.orgId, entity, remoteId, store);
        return 'deleted';
    }

    const outcome = await applyQuickBooksRecord(connector, record, entity, connector.orgId, store, contextId);
    void eventStream.publish(`quickbooks.${entity.toLowerCase()}_updated`, { entity, remoteId, outcome }, {
        organizationId: context.organizationId, subject: remoteId,
    }, 'quickbooks-sync');
    return outcome;
}

export async function syncQuickBooks(
    connector: SaasConnector,
    config: Record<string, any>,
    context: { organizationId: number; userId: string; isSuperAdmin?: boolean },
    _syncType: string,
): Promise<QuickBooksSyncResult> {
    assertQuickBooksScope(connector, context.organizationId);
    const client = clientForConnector(connector);
    const connConfig = { ...((connector.config ?? {}) as Record<string, any>) };
    connConfig.homeCurrency = (await client.company())?.HomeCurrency?.value ?? connConfig.homeCurrency;
    connector = { ...connector, config: connConfig };
    const entities = parseEntityFilter(config.filters?.entities);
    const contextId = typeof config.filters?.contextId === 'string' ? config.filters.contextId : DefaultContexts.scheduleE;

    const store = await AppRecordsStore.forOrg(context.organizationId).catch(() => null);
    if (!store) logger.info(`Org ${context.organizationId} has no BudgetMaster app — QuickBooks sync is dataset-only.`);

    const lastCdcAt = connConfig.lastCdcAt ? new Date(connConfig.lastCdcAt).getTime() : NaN;
    const snapshotsReady = connConfig.financialSnapshotVersion === 1 && entities.every(entity => (connConfig.financialSnapshotEntities ?? []).includes(entity));
    const useCdc = snapshotsReady && Number.isFinite(lastCdcAt) && Date.now() - lastCdcAt < CDC_MAX_AGE_MS;

    const dataset = await datasetService.ensurePlatformDataset('quickbooks', context as any);
    const byEntity = new Map<QuickBooksEntity, any[]>();

    if (useCdc) {
        const changedSince = new Date(lastCdcAt - CDC_OVERLAP_MS).toISOString();
        const changed = await client.cdc(entities, changedSince);
        for (const entity of entities) byEntity.set(entity, changed[entity] ?? []);
    } else {
        for (const entity of entities) {
            const records: any[] = [];
            let start = 1;
            while (true) {
                const page = await client.list(entity, { start, limit: PAGE_SIZE });
                records.push(...page.items);
                if (page.nextStart == null) break;
                start = page.nextStart;
            }
            byEntity.set(entity, records);
        }
    }

    const datasetItems: { data: any; rawData: any }[] = [];
    const observedFields = new Map<QuickBooksEntity, Set<string>>();
    let records = 0, mirrored = 0, deleted = 0;

    for (const [entity, rows] of byEntity) {
        for (const record of rows) {
            for (const key of Object.keys(record)) observedFields.get(entity)?.add(key) ?? observedFields.set(entity, new Set([key]));

            // Read the link before applying — applyQuickBooksRecord creates it,
            // and "was this remote record ever seen" is what decides whether it
            // gets a (append-only) dataset item and a discovery event.
            const seenBefore = await findSyncLink(connector.id, entity, String(record.Id), context.organizationId);
            const outcome = await applyQuickBooksRecord(connector, record, entity, context.organizationId, store, contextId);
            if (outcome === 'deleted') { deleted++; continue; }
            records++;
            if (FINANCE_ENTITIES.has(entity) && store) mirrored++;
            if (seenBefore) continue;

            datasetItems.push({ data: datasetSummary(connector, entity, record), rawData: record });
            void eventStream.publish(`quickbooks.${entity.toLowerCase()}_discovered`, datasetSummary(connector, entity, record), {
                organizationId: context.organizationId, subject: String(record.Id),
            }, 'quickbooks-sync');
        }
    }

    if (datasetItems.length > 0) await datasetService.addItems(dataset.id, datasetItems, context as any);
    await captureSchemaSnapshot(connector.id, observedFields);

    await db.update(saasConnectors).set({
        lastSync: new Date(),
        config: sql`${saasConnectors.config} || ${JSON.stringify({ financialSnapshotVersion: 1, financialSnapshotEntities: [...new Set([...(connConfig.financialSnapshotEntities ?? []), ...entities])], lastCdcAt: new Date().toISOString(), ...(connConfig.homeCurrency ? { homeCurrency: connConfig.homeCurrency } : {}) })}::jsonb`,
    }).where(and(eq(saasConnectors.id, connector.id), eq(saasConnectors.orgId, context.organizationId), eq(saasConnectors.status, 'connected')));

    return { success: true, platform: 'quickbooks', mode: useCdc ? 'cdc' : 'full', entities: entities.length, records, mirrored, deleted };
}

/** Observed attribute names per entity — the drift-detection role Jira's field snapshot serves. */
async function captureSchemaSnapshot(connectorId: number, observed: Map<QuickBooksEntity, Set<string>>) {
    if (observed.size === 0) return;
    try {
        const fields = [...observed.entries()].map(([entity, keys]) => ({
            id: entity, name: entity, attributes: [...keys].sort(),
        }));
        const [last] = await db.select().from(saasSchemaSnapshots)
            .where(eq(saasSchemaSnapshots.connectorId, connectorId)).orderBy(desc(saasSchemaSnapshots.version)).limit(1);
        if (last && JSON.stringify(last.fields) === JSON.stringify(fields)) return;
        await db.insert(saasSchemaSnapshots).values({
            connectorId, platform: 'quickbooks',
            name: `QuickBooks Schema Snapshot v${(last?.version ?? 0) + 1} - Auto-Synced`,
            fields, version: (last?.version ?? 0) + 1, createdAt: new Date(),
        });
    } catch (err: any) {
        logger.warn(`QuickBooks schema snapshot skipped: ${err.message}`);
    }
}
