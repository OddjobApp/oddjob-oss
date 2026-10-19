import { createLogger } from "@server/utils/logger.js";
import { WebClient } from "@slack/web-api";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent } from "@domain/core/infrastructure/tracing/trace-logger.service.js";

const logger = createLogger("MessagingService");

export type MessageSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface MessagePayload {
    title: string;
    body: string;
    severity?: MessageSeverity;
    fields?: { label: string; value: string; short?: boolean }[];
    actions?: { label: string; url?: string; actionId?: string; style?: 'primary' | 'danger' }[];
    metadata?: Record<string, any>;
    threadId?: string;
    traceContext?: TraceContext;
}

export interface MessagingProvider {
    name: string;
    send(payload: MessagePayload, organizationId?: number): Promise<{ success: boolean; messageId?: string; threadId?: string; error?: any }>;
}

/**
 * Unified Messaging Service
 * Orchestrates notifications to Slack, MS Teams, and other channels.
 */
export class MessagingService {
    private providers: MessagingProvider[] = [];

    registerProvider(provider: MessagingProvider) {
        this.providers.push(provider);
    }

    async notify(payload: MessagePayload, organizationId?: number, forceProviders?: string[]): Promise<any[]> {
        const targets = forceProviders
            ? this.providers.filter(p => forceProviders.includes(p.name))
            : this.providers;

        const results = await Promise.all(targets.map(async (provider) => {
            try {
                const result = await provider.send(payload, organizationId);
                
                // Forensic logging for outbound notifications
                if (payload.traceContext) {
                    logForensicEvent(payload.traceContext, {
                        organizationId,
                        jobType: `notify:${provider.name}`,
                        status: result.success ? 'success' : 'failure',
                        errorMessage: result.error ? String(result.error) : undefined,
                        attributes: {
                            title: payload.title,
                            provider: provider.name
                        }
                    });
                }
                
                return result;
            } catch (error) {
                logger.error(`Provider ${provider.name} failed:`, error);
                
                if (payload.traceContext) {
                    logForensicEvent(payload.traceContext, {
                        organizationId,
                        jobType: `notify:${provider.name}`,
                        status: 'failure',
                        errorMessage: String(error),
                        attributes: { provider: provider.name }
                    });
                }
                
                return { success: false, name: provider.name, error };
            }
        }));

        return results;
    }
}

export const messagingService = new MessagingService();

// Placeholder for Slack implementation
export class SlackProvider implements MessagingProvider {
    name = "slack";
    private client: WebClient | null = null;
    private defaultChannelId: string | undefined;

    constructor() {
        const token = process.env.SLACK_BOT_TOKEN;
        this.defaultChannelId = process.env.SLACK_DEFAULT_CHANNEL;
        if (token) {
            this.client = new WebClient(token);
        }
    }

    async send(payload: MessagePayload, organizationId?: number) {
        let client = this.client;
        let channelId = this.defaultChannelId;

        // Try to get org-specific credentials if organizationId is provided
        if (organizationId) {
            try {
                const [connector] = await db
                    .select()
                    .from(saasConnectors)
                    .where(
                        and(
                            eq(saasConnectors.orgId, organizationId),
                            eq(saasConnectors.platform, 'slack')
                        )
                    )
                    .limit(1);

                if (connector && connector.status === 'connected') {
                    const creds = connector.credentials as any;
                    const token = creds?.token || creds?.api_token || creds?.bot_token;
                    const orgChannelId = connector.config?.channelId || connector.config?.default_channel;

                    if (token) {
                        client = new WebClient(token);
                        if (orgChannelId) channelId = orgChannelId;
                    }
                }
            } catch (err: any) {
                logger.warn(`Failed to fetch Slack connector for org ${organizationId}, falling back to default`, { error: err });
            }
        }

        if (!client || !channelId) {
            return { success: false, error: "Slack not configured (missing token or channel)" };
        }

        try {
            const color = {
                info: '#36a64f',
                warning: '#ff9800',
                error: '#f44336',
                critical: '#9c27b0',
            }[payload.severity || 'info'];

            const blocks: any[] = [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        text: payload.title,
                        emoji: true
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: payload.body
                    }
                }
            ];

            if (payload.fields && payload.fields.length > 0) {
                blocks.push({
                    type: "section",
                    fields: payload.fields.slice(0, 10).map(f => ({
                        type: "mrkdwn",
                        text: `*${f.label}:*\n${f.value}`
                    }))
                });
            }

            if (payload.actions && payload.actions.length > 0) {
                blocks.push({
                    type: "actions",
                    elements: payload.actions.map(a => ({
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: a.label,
                            emoji: true
                        },
                        url: a.url,
                        action_id: a.actionId,
                        style: a.style === 'primary' ? 'primary' : a.style === 'danger' ? 'danger' : undefined
                    }))
                });
            }

            const res = await (client as any).chat.postMessage({
                channel: channelId,
                text: `${payload.title}: ${payload.body}`, // Fallback for push notifications
                blocks,
                thread_ts: payload.threadId,
                metadata: {
                    event_type: 'oddjob_notification',
                    event_payload: {
                        ...(payload.metadata || {}),
                        traceId: payload.traceContext?.traceId,
                        spanId: payload.traceContext?.spanId
                    }
                }
            });
            return {
                success: true,
                messageId: res.ts,
                threadId: res.ts // By default thread to original message if not specified
            };
        } catch (error: any) {
            logger.error("Slack postMessage error:", error);
            return { success: false, error: error.message };
        }
    }
}

// Placeholder for MS Teams implementation
export class TeamsProvider implements MessagingProvider {
    name = "teams";
    private webhookUrl: string | undefined;

    constructor() {
        this.webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    }

    async send(payload: MessagePayload, organizationId?: number) {
        let webhookUrl = this.webhookUrl;

        if (organizationId) {
            try {
                const [connector] = await db
                    .select()
                    .from(saasConnectors)
                    .where(
                        and(
                            eq(saasConnectors.orgId, organizationId),
                            eq(saasConnectors.platform, 'teams')
                        )
                    )
                    .limit(1);

                if (connector && connector.status === 'connected') {
                    const creds = connector.credentials as any;
                    const url = creds?.webhookUrl || creds?.url;
                    if (url) webhookUrl = url;
                }
            } catch (err: any) {
                logger.warn(`Failed to fetch Teams connector for org ${organizationId}, falling back to default`, { error: err });
            }
        }

        if (!webhookUrl) {
            return { success: false, error: "MS Teams not configured (missing TEAMS_WEBHOOK_URL)" };
        }

        try {
            // Teams uses Adaptive Cards
            const card = {
                type: "message",
                attachments: [
                    {
                        contentType: "application/vnd.microsoft.card.adaptive",
                        content: {
                            type: "AdaptiveCard",
                            version: "1.4",
                            body: [
                                {
                                    type: "TextBlock",
                                    size: "Medium",
                                    weight: "Bolder",
                                    text: payload.title
                                },
                                {
                                    type: "TextBlock",
                                    text: payload.body,
                                    wrap: true
                                },
                                ...(payload.fields || []).map(f => ({
                                    type: "FactSet",
                                    facts: [{ title: f.label, value: f.value }]
                                }))
                            ],
                            actions: (payload.actions || []).map(a => ({
                                type: "Action.OpenUrl",
                                title: a.label,
                                url: a.url
                            }))
                        }
                    }
                ]
            };

            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(card),
            });

            if (!res.ok) {
                throw new Error(`Teams webhook returned ${res.status}`);
            }

            return { success: true };
        } catch (error: any) {
            logger.error("Teams webhook error:", error);
            return { success: false, error: error.message };
        }
    }
}

// Auto-register default providers
messagingService.registerProvider(new SlackProvider());
messagingService.registerProvider(new TeamsProvider());


