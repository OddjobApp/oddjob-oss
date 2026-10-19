/**
 * QuickBooks webhook intake — signature verification, payload normalization
 * and per-entity refresh dispatch.
 *
 * Intuit signs deliveries with `intuit-signature` = base64(HMAC-SHA256(raw
 * body, verifier token)). Two payload shapes exist: the legacy
 * `eventNotifications[].dataChangeEvent.entities[]` envelope and the
 * CloudEvents format Intuit migrated webhooks to (`type:
 * "qbo.invoice.created.v1"`, `intuitaccountid` = realmId, `intuitentityid`).
 * Both are parsed here.
 *
 * Notifications carry only entity ids — the follow-up fetch happens in
 * `refreshQuickBooksRecord` (sync.ts), which also mirrors the record and
 * publishes `quickbooks.<entity>_<operation>` to the event stream.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@server/utils/logger.js';
import { eventStream } from '../../core/infrastructure/event-stream.service.js';
import { QUICKBOOKS_ENTITIES, type QuickBooksEntity } from './client.js';
import { findConnectorsByRealmId } from './service.js';
import { refreshQuickBooksRecord } from './sync.js';
import type { SaasConnector } from '@shared/schema/index.js';

const logger = createLogger('QuickBooksWebhooks');

export function verifyQuickBooksSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    // No permissive default — an unconfigured verifier must fail closed.
    const verifier = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN;
    if (!verifier || !rawBody || !signature) return false;
    const expected = createHmac('sha256', verifier).update(rawBody).digest('base64');
    try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

export interface QuickBooksNotification {
    realmId: string;
    entity: QuickBooksEntity;
    id: string;
    operation: string;
}

const toEntity = (name: string): QuickBooksEntity | null =>
    QUICKBOOKS_ENTITIES.find(e => e.toLowerCase() === name.toLowerCase()) ?? null;

/** Normalize both Intuit webhook payload shapes into flat notifications. */
export function parseQuickBooksNotifications(body: any): QuickBooksNotification[] {
    const out: QuickBooksNotification[] = [];

    // CloudEvents: a top-level array of events.
    if (Array.isArray(body)) {
        for (const event of body) {
            const match = /^qbo\.([a-z]+)\.([a-z]+)\.v\d+$/i.exec(String(event?.type ?? ''));
            const entity = match && toEntity(match[1]);
            const id = String(event?.intuitentityid ?? event?.data?.id ?? '');
            const realmId = String(event?.intuitaccountid ?? '');
            if (entity && /^\d{1,30}$/.test(id) && /^\d{1,30}$/.test(realmId)) {
                out.push({ realmId, entity, id, operation: match![2].toLowerCase() });
            }
        }
        return out;
    }

    // Legacy envelope: { eventNotifications: [{ realmId, dataChangeEvent: { entities } }] }
    for (const notification of body?.eventNotifications ?? []) {
        const realmId = String(notification?.realmId ?? '');
        if (!/^\d{1,30}$/.test(realmId)) continue;
        for (const e of notification?.dataChangeEvent?.entities ?? []) {
            const entity = toEntity(String(e?.name ?? ''));
            const id = String(e?.id ?? '');
            if (entity && /^\d{1,30}$/.test(id)) {
                out.push({ realmId, entity, id, operation: String(e?.operation ?? 'updated').toLowerCase() });
            }
        }
    }
    return out;
}

/**
 * Process one verified delivery: resolve each realmId to its connector,
 * refresh each changed entity once (Intuit batches repeats), and publish the
 * matching `quickbooks.<entity>_<operation>` event for workflow triggers.
 * Unknown realms are skipped — Intuit retries on non-200s, and an
 * unregistered realm is not an error.
 */
export async function handleQuickBooksWebhook(notifications: QuickBooksNotification[]): Promise<{ processed: number; skipped: number }> {
    const byRealm = new Map<string, Map<string, QuickBooksNotification>>();
    for (const n of notifications) {
        const key = `${n.entity}:${n.id}`;
        const realm = byRealm.get(n.realmId) ?? new Map();
        realm.set(key, n);
        byRealm.set(n.realmId, realm);
    }

    let processed = 0, skipped = 0;
    for (const [realmId, changes] of byRealm) {
        const connectors = await findConnectorsByRealmId(realmId);
        if (!connectors.length) {
            logger.warn(`QuickBooks webhook for unknown realm ${realmId} — dropped (${changes.size} entities)`);
            skipped += changes.size;
            continue;
        }
        for (const connector of connectors) {
            if (connector.status !== 'connected') {
                logger.warn(`QuickBooks webhook for disconnected realm ${realmId} — dropped (${changes.size} entities)`);
                skipped += changes.size;
                continue;
            }

            for (const change of changes.values()) {
                try {
                    const outcome = await refreshQuickBooksRecord(connector, change.entity, change.id, {
                        organizationId: connector.orgId, userId: 'system',
                    });
                    void eventStream.publish(`quickbooks.${change.entity.toLowerCase()}_${change.operation}`, {
                        realmId, entity: change.entity, remoteId: change.id, operation: change.operation, outcome,
                    }, { organizationId: connector.orgId, subject: change.id }, 'quickbooks-webhook');
                    processed++;
                } catch (err: any) {
                    logger.error(`QuickBooks webhook refresh failed for ${change.entity} ${change.id} (realm ${realmId}): ${err.message}`);
                }
            }
        }
    }
    return { processed, skipped };
}
