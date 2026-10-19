import { WebClient } from "@slack/web-api";
import { createLogger } from "@server/utils/logger.js";
import { credentialsService } from "../auth/core/credentials-service.js";

const logger = createLogger("SlackService");

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Slack error codes that will never succeed on retry — the token is dead,
 * revoked, or lacks the scope. Retrying these just multiplies the log noise and
 * delays the real signal (the credential needs re-authorising).
 *
 * Slack reports these as a STRING in `error.data.error` ("account_inactive"),
 * not an HTTP status, so the numeric 4xx guard below never caught them.
 */
const PERMANENT_SLACK_ERRORS = [
    "account_inactive",
    "invalid_auth",
    "not_authed",
    "token_revoked",
    "token_expired",
    "invalid_token",
    "missing_scope",
    "no_permission",
];

function isPermanentSlackError(error: any): boolean {
    const code = error?.data?.error ?? error?.code ?? "";
    const message = error?.message ?? "";
    return PERMANENT_SLACK_ERRORS.some(
        permanent => String(code) === permanent || message.includes(permanent),
    );
}

/**
 * Retry wrapper with exponential backoff for async operations
 */
async function withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    isRetryable?: (error: any) => boolean
): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            
            // Check if error is retryable
            if (isRetryable && !isRetryable(error)) {
                throw error;
            }

            // A dead/revoked token or a missing scope cannot be retried into working.
            if (isPermanentSlackError(error)) {
                logger.error(
                    `${operationName} failed permanently (${error?.data?.error ?? error?.message}) — ` +
                    `the Slack credential needs re-authorising. Not retrying.`,
                );
                throw error;
            }

            // Don't retry on 4xx errors (client errors). Only `statusCode` is numeric
            // here — `data.error` is Slack's error *name*, handled above.
            const statusCode = error.statusCode;
            if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
                throw error;
            }
            
            // Last attempt failed
            if (attempt === MAX_RETRIES - 1) {
                logger.error(`${operationName} failed after ${MAX_RETRIES} attempts:`, error);
                throw error;
            }
            
            // Exponential backoff with jitter
            const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
            logger.warn(`${operationName} attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`, {
                error: error.message || error.data?.error,
                statusCode
            });
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

export class SlackClient {
    private client: WebClient;

    constructor(token: string) {
        this.client = new WebClient(token);
    }

    /**
     * List public channels with retry logic
     */
    async getChannels(limit = 100): Promise<any[]> {
        return withRetry(
            async () => {
                const result = await this.client.conversations.list({
                    types: "public_channel",
                    limit,
                    exclude_archived: true
                });
                return result.channels || [];
            },
            "getChannels"
        );
    }

    /**
     * Get message history for a channel with retry logic
     */
    async getHistory(channelId: string, limit = 50): Promise<any[]> {
        return withRetry(
            async () => {
                const result = await this.client.conversations.history({
                    channel: channelId,
                    limit
                });
                return result.messages || [];
            },
            `getHistory(${channelId})`
        );
    }

    /**
     * Look up a Slack user by their email address with retry logic.
     * Returns the user object or null if not found.
     */
    async lookupUserByEmail(email: string): Promise<any | null> {
        try {
            return await withRetry(
                async () => {
                    const result = await this.client.users.lookupByEmail({ email });
                    return result.user || null;
                },
                `lookupUserByEmail(${email})`,
                // Don't retry on user_not_found - that's a valid response
                (error) => error.data?.error !== 'users_not_found'
            );
        } catch (error: any) {
            // not_found is a normal case — don't throw
            if (error.data?.error === 'users_not_found') return null;
            logger.warn(`Failed to lookup Slack user by email ${email}:`, error);
            return null;
        }
    }

    /**
     * Post a message with retry logic
     */
    async postMessage(channelId: string, text: string, blocks?: any[], threadTs?: string): Promise<any> {
        return withRetry(
            async () => {
                return await this.client.chat.postMessage({
                    channel: channelId,
                    text,
                    blocks,
                    thread_ts: threadTs
                });
            },
            `postMessage(${channelId})`
        );
    }

    /**
     * Download a file from Slack with retry logic
     */
    async downloadFile(url: string): Promise<Buffer> {
        return withRetry(
            async () => {
                const res = await fetch(url, {
                    headers: { Authorization: `Bearer ${this.client.token}` }
                });
                if (!res.ok) throw new Error(`Slack download failed: ${res.statusText}`);
                return Buffer.from(await res.arrayBuffer());
            },
            `downloadFile(${url.substring(0, 50)}...)`
        );
    }
}

/**
 * Factory to create an authenticated Slack Client from a Credential ID or Connector.
 */
export async function getSlackClient(token: string): Promise<SlackClient> {
    return new SlackClient(token);
}


