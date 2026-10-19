
import { SocketModeClient, LogLevel } from '@slack/socket-mode';
import { db } from '@server/database_service.js';
import { saasConnectors } from '@shared/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '@server/utils/logger.js';
import { conversationalBridgeService } from './conversational-bridge.service.js';
import { cycleDependencyGatewayService } from '../mission/core/cycle-dependency-gateway.service.js';
import { redis } from '@domain/core/infrastructure/redis/redis-client.js';

const logger = createLogger("SlackSocketListener");

// Reconnect configuration
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 60000; // 1 minute
const EVENT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const PROCESSED_EVENT_CACHE_MAX = 1000;
const MAX_CONCURRENT_EVENT_HANDLERS = Number(process.env.SLACK_EVENT_CONCURRENCY || 4);

interface ConnectorInstance {
    client: SocketModeClient;
    appToken: string;
    reconnectAttempts: number;
    lastHealthCheck: number;
    isHealthy: boolean;
}

/**
 * Oddjob Slack Socket Mode Listener
 * ⚡ Enables real-time responsiveness without needing public webhooks.
 */
export class SlackSocketListener {
    private static instances: Map<number, ConnectorInstance> = new Map();
    private static healthCheckInterval: NodeJS.Timeout | null = null;
    private static processedEvents = new Map<string, number>();
    private static activeEventHandlers = 0;
    private static eventQueue: Array<() => Promise<void>> = [];

    /**
     * Start listeners for all active Slack connectors with Socket Mode enabled
     */
    static async startAll() {
        logger.info(">>> [DEBUG-SLACK] startAll() execution began");
        logger.info("[SlackSocket] Scanning for Slack connectors to activate Socket Mode...");

        const connectors = await db.select().from(saasConnectors).where(
            and(
                eq(saasConnectors.platform, 'slack'),
                eq(saasConnectors.status, 'connected')
            )
        );

        logger.info(`[SlackSocket] Found ${connectors.length} connected Slack connectors.`);
        if (connectors.length === 0) {
            // Say WHY nothing will happen. "Found 0" alone reads like a healthy
            // no-op; the usual cause is a connector sitting in auth_failed after
            // its tokens were revoked, which needs a re-authorization.
            const [anySlack] = await db.select({ id: saasConnectors.id, status: saasConnectors.status })
                .from(saasConnectors)
                .where(eq(saasConnectors.platform, 'slack'))
                .limit(1);
            if (anySlack) {
                logger.warn(
                    `[SlackSocket] A Slack connector exists (id ${anySlack.id}) but its status is '${anySlack.status}', ` +
                    `not 'connected' — the bot will NOT receive messages. Re-authorize the Slack app to restore it. ` +
                    `The listener rescans every ${HEALTH_CHECK_INTERVAL_MS / 1000}s, so no restart is needed once it reconnects.`,
                );
            } else {
                logger.warn("[SlackSocket] No Slack connector is configured for any org — the bot will not receive messages.");
            }
        }

        for (const connector of connectors) {
            logger.info(`[SlackSocket] Processing connector ID: ${connector.id}, Org: ${connector.orgId}`);
            const { appToken, botToken } = this.resolveTokens(connector.credentials as any);

            if (appToken && botToken) {
                await this.startForConnector(connector.id, appToken);
            } else {
                logger.warn(`[SlackSocket] Connector ${connector.id} missing tokens for Socket Mode (Needs app_token and bot_token).`);
            }
        }

        // Start health check interval (also rescans for status changes)
        this.startHealthChecks();
    }

    /**
     * Start periodic health checks for all connections, and rescan for connectors
     * whose status changed since boot.
     */
    private static startHealthChecks() {
        if (this.healthCheckInterval) return;

        this.healthCheckInterval = setInterval(async () => {
            for (const [connectorId, instance] of this.instances) {
                try {
                    // Check if connection is still alive
                    const isConnected = instance.client !== null;
                    if (!isConnected && instance.isHealthy) {
                        logger.warn(`[SlackSocket] Connector ${connectorId} appears disconnected, triggering reconnect...`);
                        instance.isHealthy = false;
                        await this.reconnect(connectorId, instance);
                    }
                } catch (err: any) {
                    logger.error(`[SlackSocket] Health check failed for connector ${connectorId}:`, err.message);
                }
            }

            await this.syncConnectors();
        }, HEALTH_CHECK_INTERVAL_MS);
    }

    /**
     * Reconcile running listeners against the connectors table.
     *
     * `startAll()` only ever ran at worker boot, so re-authorizing Slack (the
     * connector flipping auth_failed -> connected) started NO listener: the bot
     * stayed silent until someone restarted the worker, with nothing in the logs
     * to say why. This closes that gap in both directions — a newly connected
     * connector is picked up within a health-check tick, and one that lost auth
     * is torn down instead of holding a socket with dead credentials.
     */
    private static async syncConnectors() {
        try {
            const connectors = await db.select().from(saasConnectors).where(
                eq(saasConnectors.platform, 'slack')
            );

            const connectedIds = new Set<number>();

            for (const connector of connectors) {
                if (connector.status !== 'connected') continue;
                connectedIds.add(connector.id);
                if (this.instances.has(connector.id)) continue;

                const { appToken, botToken } = this.resolveTokens(connector.credentials as any);
                if (!appToken || !botToken) {
                    logger.warn(`[SlackSocket] Connector ${connector.id} became connected but is missing tokens for Socket Mode.`);
                    continue;
                }
                logger.info(`[SlackSocket] Connector ${connector.id} is newly connected — starting Socket Mode listener.`);
                await this.startForConnector(connector.id, appToken);
            }

            // Tear down listeners whose connector is no longer connected.
            for (const connectorId of [...this.instances.keys()]) {
                if (connectedIds.has(connectorId)) continue;
                logger.warn(`[SlackSocket] Connector ${connectorId} is no longer connected — stopping its listener.`);
                await this.stopForConnector(connectorId);
                this.instances.delete(connectorId);
            }
        } catch (err: any) {
            logger.error(`[SlackSocket] Connector rescan failed: ${err.message}`);
        }
    }

    /**
     * Resolve the app/bot tokens for a connector. Env vars win when set to a real
     * value, so a local override doesn't have to be written into the database.
     */
    private static resolveTokens(creds: any): { appToken?: string; botToken?: string } {
        const envAppToken = process.env.SLACK_APP_TOKEN;
        const envBotToken = process.env.SLACK_BOT_TOKEN;
        const c = creds || {};
        return {
            appToken: (envAppToken && !envAppToken.includes('your-app-token')) ? envAppToken : c.app_token,
            botToken: (envBotToken && !envBotToken.includes('your-bot-token')) ? envBotToken : (c.bot_token || c.token),
        };
    }

    /**
     * Attempt to reconnect a disconnected connector
     */
    private static async reconnect(connectorId: number, instance: ConnectorInstance) {
        if (instance.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            logger.error(`[SlackSocket] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached for connector ${connectorId}. Giving up.`);
            this.instances.delete(connectorId);
            return;
        }

        instance.reconnectAttempts++;
        logger.info(`[SlackSocket] Reconnecting connector ${connectorId} (attempt ${instance.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

        try {
            await this.stopForConnector(connectorId);
            await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
            await this.startForConnector(connectorId, instance.appToken);
            logger.info(`[SlackSocket] ✅ Connector ${connectorId} reconnected successfully`);
        } catch (err: any) {
            logger.error(`[SlackSocket] Reconnect failed for connector ${connectorId}:`, err.message);
        }
    }

    /**
     * Stop a specific connector's Socket Mode client
     */
    private static async stopForConnector(connectorId: number) {
        const instance = this.instances.get(connectorId);
        if (instance) {
            try {
                await instance.client.disconnect();
            } catch (err) {
                // Ignore disconnect errors
            }
        }
    }

    static async startForConnector(connectorId: number, appToken: string) {
        if (this.instances.has(connectorId)) {
            logger.info(`[SlackSocket] Listener for connector ${connectorId} already running.`);
            return;
        }

        // Fetch credentials to get bot_user_id for event filtering
        const [connector] = await db.select().from(saasConnectors).where(eq(saasConnectors.id, connectorId)).limit(1);
        if (!connector) {
            logger.error(`[SlackSocket] Cannot start listener: Connector ${connectorId} not found.`);
            return;
        }
        const creds = connector.credentials as any;

        logger.info(`[SlackSocket] Initializing Socket Mode for connector ${connectorId}...`);

        const socketClient = new SocketModeClient({ appToken });

        // Track instance metadata
        const instance: ConnectorInstance = {
            client: socketClient,
            appToken,
            reconnectAttempts: 0,
            lastHealthCheck: Date.now(),
            isHealthy: false
        };

        socketClient.on('raw_message', async ({ body, ack }) => {
            await ack();
            logger.info(`[TRACE-SLACK-RAW] Received raw event type: ${body.type} / ${body.event?.type || 'no-event'}`);
        });

        socketClient.on('slack_event', async ({ event, ack }) => {
            await ack();
            if (event) {
                logger.info(`[TRACE-SLACK-EVENT] Received event type: ${event.type}`);
            }
        });

        socketClient.on('event', async (args: any) => {
            logger.info(`[TRACE-SLACK-GENERIC] Received generic event: ${args.type || 'unknown'}`);
            if (args.ack) await args.ack();
        });

        socketClient.on('app_mention', async ({ event, ack }) => {
            await ack();
            logger.info(`[TRACE-SLACK] app_mention from ${event.user} in channel ${event.channel}: "${event.text}"`);
            
            // Dispatch to Cycle Dependency Gateway for webhook triggers
            try {
                await this.dispatchWebhookOnce(event);
            } catch (err: any) {
                logger.error("[SlackSocket] Failed to dispatch app_mention to CycleDependencyGateway:", err.message);
            }

            this.enqueueEvent(event);
        });

        socketClient.on('interactive', async ({ body, ack }) => {
            await ack();
            logger.info(`[TRACE-SLACK] interactive event: type=${body.type}, user=${body.user?.username}`);
            try {
                await conversationalBridgeService.handleSlackAction(body);
            } catch (err: any) {
                logger.error("[SlackSocket] Failed to process interactive action:", err.message);
            }
        });

        socketClient.on('message', async ({ event, ack }) => {
            await ack();
            logger.info(`[TRACE-SLACK] message event: channel_type=${event.channel_type}, user=${event.user}, text="${event.text?.substring(0, 30)}..."`);

            // Dispatch to Cycle Dependency Gateway for webhook triggers
            try {
                await this.dispatchWebhookOnce(event);
            } catch (err: any) {
                logger.error("[SlackSocket] Failed to dispatch message to CycleDependencyGateway:", err.message);
            }

            // Handle Direct Messages or messages where the bot is mentioned (if not already handled by app_mention)
            const botUserId = creds.bot_user_id || process.env.SLACK_BOT_USER_ID;
            const isMention = event.text?.includes(`<@${botUserId}>`);

            if (!this.shouldIgnoreMessageEvent(event, botUserId) && (event.channel_type === 'im' || isMention)) {
                logger.info(`[TRACE-SLACK] Routing message to handleEvent (isIM=${event.channel_type === 'im'}, isMention=${isMention})`);
                this.enqueueEvent(event);
            } else {
                logger.debug(`[TRACE-SLACK] Skipping message (bot_id=${event.bot_id}, channel_type=${event.channel_type})`);
            }
        });

        socketClient.on('error', (error) => {
            logger.error(`[SlackSocket] Error in connector ${connectorId}:`, error);
            instance.isHealthy = false;
        });

        socketClient.on('disconnect', () => {
            logger.warn(`[SlackSocket] Connector ${connectorId} disconnected`);
            instance.isHealthy = false;
            // Trigger reconnect
            this.reconnect(connectorId, instance);
        });

        try {
            await socketClient.start();
            instance.isHealthy = true;
            instance.reconnectAttempts = 0; // Reset on successful connection
            this.instances.set(connectorId, instance);
            logger.info(`[SlackSocket] ✅ Socket Mode ACTIVE for connector ${connectorId}`);
        } catch (err: any) {
            logger.error(`[SlackSocket] Failed to start Socket Mode for connector ${connectorId}:`, err.message);
            throw err;
        }
    }

    private static shouldIgnoreMessageEvent(event: any, botUserId?: string) {
        if (!event) return true;
        if (event.bot_id || event.bot_profile) return true;
        if (botUserId && event.user === botUserId) return true;
        if (event.subtype && event.subtype !== 'file_share') return true;
        return false;
    }

    private static getEventKey(event: any, scope: "bridge" | "webhook") {
        const team = event.team || event.team_id || "unknown-team";
        const channel = event.channel || "unknown-channel";
        const user = event.user || "unknown-user";
        const eventId = event.client_msg_id || event.event_ts || event.ts;
        if (eventId) return `${scope}:${team}:${channel}:${eventId}`;
        const textHash = String(event.text || "").slice(0, 160);
        return `${scope}:${team}:${channel}:${user}:${event.type || "message"}:${textHash}`;
    }

    private static async markEventSeen(key: string): Promise<boolean> {
        // Cross-process dedup: multiple worker instances each receive Slack events,
        // so an in-memory map alone lets duplicates through (one reply per worker).
        // Use Redis SET NX as the authoritative shared guard; fall back to the local
        // map if Redis is unavailable.
        try {
            const res = await redis.set(`slack:dedup:${key}`, "1", "PX", EVENT_DEDUPE_TTL_MS, "NX");
            if (res === null) return true; // already claimed by this/another worker → duplicate
        } catch {
            // Redis down — degrade to the per-process map below.
        }
        const now = Date.now();
        const seenAt = this.processedEvents.get(key);
        if (seenAt && now - seenAt < EVENT_DEDUPE_TTL_MS) {
            return true;
        }
        this.processedEvents.set(key, now);
        this.pruneProcessedEvents(now);
        return false;
    }

    private static pruneProcessedEvents(now = Date.now()) {
        for (const [key, seenAt] of this.processedEvents) {
            if (now - seenAt > EVENT_DEDUPE_TTL_MS || this.processedEvents.size > PROCESSED_EVENT_CACHE_MAX) {
                this.processedEvents.delete(key);
            }
        }
    }

    private static enqueueEvent(event: any) {
        this.eventQueue.push(() => this.handleEvent(event));
        this.drainEventQueue();
    }

    private static drainEventQueue() {
        while (this.activeEventHandlers < MAX_CONCURRENT_EVENT_HANDLERS && this.eventQueue.length > 0) {
            const task = this.eventQueue.shift();
            if (!task) return;

            this.activeEventHandlers++;
            void task()
                .catch((err: any) => logger.error("[SlackSocket] Queued event handler failed:", err.message))
                .finally(() => {
                    this.activeEventHandlers--;
                    this.drainEventQueue();
                });
        }
    }

    private static async dispatchWebhookOnce(event: any) {
        const eventKey = this.getEventKey(event, "webhook");
        if (await this.markEventSeen(eventKey)) {
            logger.info(`[TRACE-SLACK] Skipping duplicate webhook dispatch: ${eventKey}`);
            return;
        }

        await cycleDependencyGatewayService.triggerWebhook("slack", {
            text: event.text || '',
            channel: event.channel,
            user: event.user,
            team: event.team || (event as any).team_id,
            ts: event.ts,
            thread_ts: event.thread_ts
        });
    }

    private static async handleEvent(event: any) {
        const eventId = this.getEventKey(event, "bridge");
        logger.info(`[TRACE-SLACK] handleEvent: type=${event.type}, eventId=${eventId}, ts=${event.ts}, client_msg_id=${event.client_msg_id}`);
        
        if (await this.markEventSeen(eventId)) {
            logger.info(`[TRACE-SLACK] Skipping duplicate event: ${eventId}`);
            return;
        }

        try {
            await conversationalBridgeService.handleInboundMessage({
                platform: 'slack',
                channelId: event.channel,
                userId: event.user,
                teamId: event.team || (event as any).team_id, // Support both nested team object and top-level team_id
                text: event.text || '',
                files: event.files,
                threadTs: event.thread_ts || event.ts,
                timestamp: event.event_ts || event.ts || Date.now().toString()
            });
        } catch (err: any) {
            logger.error("[SlackSocket] Failed to process event:", err.message);
        }
    }

    static async stopAll() {
        // Clear health check interval
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        for (const [id, instance] of this.instances) {
            try {
                await instance.client.disconnect();
            } catch (err) {
                // Ignore disconnect errors
            }
            this.instances.delete(id);
        }
        logger.info("[SlackSocket] All Socket Mode listeners stopped");
    }

    /**
     * Get health status of all Socket Mode connections
     */
    static getHealthStatus(): Array<{ connectorId: number; isHealthy: boolean; reconnectAttempts: number }> {
        const status: Array<{ connectorId: number; isHealthy: boolean; reconnectAttempts: number }> = [];
        for (const [connectorId, instance] of this.instances) {
            status.push({
                connectorId,
                isHealthy: instance.isHealthy,
                reconnectAttempts: instance.reconnectAttempts
            });
        }
        return status;
    }
}
