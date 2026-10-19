
import { db } from "@server/database_service.js";
import { cycleWebhooks } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { createHmac } from "crypto";
import type { CycleWebhook } from "@shared/schema/index.js";

const logger = createLogger("CycleWebhook");

const MAX_RETRY_ATTEMPTS = 3;

function isPrivateUrl(urlStr: string): boolean {
    try {
        const u = new URL(urlStr);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
        const h = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
        if (h === 'localhost') return true;
        if (h === '::1') return true;
        if (/^127\./.test(h)) return true;
        if (/^10\./.test(h)) return true;
        if (/^169\.254\./.test(h)) return true;
        if (/^192\.168\./.test(h)) return true;
        const m = h.match(/^172\.(\d+)\./);
        if (m && parseInt(m[1]) >= 16 && parseInt(m[1]) <= 31) return true;
        return false;
    } catch {
        return true;
    }
}

export class CycleWebhookService {
    static async register(orgId: number, url: string, secret: string, events: string[]) {
        if (isPrivateUrl(url)) {
            throw new Error("Webhook URL must be a public HTTP/HTTPS endpoint.");
        }
        const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.insert(cycleWebhooks).values({ id, orgId, url, secret, events, active: true });
        logger.info(`[CycleWebhook] Registered webhook ${id} for org ${orgId} → ${url}`);
        return { id, url, events };
    }

    static async remove(orgId: number, webhookId: string) {
        await db.update(cycleWebhooks)
            .set({ active: false })
            .where(and(eq(cycleWebhooks.id, webhookId), eq(cycleWebhooks.orgId, orgId)));
    }

    static async list(orgId: number) {
        const rows = await db.select()
            .from(cycleWebhooks)
            .where(and(eq(cycleWebhooks.orgId, orgId), eq(cycleWebhooks.active, true)));
        return rows.map(({ secret: _s, ...safe }) => safe);
    }

    /**
     * Deliver a cycle event to all matching webhooks for the given org.
     * Uses HMAC-SHA256 in X-Oddjob-Signature. Non-blocking — failures are retried
     * up to 3 times with linear backoff before being logged and dropped.
     */
    static async deliver(orgId: number | null, eventType: string, payload: Record<string, unknown>) {
        if (!orgId) return;

        const rows = await db.select()
            .from(cycleWebhooks)
            .where(and(eq(cycleWebhooks.orgId, orgId), eq(cycleWebhooks.active, true)));

        const targets = rows.filter(w =>
            (w.events as string[]).includes('*') || (w.events as string[]).includes(eventType)
        );

        if (targets.length === 0) return;

        const body = JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), ...payload });

        await Promise.allSettled(targets.map(async (wh) => {
            const sig = createHmac('sha256', wh.secret).update(body).digest('hex');
            await this.fetchWithRetry(wh, body, sig, eventType);
        }));
    }

    private static async fetchWithRetry(
        wh: CycleWebhook,
        body: string,
        sig: string,
        eventType: string
    ): Promise<void> {
        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10_000);
            try {
                const res = await fetch(wh.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Oddjob-Signature': `sha256=${sig}`,
                        'X-Oddjob-Event': eventType,
                    },
                    body,
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (res.ok) {
                    logger.debug(`[CycleWebhook] ${wh.id} delivered ${eventType} (attempt ${attempt})`);
                    return;
                }
                logger.warn(`[CycleWebhook] ${wh.id} → ${res.status} (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
            } catch (err: any) {
                clearTimeout(timeoutId);
                logger.warn(`[CycleWebhook] ${wh.id} delivery error (attempt ${attempt}): ${err.message}`);
            }
            if (attempt < MAX_RETRY_ATTEMPTS) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
        logger.error(`[CycleWebhook] ${wh.id} failed all ${MAX_RETRY_ATTEMPTS} delivery attempts for ${eventType}`);
    }
}
