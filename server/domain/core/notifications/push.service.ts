/**
 * Web push: delivers a notification to every browser a person has subscribed,
 * whether or not an Oddjob tab is open.
 *
 * Needs a VAPID key pair (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; generate one with
 * `npx web-push generate-vapid-keys`). Without it every send is a logged no-op,
 * and server/config/env.ts reports the degradation at boot.
 *
 * A subscription the push service reports gone (404/410) is deleted: the browser
 * unsubscribed or the person cleared site data, and it will never work again.
 */
import webpush from "web-push";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    pushDeliveries,
    pushDevices,
    pushSubscriptions,
    type PushDeviceInput,
    type PushSubscriptionInput,
} from "@shared/schema/push.js";
import { fcmService } from "./fcm.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PushService");

export interface PushPayload {
    title: string;
    body: string;
    /** Same-origin path the notification opens, e.g. /missions/12. */
    url: string;
    /** Notifications with the same tag replace each other on the device. */
    tag?: string;
}

/** Push services cap the encrypted payload near 4 KB; keep the text well under it. */
const MAX_BODY = 240;
/** A subscription that has failed this many times in a row is dropped. */
const MAX_FAILURES = 5;

let configured: boolean | null = null;

function configure(): boolean {
    if (configured !== null) return configured;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
        configured = false;
        return configured;
    }
    try {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:push@oddjob.app", publicKey, privateKey);
        configured = true;
    } catch (err: any) {
        logger.error(`VAPID keys rejected, push disabled: ${err.message}`);
        configured = false;
    }
    return configured;
}

function clip(text: string, max: number): string {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Only a same-origin path may be opened from a notification. */
export function safePushUrl(url: string | undefined): string {
    return url && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

export const pushService = {
    isConfigured(): boolean {
        return configure();
    },

    publicKey(): string | null {
        return configure() ? process.env.VAPID_PUBLIC_KEY! : null;
    },

    /**
     * Store a browser's subscription for this person. The endpoint is unique: if
     * someone else subscribed this browser before, it now belongs to this person.
     */
    async saveSubscription(
        userId: string,
        organizationId: number | null,
        input: PushSubscriptionInput,
        userAgent?: string,
    ): Promise<void> {
        const values = {
            userId,
            organizationId,
            endpoint: input.endpoint,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            userAgent: userAgent?.slice(0, 300) ?? null,
            failureCount: 0,
        };
        await db
            .insert(pushSubscriptions)
            .values(values)
            .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
    },

    /** Remove one of this person's subscriptions. Another person's endpoint is left alone. */
    async removeSubscription(userId: string, endpoint: string): Promise<void> {
        await db
            .delete(pushSubscriptions)
            .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    },

    /** Whether phones can be reached (FCM), independent of browser push. */
    devicesConfigured(): boolean {
        return fcmService.isConfigured();
    },

    /** Whether either channel, browser or phone, is configured on this server. */
    anyConfigured(): boolean {
        return configure() || fcmService.isConfigured();
    },

    /**
     * Whether this person can be pushed to at all: a browser subscription with
     * web push configured, or a registered phone with FCM configured. A sender
     * that gates on browser subscriptions alone never reaches someone who only
     * has the Android app.
     */
    async canReach(userId: string): Promise<boolean> {
        if (configure() && await this.hasSubscription(userId)) return true;
        if (!fcmService.isConfigured()) return false;
        const [device] = await db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.userId, userId)).limit(1);
        return !!device;
    },

    /**
     * Store a phone's FCM token for this person. The token is unique per install:
     * if someone else registered this phone before, it now belongs to this person.
     */
    async saveDevice(userId: string, organizationId: number | null, input: PushDeviceInput): Promise<void> {
        const values = {
            userId,
            organizationId,
            platform: input.platform,
            token: input.token,
            appVersion: input.appVersion ?? null,
            failureCount: 0,
        };
        await db.insert(pushDevices).values(values).onConflictDoUpdate({ target: pushDevices.token, set: values });
    },

    /** Remove one of this person's phones, e.g. on sign-out. Another person's token is left alone. */
    async removeDevice(userId: string, token: string): Promise<void> {
        await db.delete(pushDevices).where(and(eq(pushDevices.userId, userId), eq(pushDevices.token, token)));
    },

    async hasSubscription(userId: string): Promise<boolean> {
        const [row] = await db
            .select({ id: pushSubscriptions.id })
            .from(pushSubscriptions)
            .where(eq(pushSubscriptions.userId, userId))
            .limit(1);
        return !!row;
    },

    /**
     * Send to every browser this person has subscribed.
     * @returns how many browsers accepted it.
     */
    async sendToUser(userId: string, payload: PushPayload): Promise<number> {
        const devices = fcmService.isConfigured() ? await this.sendToDevices(userId, payload) : 0;
        if (!configure()) return devices;

        const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
        if (subs.length === 0) return devices;

        const body = JSON.stringify({
            title: clip(payload.title, 80),
            body: clip(payload.body, MAX_BODY),
            url: safePushUrl(payload.url),
            tag: payload.tag,
        });

        let delivered = devices;
        for (const sub of subs) {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    body,
                    { TTL: 60 * 60 * 24 },
                );
                delivered++;
                await db
                    .update(pushSubscriptions)
                    .set({ lastSuccessAt: new Date(), failureCount: 0 })
                    .where(eq(pushSubscriptions.id, sub.id));
            } catch (err: any) {
                const status = err?.statusCode;
                if (status === 404 || status === 410 || sub.failureCount + 1 >= MAX_FAILURES) {
                    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
                    logger.info(`Dropped push subscription ${sub.id} (${status ?? err?.message})`);
                } else {
                    await db
                        .update(pushSubscriptions)
                        .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
                        .where(eq(pushSubscriptions.id, sub.id));
                    logger.warn(`Push to subscription ${sub.id} failed (${status ?? "no status"}): ${err?.message}`);
                }
            }
        }
        return delivered;
    },

    /**
     * Send once per (source, sourceId, person), however many processes try. The
     * ledger row is the claim: only the caller whose insert wins sends.
     */
    async sendOnce(source: string, sourceId: string | number, userId: string, payload: PushPayload): Promise<boolean> {
        if (!configure() && !fcmService.isConfigured()) return false;
        const claimed = await db
            .insert(pushDeliveries)
            .values({ source, sourceId: String(sourceId), userId })
            .onConflictDoNothing()
            .returning({ userId: pushDeliveries.userId });
        if (claimed.length === 0) return false;
        await this.sendToUser(userId, payload);
        return true;
    },

    /** Send to every phone this person has registered. @returns how many FCM accepted. */
    async sendToDevices(userId: string, payload: PushPayload): Promise<number> {
        const devices = await db.select().from(pushDevices).where(eq(pushDevices.userId, userId));
        let delivered = 0;
        for (const device of devices) {
            const result = await fcmService.send(device.token, {
                title: clip(payload.title, 80),
                body: clip(payload.body, MAX_BODY),
                url: safePushUrl(payload.url),
                tag: payload.tag,
            });
            if (result.ok) {
                delivered++;
                await db.update(pushDevices).set({ lastSuccessAt: new Date(), failureCount: 0 }).where(eq(pushDevices.id, device.id));
            } else if (result.gone || device.failureCount + 1 >= MAX_FAILURES) {
                await db.delete(pushDevices).where(eq(pushDevices.id, device.id));
                logger.info(`Dropped push device ${device.id} (${result.status ?? result.error})`);
            } else {
                await db
                    .update(pushDevices)
                    .set({ failureCount: sql`${pushDevices.failureCount} + 1` })
                    .where(eq(pushDevices.id, device.id));
                logger.warn(`Push to device ${device.id} failed: ${result.error}`);
            }
        }
        return delivered;
    },

    /** Test-only: forget the cached configuration so env changes take effect. */
    resetForTests(): void {
        configured = null;
    },
};
