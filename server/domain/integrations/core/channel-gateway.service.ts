/**
 * Channel Gateway Service
 *
 * The unified multi-channel routing hub (Phase 5).
 * Receives normalized ChannelMessages, classifies intent, dispatches to the
 * appropriate agent execution path, and sends the response back via the
 * originating ChannelAdapter.
 *
 * Architecture:
 *   Slack webhook → SlackAdapter.parseInbound()
 *                 → channelGateway.dispatch()
 *                    → classify intent
 *                    → route to mission/pipeline/HIL
 *                    → build ChannelResponse
 *                 → SlackAdapter.sendResponse()
 *
 * Adapters are registered at startup; the gateway is platform-agnostic.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@server/utils/logger.js';
import { createRootTrace, generateTraceparent } from '@domain/core/infrastructure/tracing/trace-context.service.js';
import { assistantLinkPath } from '@shared/assistant-link.js';
import type {
    ChannelAdapter,
    ChannelMessage,
    ChannelIntent,
    ClassifiedMessage,
    ChannelResponse,
    DispatchResult,
    ChannelPlatform,
} from './channel-gateway.types.js';

const logger = createLogger('ChannelGateway');

// ---------------------------------------------------------------------------
// Intent classification (keyword-based fast path; LLM path planned for Phase 5.1)
// ---------------------------------------------------------------------------

const INTENT_PATTERNS: Array<{ patterns: RegExp[]; intent: ChannelIntent }> = [
    { patterns: [/run\s+pipeline/i, /execute\s+pipeline/i, /trigger\s+pipeline/i], intent: 'run_pipeline' },
    { patterns: [/run\s+mission/i, /start\s+mission/i, /launch\s+mission/i], intent: 'run_mission' },
    { patterns: [/status\s+of/i, /what.s\s+the\s+status/i, /is\s+.*\s+done/i], intent: 'query_status' },
    { patterns: [/show\s+me/i, /list\s+.*jobs/i, /query/i, /find\s+/i], intent: 'query_data' },
    { patterns: [/approve/i, /reject/i, /deny/i, /human\s+approval/i], intent: 'human_approval' },
    { patterns: [/hello/i, /hi\s+/i, /hey\s+/i, /thanks/i, /thank\s+you/i], intent: 'chitchat' },
];

function classifyIntent(text: string): { intent: ChannelIntent; confidence: number; entities: Record<string, string> } {
    for (const { patterns, intent } of INTENT_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(text)) {
                // Basic entity extraction (numeric IDs, quoted names)
                const entities: Record<string, string> = {};
                const idMatch = text.match(/\b(\d+)\b/);
                if (idMatch) entities['id'] = idMatch[1];
                const nameMatch = text.match(/["']([^"']+)["']/);
                if (nameMatch) entities['name'] = nameMatch[1];
                return { intent, confidence: 0.85, entities };
            }
        }
    }
    return { intent: 'unknown', confidence: 0.0, entities: {} };
}

// ---------------------------------------------------------------------------
// ChannelGatewayService
// ---------------------------------------------------------------------------

export class ChannelGatewayService {
    private adapters = new Map<ChannelPlatform, ChannelAdapter>();

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    /**
     * Register a channel adapter.
     * Calling initialize() is the adapter's responsibility at registration time.
     */
    register(adapter: ChannelAdapter): void {
        this.adapters.set(adapter.platformId, adapter);
        logger.info(`[ChannelGateway] Registered adapter: ${adapter.platformId}`);
    }

    /**
     * Deregister and destroy an adapter.
     */
    async deregister(platform: ChannelPlatform): Promise<void> {
        const adapter = this.adapters.get(platform);
        if (adapter) {
            await adapter.destroy?.();
            this.adapters.delete(platform);
            logger.info(`[ChannelGateway] Deregistered adapter: ${platform}`);
        }
    }

    /**
     * Returns true if an adapter is registered for this platform.
     */
    has(platform: ChannelPlatform): boolean {
        return this.adapters.has(platform);
    }

    // -----------------------------------------------------------------------
    // Inbound webhook entry-point
    // -----------------------------------------------------------------------

    /**
     * Handle a raw inbound webhook from a platform.
     * Verifies authenticity, parses, classifies, and dispatches.
     *
     * @param platform   The platform identifier
     * @param headers    Raw HTTP headers from the webhook request
     * @param rawBody    The raw request body string (for HMAC verification)
     * @param payload    Parsed JSON payload
     */
    async handleWebhook(
        platform: ChannelPlatform,
        headers: Record<string, string>,
        rawBody: string,
        payload: unknown
    ): Promise<DispatchResult | null> {
        const adapter = this.adapters.get(platform);
        if (!adapter) {
            logger.warn(`[ChannelGateway] No adapter registered for platform: ${platform}`);
            return null;
        }

        // Verify webhook authenticity. Awaited because an adapter may need a
        // network round trip (Teams fetches Microsoft's JWKS); an unawaited
        // promise here would have rejected after the message was already
        // dispatched, turning a failed verification into an unhandled rejection.
        try {
            await adapter.verifyWebhook(headers, rawBody);
        } catch (err: any) {
            logger.error(`[ChannelGateway] Webhook verification failed for ${platform}: ${err.message}`);
            return null;
        }

        // Parse to normalized message
        const message = adapter.parseInbound(payload);
        if (!message) {
            logger.debug(`[ChannelGateway] Ignored message from ${platform} (parseInbound returned null)`);
            return null;
        }

        return this.dispatch(message, adapter);
    }

    /**
     * Dispatch an already-normalized ChannelMessage.
     * Exposed for use by adapters that bypass the webhook flow (e.g. socket listeners).
     */
    async dispatch(message: ChannelMessage, adapterOverride?: ChannelAdapter): Promise<DispatchResult> {
        const adapter = adapterOverride ?? this.adapters.get(message.platform);
        if (!adapter) {
            throw new Error(`No adapter for platform: ${message.platform}`);
        }

        // Generate W3C root trace context for multi-channel request
        const rootTrace = createRootTrace();
        const traceparent = generateTraceparent(rootTrace);

        // Classify intent
        const { intent, confidence, entities } = classifyIntent(message.text);
        const classified: ClassifiedMessage = {
            ...message,
            intent,
            entities,
            confidence,
            metadata: { ...message.metadata, traceparent, traceId: rootTrace.traceId }
        };

        logger.info(
            `[ChannelGateway] ${message.platform} message from ${message.senderId} [trace=${rootTrace.traceId}]: ` +
            `intent=${intent} confidence=${confidence.toFixed(2)}`
        );

        // Route to the appropriate handler
        const result = await this.route(classified);

        // Build response
        const response: ChannelResponse = {
            platform: message.platform,
            channelId: message.channelId,
            threadId: message.threadId,
            text: result.summary,
        };

        // Send response back
        try {
            await adapter.sendResponse(response);
        } catch (err: any) {
            logger.error(`[ChannelGateway] Failed to send response via ${message.platform}: ${err.message}`);
        }

        return result;
    }

    // -----------------------------------------------------------------------
    // Intent routing
    // -----------------------------------------------------------------------

    private async route(msg: ClassifiedMessage): Promise<DispatchResult> {
        const base: Omit<DispatchResult, 'summary'> = { dispatched: true, intent: msg.intent };

        switch (msg.intent) {
            case 'run_pipeline': {
                const name = msg.entities['name'] ?? msg.entities['id'];
                if (!name) {
                    return { ...base, dispatched: false, summary: `Please specify a pipeline name or ID. Try: run pipeline "my-pipeline"` };
                }
                const executionId = await this.triggerPipeline(name, msg.organizationId);
                return { ...base, executionId, summary: `✅ Pipeline "${name}" triggered (execution #${executionId}).` };
            }

            case 'run_mission': {
                const name = msg.entities['name'] ?? msg.entities['id'];
                if (!name) {
                    return { ...base, dispatched: false, summary: `Please specify a mission name. Try: run mission "my-mission"` };
                }
                return { ...base, summary: `🚀 Mission "${name}" queued for execution. You'll receive an update when it completes.` };
            }

            case 'query_status': {
                const id = msg.entities['id'] ?? msg.entities['name'];
                return { ...base, summary: id
                    ? `Checking status of execution ${id}...`
                    : `Please provide an execution ID. Try: status of 123` };
            }

            case 'query_data': {
                return { ...base, summary: `Query noted. Use the Oddjob dashboard for rich data views, or provide a specific pipeline name.` };
            }

            case 'human_approval': {
                return { ...base, summary: `Approval request received. Routing to the appropriate approver.` };
            }

            case 'chitchat': {
                return { ...base, summary: `👋 Hello! I'm the Oddjob agent. Try "run pipeline 'my-pipeline'" or "status of 123".` };
            }

            default: {
                return {
                    dispatched: false,
                    intent: 'unknown',
                    summary: `I'm not sure how to help with that. Try:\n• run pipeline "name"\n• run mission "name"\n• status of 123`,
                };
            }
        }
    }

    // -----------------------------------------------------------------------
    // Stub integrations (wired to real services in Phase 5.1)
    // -----------------------------------------------------------------------

    private async triggerPipeline(nameOrId: string, organizationId?: number): Promise<number> {
        // TODO: resolve pipeline by name/id and enqueue via pipeline execution service
        logger.info(`[ChannelGateway] Stub: triggering pipeline "${nameOrId}" for org ${organizationId}`);
        return Math.floor(Math.random() * 100000);
    }

    /**
     * Broadcast an HIL (Human-In-The-Loop) form request to all registered channels.
     * This pushes native prompts (like policy violations) to Slack/Teams.
     */
    async broadcastHilRequest(form: any, link?: { path: string; label: string }): Promise<void> {
        const title = `Action Required: ${form.name || 'Agent Request'}`;
        const description = form.description || "An agent requires human approval or input to proceed.";
        // A caller that knows where the form can be answered passes it: an app's
        // request opens its CREW requests room. Otherwise the assistant's
        // approvals. `/assistant/workbench` redirected to the plain dashboard with
        // the request to open the assistant lost in a reload, and the older
        // `/approvals/${form.id}` dropped the id.
        const approvalUrl = `${process.env.PUBLIC_APP_URL || 'http://localhost:5000'}${link?.path ?? assistantLinkPath('approvals')}`;
        const buttonLabel = link?.label ?? "Review in Oddjob";

        const fallbackText = `${title}\n${description}\n${link?.label ?? 'Open the Decision Inbox'}: ${approvalUrl}`;

        // Create Slack Block Kit payload
        const slackBlocks = [
            {
                type: "header",
                text: { type: "plain_text", text: "🚨 Agent Approval Required", emoji: true }
            },
            {
                type: "section",
                text: { type: "mrkdwn", text: `*${title}*\n${description}` }
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: buttonLabel, emoji: true },
                        style: "primary",
                        url: approvalUrl
                    }
                ]
            }
        ];

        // Send to all registered adapters
        for (const [platform, adapter] of this.adapters.entries()) {
            try {
                logger.info(`[ChannelGateway] Broadcasting HIL request ${form.id} to ${platform}`);
                await adapter.sendResponse({
                    platform,
                    channelId: process.env.SLACK_APPROVALS_CHANNEL || "approvals", // Default/fallback
                    text: fallbackText,
                    richContent: platform === 'slack' ? slackBlocks : undefined,
                });
            } catch (err: any) {
                logger.error(`[ChannelGateway] Failed to broadcast HIL to ${platform}: ${err.message}`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const channelGateway = new ChannelGatewayService();
