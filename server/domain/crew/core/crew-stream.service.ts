/**
 * Crew Stream Service
 *
 * Live room updates. Without this the panel only refetches after its OWN
 * message, so another participant's turn stays invisible until you happen to
 * send something — which makes a shared room feel broken.
 *
 * Redis pub/sub per room, mirroring routes/decision-stream.ts: a dedicated
 * subscriber connection (ioredis requires one for subscribe mode), one channel
 * per session, and a local EventEmitter fallback so a single-process dev server
 * still works when Redis is unavailable.
 */

import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewStreamService");

export type CrewStreamEventType = "turn" | "turn-content" | "round-complete" | "round-cancelled" | "participant" | "typing" | "blackboard-sync" | "scribe-insight" | "scribe-document-updated";

export interface CrewStreamEvent {
    type: CrewStreamEventType;
    organizationId: number;
    sessionKey: string;
    /** Who caused it, so a client can ignore its own echo. */
    actor?: string;
    payload?: Record<string, unknown>;
}

const CHANNEL_PREFIX = "crew:room:";

function channelFor(organizationId: number, sessionKey: string): string {
    return `${CHANNEL_PREFIX}${organizationId}:${sessionKey}`;
}

class CrewStreamService {
    /** Local delivery, and the whole mechanism when Redis is down. */
    private readonly local = new EventEmitter();

    private publisher: Redis | null = null;
    private subscriber: Redis | null = null;
    private redisDisabled = false;
    private readonly subscribedChannels = new Set<string>();

    constructor() {
        // A room can have many listeners; the default limit of 10 would warn.
        this.local.setMaxListeners(200);
    }

    private redisUrl(): string {
        return process.env.REDIS_URL || "redis://127.0.0.1:6379";
    }

    private getPublisher(): Redis | null {
        if (this.redisDisabled) return null;
        if (!this.publisher) {
            try {
                this.publisher = new Redis(this.redisUrl(), {
                    connectionName: "oddjob:crew-stream-pub",
                    maxRetriesPerRequest: 1,
                    lazyConnect: false,
                });
                this.publisher.on("error", (err) => {
                    logger.debug(`Crew stream publisher error: ${err.message}`);
                });
            } catch (err) {
                logger.warn(
                    `Redis unavailable for crew streaming, falling back to in-process delivery: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
                this.redisDisabled = true;
                return null;
            }
        }
        return this.publisher;
    }

    private getSubscriber(): Redis | null {
        if (this.redisDisabled) return null;
        if (!this.subscriber) {
            try {
                this.subscriber = new Redis(this.redisUrl(), {
                    connectionName: "oddjob:crew-stream-sub",
                    maxRetriesPerRequest: 1,
                });
                this.subscriber.on("error", (err) => {
                    logger.debug(`Crew stream subscriber error: ${err.message}`);
                });
                this.subscriber.on("message", (channel, message) => {
                    if (!channel.startsWith(CHANNEL_PREFIX)) return;
                    try {
                        const event = JSON.parse(message) as CrewStreamEvent;
                        this.local.emit(channel, event);
                    } catch {
                        // A malformed message must not kill the subscriber.
                    }
                });
            } catch {
                this.redisDisabled = true;
                return null;
            }
        }
        return this.subscriber;
    }

    /**
     * Announces something happened in a room.
     *
     * Best-effort: a failed publish must never fail the round that produced it.
     * When Redis is unavailable the event is still delivered in-process, which
     * covers the common single-server case.
     */
    async publish(event: CrewStreamEvent): Promise<void> {
        const channel = channelFor(event.organizationId, event.sessionKey);
        const payload = JSON.stringify(event);

        const pub = this.getPublisher();
        if (pub) {
            try {
                await pub.publish(channel, payload);
                // Redis does not echo to this process's own subscriber unless it
                // is subscribed; emit locally too, and let subscribe() dedupe.
                if (!this.subscribedChannels.has(channel)) this.local.emit(channel, event);
                return;
            } catch {
                // fall through to local delivery
            }
        }

        this.local.emit(channel, event);
    }

    /**
     * Listens to a room. Returns an unsubscribe function; callers must invoke it
     * on disconnect or the listener leaks for the life of the process.
     */
    subscribe(organizationId: number, sessionKey: string, listener: (event: CrewStreamEvent) => void): () => void {
        const channel = channelFor(organizationId, sessionKey);

        const sub = this.getSubscriber();
        if (sub && !this.subscribedChannels.has(channel)) {
            this.subscribedChannels.add(channel);
            sub.subscribe(channel).catch(() => {
                this.subscribedChannels.delete(channel);
            });
        }

        this.local.on(channel, listener);
        return () => {
            this.local.off(channel, listener);
            if (this.listenerCount(organizationId, sessionKey) === 0 && sub) {
                this.subscribedChannels.delete(channel);
                sub.unsubscribe(channel).catch(() => {});
            }
        };
    }

    /** Listener count for a room, used to decide when to drop the subscription. */
    listenerCount(organizationId: number, sessionKey: string): number {
        return this.local.listenerCount(channelFor(organizationId, sessionKey));
    }
}

export const crewStreamService = new CrewStreamService();
