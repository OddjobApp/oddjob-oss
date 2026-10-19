import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";
import "dotenv/config";
import { EventEmitter } from "events";
import { db } from "@server/database_service.js";
import { eventLog, eventWebhookSubscriptions, webhookDeliveryLog } from "@shared/schema/index.js";
import { eq, and, or, like, sql, desc, ilike } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EventStream");

export interface EventPayload {
    eventId: string;
    eventType: string;
    timestamp: number;
    source: string;
    payload: Record<string, any>;
    context?: Record<string, any>;
}

export interface EventFilter {
    types?: string[];
    sources?: string[];
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
    organizationId?: number;
    search?: string;
}

class EventStreamService extends EventEmitter {
    private publisher: Redis | null = null;
    private subscriber: Redis | null = null;
    private intentSubscriber: Redis | null = null;
    private isConnected: boolean = false;
    private readonly CHANNEL_NAME = "oddjob:events";
    private readonly INTENT_CHANNEL_NAME = "intent_events";

    private recentEvents: EventPayload[] = [];
    private readonly MAX_RECENT_EVENTS = 100;

    constructor() {
        super();
    }

    async initialize(): Promise<void> {
        if (this.isConnected) return;

        try {
            const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
            const options: RedisOptions = {
                maxRetriesPerRequest: null,
                retryStrategy: (times) => Math.min(times * 50, 2000),
            };

            if (process.env.REDIS_PASSWORD) {
                options.password = process.env.REDIS_PASSWORD;
            }

            this.publisher = new Redis(redisUrl, options);
            this.subscriber = new Redis(redisUrl, options);
            this.intentSubscriber = new Redis(redisUrl, options);

            this.subscriber.on("message", (channel: string, message: string) => {
                if (channel === this.CHANNEL_NAME) {
                    try {
                        const event: EventPayload = JSON.parse(message);
                        this.emit(event.eventType, event);
                        this.emit("*", event);
                        this.addToRecentEvents(event);
                        this.triggerWebhooks(event).catch(err =>
                            logger.error("[EventStream] Webhook trigger error:", err)
                        );
                    } catch (error) {
                        logger.error("[EventStream] Failed to parse message:", error);
                    }
                }
            });

            this.intentSubscriber.on("message", (channel: string, message: string) => {
                if (channel === this.INTENT_CHANNEL_NAME) {
                    try {
                        const intentData = JSON.parse(message);
                        logger.info(`[EventStream] Received intent event: ${intentData.type} for user ${intentData.user_id?.slice(-8)}`);

                        const event: EventPayload = {
                            eventId: crypto.randomUUID(),
                            eventType: intentData.type || "INTENT_STABILIZED",
                            timestamp: Date.now(),
                            source: "psychologist",
                            payload: intentData,
                        };

                        this.emit(event.eventType, event);
                        this.emit("*", event);
                        this.addToRecentEvents(event);
                        logger.info(`[EventStream] Forwarded intent event to SSE: ${event.eventType}`);
                    } catch (error) {
                        logger.error("[EventStream] Failed to parse intent message:", error);
                    }
                }
            });

            await this.subscriber.subscribe(this.CHANNEL_NAME);
            await this.intentSubscriber.subscribe(this.INTENT_CHANNEL_NAME);

            this.isConnected = true;
            logger.info("[EventStream] Connected to Redis Pub/Sub");
            logger.info(`[EventStream] Subscribed to channels: ${this.CHANNEL_NAME}, ${this.INTENT_CHANNEL_NAME}`);

            // Hydrate recent events buffer from Redis ring buffer across restarts
            try {
                const cached = await this.publisher.lrange("oddjob:events:recent", 0, this.MAX_RECENT_EVENTS - 1);
                if (cached && cached.length > 0) {
                    this.recentEvents = cached.map(item => JSON.parse(item));
                    logger.info(`[EventStream] Hydrated ${this.recentEvents.length} recent events from Redis`);
                }
            } catch (err: any) {
                logger.warn("[EventStream] Redis recent events hydration skipped:", err.message);
            }
        } catch (error) {
            logger.error("[EventStream] Failed to connect to Redis:", error);
        }
    }

    async publish(
        eventType: string,
        payload: Record<string, any>,
        context?: Record<string, any>,
        source: string = "system"
    ): Promise<string> {
        const eventId = crypto.randomUUID();
        const event: EventPayload = {
            eventId,
            eventType,
            timestamp: Date.now(),
            source,
            payload,
            context
        };

        try {
            await db.insert(eventLog).values({
                eventId,
                type: eventType,
                source,
                subject: context?.subject || null,
                payload,
                organizationId: context?.organizationId || null,
            });
        } catch (err) {
            logger.error("[EventStream] Failed to persist event:", err);
        }

        if (this.isConnected && this.publisher) {
            await this.publisher.publish(this.CHANNEL_NAME, JSON.stringify(event));
        } else {
            logger.warn("[EventStream] Redis not ready, emitting locally");
            this.emit(eventType, event);
            this.emit("*", event);
            this.addToRecentEvents(event);
            this.triggerWebhooks(event).catch(err =>
                logger.error("[EventStream] Webhook trigger error:", err)
            );
        }

        return eventId;
    }

    async queryEvents(filter: EventFilter): Promise<EventPayload[]> {
        const conditions = [];

        if (filter.organizationId) {
            conditions.push(or(
                eq(eventLog.organizationId, filter.organizationId),
                sql`${eventLog.organizationId} IS NULL`
            ));
        }

        if (filter.types && filter.types.length > 0) {
            const typeConditions = filter.types.map(pattern => {
                if (pattern.includes('*')) {
                    const likePattern = pattern.replace(/\*/g, '%');
                    return like(eventLog.type, likePattern);
                }
                return eq(eventLog.type, pattern);
            });
            conditions.push(or(...typeConditions));
        }

        if (filter.sources && filter.sources.length > 0) {
            conditions.push(or(...filter.sources.map(s => eq(eventLog.source, s))));
        }

        if (filter.since) {
            conditions.push(sql`${eventLog.emittedAt} >= ${filter.since}`);
        }
        if (filter.until) {
            conditions.push(sql`${eventLog.emittedAt} <= ${filter.until}`);
        }

        if (filter.search) {
            const term = `%${filter.search}%`;
            conditions.push(or(
                ilike(eventLog.type, term),
                ilike(eventLog.source, term),
                ilike(eventLog.subject, term),
                sql`payload::text ILIKE ${term}`
            ));
        }

        const results = await db.select()
            .from(eventLog)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(eventLog.emittedAt))
            .limit(filter.limit || 100)
            .offset(filter.offset || 0);

        return results.map(row => ({
            eventId: row.eventId,
            eventType: row.type,
            timestamp: row.emittedAt.getTime(),
            source: row.source,
            payload: row.payload as Record<string, any>,
            context: row.subject ? { subject: row.subject } : undefined,
        }));
    }

    async replayEvents(filter: EventFilter, emitLocal: boolean = true): Promise<number> {
        const events = await this.queryEvents(filter);
        logger.info(`[EventStream] Replaying ${events.length} events...`);
        for (const event of events) {
            if (emitLocal) {
                this.emit(event.eventType, event);
                this.emit("*", event);
            }
            if (!emitLocal) {
                await this.triggerWebhooks(event);
            }
        }
        return events.length;
    }

    async getEventTypes(organizationId?: number): Promise<string[]> {
        const conditions = [];
        if (organizationId) {
            conditions.push(or(
                eq(eventLog.organizationId, organizationId),
                sql`${eventLog.organizationId} IS NULL`
            ));
        }
        const results = await db.selectDistinct({ type: eventLog.type })
            .from(eventLog)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(eventLog.type);
        return results.map(r => r.type);
    }

    async getEventSources(organizationId?: number): Promise<string[]> {
        const conditions = [];
        if (organizationId) {
            conditions.push(or(
                eq(eventLog.organizationId, organizationId),
                sql`${eventLog.organizationId} IS NULL`
            ));
        }
        const results = await db.selectDistinct({ source: eventLog.source })
            .from(eventLog)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(eventLog.source);
        return results.map(r => r.source);
    }

    private matchesPattern(eventType: string, pattern: string): boolean {
        if (!pattern || !eventType) return false;
        if (pattern === '*') return true;
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '___DOUBLE_STAR___')
            .replace(/\*/g, '[^.]*')
            .replace(/___DOUBLE_STAR___/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(eventType);
    }

    async triggerWebhooks(event: EventPayload): Promise<void> {
        try {
            const subscriptions = await db.select()
                .from(eventWebhookSubscriptions)
                .where(eq(eventWebhookSubscriptions.isActive, true));
            const matchingSubscriptions = subscriptions.filter(sub =>
                this.matchesPattern(event.eventType, sub.eventTypePattern)
            );
            if (matchingSubscriptions.length === 0) return;
            logger.debug(`[EventStream] Triggering ${matchingSubscriptions.length} webhooks for event ${event.eventType}`);
            await Promise.allSettled(
                matchingSubscriptions.map(sub => this.executeWebhook(sub, event))
            );
        } catch (error) {
            logger.error("[EventStream] Failed to trigger webhooks:", error);
        }
    }

    private async executeWebhook(
        subscription: typeof eventWebhookSubscriptions.$inferSelect,
        event: EventPayload,
        attemptNumber: number = 1
    ): Promise<void> {
        const startTime = Date.now();
        const [delivery] = await db.insert(webhookDeliveryLog).values({
            subscriptionId: subscription.id,
            eventId: event.eventId,
            eventType: event.eventType,
            attemptNumber,
            status: "pending",
        }).returning();

        try {
            let body: string;
            if (subscription.payloadTemplate) {
                body = subscription.payloadTemplate
                    .replace(/\{\{eventId\}\}/g, event.eventId)
                    .replace(/\{\{eventType\}\}/g, event.eventType)
                    .replace(/\{\{timestamp\}\}/g, String(event.timestamp))
                    .replace(/\{\{source\}\}/g, event.source)
                    .replace(/\{\{payload\}\}/g, JSON.stringify(event.payload));
            } else {
                body = JSON.stringify({
                    eventId: event.eventId,
                    eventType: event.eventType,
                    timestamp: event.timestamp,
                    source: event.source,
                    payload: event.payload,
                    context: event.context,
                });
            }

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'X-Oddjob-Event-Id': event.eventId,
                'X-Oddjob-Event-Type': event.eventType,
                'X-Oddjob-Delivery-Id': String(delivery.id),
                ...(subscription.headers as Record<string, string> || {}),
            };

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), subscription.timeoutMs);

            const response = await fetch(subscription.webhookUrl, {
                method: subscription.httpMethod,
                headers,
                body,
                signal: controller.signal,
            });

            clearTimeout(timeout);

            const durationMs = Date.now() - startTime;
            const responseBody = await response.text().catch(() => null);

            await db.update(webhookDeliveryLog).set({
                status: response.ok ? "success" : "failed",
                httpStatus: response.status,
                responseBody: responseBody?.slice(0, 1000),
                requestDurationMs: durationMs,
                completedAt: new Date(),
            }).where(eq(webhookDeliveryLog.id, delivery.id));

            if (response.ok) {
                await db.update(eventWebhookSubscriptions).set({
                    lastTriggeredAt: new Date(),
                    lastSuccess: true,
                    lastError: null,
                    successCount: sql`${eventWebhookSubscriptions.successCount} + 1`,
                }).where(eq(eventWebhookSubscriptions.id, subscription.id));
                logger.debug(`[EventStream] Webhook ${subscription.name} delivered successfully in ${durationMs}ms`);
            } else {
                throw new Error(`HTTP ${response.status}: ${responseBody?.slice(0, 200)}`);
            }
        } catch (error: any) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error.message || String(error);
            await db.update(webhookDeliveryLog).set({
                status: attemptNumber < subscription.retryCount ? "retrying" : "failed",
                error: errorMessage,
                requestDurationMs: durationMs,
                completedAt: new Date(),
            }).where(eq(webhookDeliveryLog.id, delivery.id));

            if (attemptNumber < subscription.retryCount) {
                logger.warn(`[EventStream] Webhook ${subscription.name} failed (attempt ${attemptNumber}/${subscription.retryCount}), retrying in ${subscription.retryDelayMs}ms...`);
                setTimeout(() => {
                    this.executeWebhook(subscription, event, attemptNumber + 1);
                }, subscription.retryDelayMs);
            } else {
                await db.update(eventWebhookSubscriptions).set({
                    lastTriggeredAt: new Date(),
                    lastSuccess: false,
                    lastError: errorMessage,
                    failureCount: sql`${eventWebhookSubscriptions.failureCount} + 1`,
                }).where(eq(eventWebhookSubscriptions.id, subscription.id));
                logger.error(`[EventStream] Webhook ${subscription.name} failed permanently: ${errorMessage}`);
            }
        }
    }

    async createSubscription(data: {
        name: string;
        eventTypePattern: string;
        webhookUrl: string;
        httpMethod?: string;
        headers?: Record<string, string>;
        payloadTemplate?: string;
        retryCount?: number;
        retryDelayMs?: number;
        timeoutMs?: number;
        organizationId?: number;
        createdBy?: string;
    }): Promise<typeof eventWebhookSubscriptions.$inferSelect> {
        const [subscription] = await db.insert(eventWebhookSubscriptions).values({
            name: data.name,
            eventTypePattern: data.eventTypePattern,
            webhookUrl: data.webhookUrl,
            httpMethod: data.httpMethod || "POST",
            headers: data.headers || {},
            payloadTemplate: data.payloadTemplate,
            retryCount: data.retryCount ?? 3,
            retryDelayMs: data.retryDelayMs ?? 5000,
            timeoutMs: data.timeoutMs ?? 30000,
            organizationId: data.organizationId,
            createdBy: data.createdBy,
        }).returning();
        return subscription;
    }

    async listSubscriptions(organizationId?: number): Promise<typeof eventWebhookSubscriptions.$inferSelect[]> {
        const conditions = [];
        if (organizationId) {
            conditions.push(or(
                eq(eventWebhookSubscriptions.organizationId, organizationId),
                sql`${eventWebhookSubscriptions.organizationId} IS NULL`
            ));
        }
        return await db.select()
            .from(eventWebhookSubscriptions)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(eventWebhookSubscriptions.name);
    }

    async getDeliveryHistory(subscriptionId: number, limit: number = 50): Promise<typeof webhookDeliveryLog.$inferSelect[]> {
        return await db.select()
            .from(webhookDeliveryLog)
            .where(eq(webhookDeliveryLog.subscriptionId, subscriptionId))
            .orderBy(sql`${webhookDeliveryLog.sentAt} DESC`)
            .limit(limit);
    }

    async close(): Promise<void> {
        if (this.publisher) await this.publisher.quit();
        if (this.subscriber) await this.subscriber.quit();
        if (this.intentSubscriber) await this.intentSubscriber.quit();
        this.isConnected = false;
    }

    /**
     * Subscribe to events matching a filter. Returns an unsubscribe function.
     */
    onEvent(
        handler: (event: EventPayload) => void,
        filter?: { type?: string | string[]; source?: string }
    ): () => void {
        const listener = (event: EventPayload) => {
            if (filter?.type) {
                const types = Array.isArray(filter.type) ? filter.type : [filter.type];
                const matches = types.some(t => {
                    if (t.includes('*')) {
                        const regex = new RegExp('^' + t.replace(/\*/g, '.*') + '$');
                        return regex.test(event.eventType);
                    }
                    return event.eventType === t;
                });
                if (!matches) return;
            }
            if (filter?.source && event.source !== filter.source) {
                return;
            }
            handler(event);
        };

        this.on('*', listener);
        return () => this.off('*', listener);
    }

    /**
     * Get recent events from the in-memory buffer.
     */
    getRecent(limit: number = 50, type?: string, source?: string): EventPayload[] {
        return this.getRecentEvents(type, source, limit);
    }

    private addToRecentEvents(event: EventPayload) {
        this.recentEvents.unshift(event);
        if (this.recentEvents.length > this.MAX_RECENT_EVENTS) {
            this.recentEvents.pop();
        }
        if (this.publisher) {
            this.publisher.pipeline()
                .lpush("oddjob:events:recent", JSON.stringify(event))
                .ltrim("oddjob:events:recent", 0, this.MAX_RECENT_EVENTS - 1)
                .exec()
                .catch(() => {});
        }
    }

    getRecentEvents(type?: string, source?: string, limit: number = 50): EventPayload[] {
        let filtered = this.recentEvents;
        if (type && type !== "all") {
            const pattern = String(type);
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                filtered = filtered.filter(e => regex.test(e.eventType));
            } else {
                filtered = filtered.filter(e => e.eventType === pattern);
            }
        }
        if (source && source !== "all") {
            filtered = filtered.filter(e => e.source === source);
        }
        return filtered.slice(0, limit);
    }

    async getEventStats(days: number = 7, organizationId?: number) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const conditions = [sql`${eventLog.emittedAt} >= ${startDate}`];
        if (organizationId) {
            conditions.push(or(
                eq(eventLog.organizationId, organizationId),
                sql`${eventLog.organizationId} IS NULL`
            )!);
        }
        const typeStats = await db.select({
            type: eventLog.type,
            count: sql<number>`count(*)`,
        })
            .from(eventLog)
            .where(and(...conditions))
            .groupBy(eventLog.type)
            .orderBy(sql`count(*) DESC`)
            .limit(10);

        const sourceStats = await db.select({
            source: eventLog.source,
            count: sql<number>`count(*)`,
        })
            .from(eventLog)
            .where(and(...conditions))
            .groupBy(eventLog.source)
            .orderBy(sql`count(*) DESC`);

        const dailyStats = await db.select({
            date: sql<string>`DATE(${eventLog.emittedAt})`,
            count: sql<number>`count(*)`,
        })
            .from(eventLog)
            .where(and(...conditions))
            .groupBy(sql`DATE(${eventLog.emittedAt})`)
            .orderBy(sql`DATE(${eventLog.emittedAt})`);

        const [totalCount] = await db.select({
            count: sql<number>`count(*)`,
        })
            .from(eventLog)
            .where(and(...conditions));

        return {
            period: { days, startDate: startDate.toISOString() },
            total: Number(totalCount?.count || 0),
            byType: typeStats.map(s => ({ type: s.type, count: Number(s.count) })),
            bySource: sourceStats.map(s => ({ source: s.source, count: Number(s.count) })),
            daily: dailyStats.map(d => ({ date: d.date, count: Number(d.count) })),
        };
    }
}

export const eventStream = new EventStreamService();




