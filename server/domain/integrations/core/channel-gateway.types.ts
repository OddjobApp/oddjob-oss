/**
 * Channel Gateway — Type Definitions
 *
 * Defines the ChannelAdapter interface and shared message/event types for
 * the unified multi-channel messaging layer (Phase 5).
 *
 * All channel adapters (Slack, Discord, Teams, Email) implement ChannelAdapter.
 * The ChannelGatewayService dispatches inbound messages to agent execution
 * and routes responses back through the originating adapter.
 *
 * Design principles:
 *  - Platform-agnostic: callers never touch Slack/Discord APIs directly
 *  - Intent-first: messages are classified before routing
 *  - Async: all I/O is non-blocking; replies are queued
 *  - Auditable: every inbound/outbound message is logged
 */

// ---------------------------------------------------------------------------
// Platform identifiers
// ---------------------------------------------------------------------------

export type ChannelPlatform = 'slack' | 'discord' | 'teams' | 'email' | 'webhook';

// ---------------------------------------------------------------------------
// Inbound message (platform → gateway)
// ---------------------------------------------------------------------------

export interface ChannelMessage {
    /** Opaque ID assigned by the gateway on receipt */
    id: string;
    /** Source platform */
    platform: ChannelPlatform;
    /** Platform-native channel/room/thread identifier */
    channelId: string;
    /** Platform-native thread identifier (if applicable) */
    threadId?: string;
    /** Platform-native sender identifier */
    senderId: string;
    /** Display name of the sender */
    senderName?: string;
    /** The message text (stripped of @-mentions) */
    text: string;
    /** Raw platform payload (for platform-specific metadata access) */
    raw?: unknown;
    /** Org associated with this channel integration */
    organizationId?: number;
    /** Timestamp of the original message */
    timestamp: Date;
    /** Arbitrary trace/platform metadata (traceparent, traceId, etc.) */
    metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Intent classification (output of intent classifier)
// ---------------------------------------------------------------------------

export type ChannelIntent =
    | 'run_pipeline'
    | 'run_mission'
    | 'query_status'
    | 'query_data'
    | 'human_approval'
    | 'chitchat'
    | 'unknown';

export interface ClassifiedMessage extends ChannelMessage {
    intent: ChannelIntent;
    /** Extracted entities from the message (pipeline name, job ID, etc.) */
    entities: Record<string, string>;
    /** Confidence score [0, 1] */
    confidence: number;
}

// ---------------------------------------------------------------------------
// Outbound response (gateway → platform)
// ---------------------------------------------------------------------------

export interface ChannelResponse {
    /** The platform to send to (inferred from inbound message) */
    platform: ChannelPlatform;
    /** Reply to this channel/room */
    channelId: string;
    /** If set, send as a threaded reply */
    threadId?: string;
    /** Plain-text fallback */
    text: string;
    /** Rich blocks (Slack Block Kit, Discord Embeds, etc.) */
    richContent?: unknown;
    /** Whether the response should be marked as ephemeral (only sender sees it) */
    ephemeral?: boolean;
}

// ---------------------------------------------------------------------------
// ChannelAdapter interface (implemented by each platform adapter)
// ---------------------------------------------------------------------------

export interface ChannelAdapter {
    /** Unique identifier for this adapter instance */
    readonly platformId: ChannelPlatform;

    /**
     * Send a response back to a channel.
     * Implementations must handle auth, retries, and rate-limiting internally.
     */
    sendResponse(response: ChannelResponse): Promise<void>;

    /**
     * Parse a raw platform webhook payload into a normalized ChannelMessage.
     * Returns null if the payload should be ignored (bot messages, etc.)
     */
    parseInbound(payload: unknown): ChannelMessage | null;

    /**
     * Verify that an inbound webhook request is authentic.
     * Should throw if verification fails.
     *
     * May be async: Teams validates a JWT against Microsoft's published JWKS,
     * which has to be fetched. The gateway awaits the result either way, so a
     * synchronous adapter such as Discord needs no change.
     */
    verifyWebhook(headers: Record<string, string>, rawBody: string): boolean | Promise<boolean>;

    /**
     * Lifecycle: called once when the adapter is registered.
     * Use for socket connections, subscriptions, etc.
     */
    initialize?(): Promise<void>;

    /**
     * Lifecycle: called on shutdown.
     */
    destroy?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Routing result (output of the gateway dispatch)
// ---------------------------------------------------------------------------

export interface DispatchResult {
    /** Whether the message was successfully routed */
    dispatched: boolean;
    /** The classified intent */
    intent: ChannelIntent;
    /** Execution ID if an agent/pipeline was triggered */
    executionId?: string | number;
    /** Human-readable summary of what happened */
    summary: string;
}
