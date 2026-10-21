import { and, eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@server/database_service.js";
import { agentmailConnections, encryptedCredentials } from "@shared/schema/index.js";
import { encrypt, decrypt } from "@server/utils/encryption.js";
import { encryptedCredentialOwner } from "@server/utils/encrypted-credential-owner.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OrgAgentMail");
const AGENTMAIL_API = "https://api.agentmail.to/v0";
/** Inbound mail is all the webhook is for; replies are matched to rooms and missions by thread. */
const WEBHOOK_EVENTS = ["message.received"];

const inputSchema = z.object({
    inboxId: z.string().trim().min(1).max(320).regex(/^[a-zA-Z0-9@._+-]+$/),
    apiKey: z.string().trim().min(1).max(16_384).regex(/^[\x21-\x7e]+$/),
}).strict();

type CredentialType = "api_key" | "webhook_secret";

export function requireAgentMailOrg(organizationId: unknown): number {
    if (typeof organizationId !== "number" || !Number.isSafeInteger(organizationId) || organizationId <= 0) {
        throw new BadRequestError("Organization context required for AgentMail");
    }
    return organizationId;
}

function ref(orgId: number, credentialType: CredentialType = "api_key") {
    return { organizationId: orgId, entityType: "organization_agentmail", entityId: orgId, credentialType };
}
function scope(orgId: number, credentialType: CredentialType = "api_key") {
    return and(eq(encryptedCredentials.organizationId, orgId),
        eq(encryptedCredentials.entityType, "organization_agentmail"),
        eq(encryptedCredentials.entityId, orgId), eq(encryptedCredentials.credentialType, credentialType));
}
function allCredentials(orgId: number) {
    return and(eq(encryptedCredentials.organizationId, orgId),
        eq(encryptedCredentials.entityType, "organization_agentmail"), eq(encryptedCredentials.entityId, orgId));
}

/** The hash stored for a webhook URL token; the token itself is never stored. */
export function hashWebhookToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
const WEBHOOK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The public https origin AgentMail can deliver to, from APP_URL (or PUBLIC_URL).
 * Null when there is none: a development server is not reachable from AgentMail,
 * and such an organization's inbound mail is read by polling instead.
 */
export function webhookBaseUrl(): string | null {
    const raw = (process.env.APP_URL || process.env.PUBLIC_URL || "").trim();
    try {
        const url = new URL(raw);
        return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
    } catch {
        return null;
    }
}

/** An AgentMail call made with a tenant's key. Provider errors are reduced to the status: they can echo the key. */
async function agentMail<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${AGENTMAIL_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`AgentMail ${method} ${path.split("/")[1]} failed [${response.status}]`);
    return (method === "DELETE" ? undefined : await response.json()) as T;
}

async function deleteWebhook(apiKey: string, webhookId: string, why: string) {
    try {
        await agentMail(apiKey, "DELETE", `/webhooks/${encodeURIComponent(webhookId)}`);
    } catch (error) {
        // An orphaned webhook delivers to a token no row matches any more, and is refused.
        logger.warn(`[OrgAgentMail] Could not delete AgentMail webhook (${why}); remove it in AgentMail`, { webhookId, error: (error as Error).message });
    }
}

export const orgAgentMailService = {
    async status(organizationId: number) {
        const orgId = requireAgentMailOrg(organizationId);
        const [connection] = await db.select({ inboxId: agentmailConnections.inboxId, webhookId: agentmailConnections.webhookId })
            .from(agentmailConnections)
            .innerJoin(encryptedCredentials, scope(orgId))
            .where(eq(agentmailConnections.organizationId, orgId)).limit(1);
        return {
            configured: !!connection,
            inboxId: connection?.inboxId ?? null,
            inboundMode: connection?.webhookId ? "webhook" as const : "polling" as const,
        };
    },

    /** No cache or platform-key fallback: disconnects and rotations take effect on the next call. */
    async resolve(organizationId: number) {
        const orgId = requireAgentMailOrg(organizationId);
        const [row] = await db.select({ inboxId: agentmailConnections.inboxId, encryptedData: encryptedCredentials.encryptedData })
            .from(agentmailConnections).innerJoin(encryptedCredentials, scope(orgId))
            .where(eq(agentmailConnections.organizationId, orgId)).limit(1);
        if (!row) throw new BadRequestError("Connect AgentMail in Organization Settings first");
        return { organizationId: orgId, inboxId: row.inboxId, apiKey: decrypt(row.encryptedData, encryptedCredentialOwner(ref(orgId))!) };
    },

    /**
     * The organization a webhook delivery belongs to, found by the token in its URL,
     * with that organization's own signing secret. Null for an unknown token.
     */
    async resolveWebhook(token: string) {
        if (!WEBHOOK_TOKEN.test(token)) return null;
        const [row] = await db.select({
            organizationId: agentmailConnections.organizationId,
            inboxId: agentmailConnections.inboxId,
            encryptedData: encryptedCredentials.encryptedData,
        }).from(agentmailConnections)
            .innerJoin(encryptedCredentials, and(
                eq(encryptedCredentials.organizationId, agentmailConnections.organizationId),
                eq(encryptedCredentials.entityType, "organization_agentmail"),
                eq(encryptedCredentials.entityId, agentmailConnections.organizationId),
                eq(encryptedCredentials.credentialType, "webhook_secret"),
            ))
            .where(eq(agentmailConnections.webhookTokenHash, hashWebhookToken(token))).limit(1);
        if (!row) return null;
        const orgId = requireAgentMailOrg(row.organizationId);
        return { organizationId: orgId, inboxId: row.inboxId, secret: decrypt(row.encryptedData, encryptedCredentialOwner(ref(orgId, "webhook_secret"))!) };
    },

    async connect(organizationId: number, input: unknown) {
        const orgId = requireAgentMailOrg(organizationId);
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) throw new BadRequestError("Enter a valid AgentMail inbox ID and API key");
        const { inboxId, apiKey } = parsed.data;
        const base = webhookBaseUrl();
        if (!base && process.env.NODE_ENV === "production") {
            throw new BadRequestError("Set APP_URL to this deployment's public https address before connecting AgentMail");
        }
        // Verify access without sending mail, provisioning billable resources, or trusting a supplied URL.
        let response: Response;
        try {
            response = await fetch(`${AGENTMAIL_API}/inboxes/${encodeURIComponent(inboxId)}`, {
                headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000),
            });
        } catch {
            throw new BadRequestError("AgentMail connection check failed; check your credentials and retry");
        }
        if (!response.ok) throw new BadRequestError("AgentMail could not verify access to this inbox");
        let inbox: { inbox_id?: unknown };
        try { inbox = await response.json() as { inbox_id?: unknown }; }
        catch { throw new BadRequestError("AgentMail returned an invalid inbox response"); }
        if (inbox.inbox_id !== inboxId) throw new BadRequestError("AgentMail returned a different inbox ID");

        // The webhook being replaced, removed once the new one is saved.
        const previous = await this.previousWebhook(orgId);

        // This organization's own webhook: its inbox only, its own secret, an
        // unguessable URL. Registered before saving, and removed again if saving fails.
        let webhook: { webhookId: string; secret: string; token: string } | null = null;
        if (base) {
            const token = randomBytes(32).toString("base64url");
            let created: { webhook_id?: unknown; secret?: unknown };
            try {
                created = await agentMail(apiKey, "POST", "/webhooks", {
                    url: `${base}/api/integrations/agentmail/webhooks/${token}`,
                    event_types: WEBHOOK_EVENTS,
                    inbox_ids: [inboxId],
                    client_id: `oddjob-org-${orgId}-${hashWebhookToken(token).slice(0, 12)}`,
                });
            } catch {
                throw new BadRequestError("AgentMail could not register this organization's webhook; check the key's permissions and retry");
            }
            if (typeof created.webhook_id !== "string" || typeof created.secret !== "string" || !created.secret.startsWith("whsec_")) {
                if (typeof created.webhook_id === "string") await deleteWebhook(apiKey, created.webhook_id, "invalid registration response");
                throw new BadRequestError("AgentMail returned an invalid webhook registration");
            }
            webhook = { webhookId: created.webhook_id, secret: created.secret, token };
        }

        const values = {
            inboxId,
            webhookId: webhook?.webhookId ?? null,
            webhookTokenHash: webhook ? hashWebhookToken(webhook.token) : null,
        };
        try {
            await db.transaction(async tx => {
                await tx.execute(sql`SELECT pg_advisory_xact_lock(641022, ${orgId})`);
                await tx.insert(agentmailConnections).values({ organizationId: orgId, ...values })
                    .onConflictDoUpdate({ target: agentmailConnections.organizationId, set: { ...values, updatedAt: new Date() } });
                await tx.delete(encryptedCredentials).where(allCredentials(orgId));
                await tx.insert(encryptedCredentials).values({ ...ref(orgId), encryptedData: encrypt(apiKey, encryptedCredentialOwner(ref(orgId))!) });
                if (webhook) {
                    const secretRef = ref(orgId, "webhook_secret");
                    await tx.insert(encryptedCredentials).values({ ...secretRef, encryptedData: encrypt(webhook.secret, encryptedCredentialOwner(secretRef)!) });
                }
            });
        } catch (error) {
            if (webhook) await deleteWebhook(apiKey, webhook.webhookId, "connection not saved");
            const cause = error as { code?: string; cause?: { code?: string } };
            if (cause.code === "23505" || cause.cause?.code === "23505") {
                throw new BadRequestError("This AgentMail inbox is already connected to another organization");
            }
            throw error;
        }
        if (previous && previous.webhookId !== webhook?.webhookId) await deleteWebhook(previous.apiKey, previous.webhookId, "replaced");
        return this.status(orgId);
    },

    async disconnect(organizationId: number) {
        const orgId = requireAgentMailOrg(organizationId);
        const previous = await this.previousWebhook(orgId);
        await db.transaction(async tx => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(641022, ${orgId})`);
            await tx.delete(encryptedCredentials).where(allCredentials(orgId));
            await tx.delete(agentmailConnections).where(eq(agentmailConnections.organizationId, orgId));
        });
        if (previous) await deleteWebhook(previous.apiKey, previous.webhookId, "disconnected");
    },

    /** The organization's registered webhook and the key that can delete it, if any. */
    async previousWebhook(orgId: number): Promise<{ webhookId: string; apiKey: string } | null> {
        const [row] = await db.select({ webhookId: agentmailConnections.webhookId, encryptedData: encryptedCredentials.encryptedData })
            .from(agentmailConnections).innerJoin(encryptedCredentials, scope(orgId))
            .where(eq(agentmailConnections.organizationId, orgId)).limit(1);
        if (!row?.webhookId) return null;
        try {
            return { webhookId: row.webhookId, apiKey: decrypt(row.encryptedData, encryptedCredentialOwner(ref(orgId))!) };
        } catch {
            logger.warn("[OrgAgentMail] Stored AgentMail key could not be read; the old webhook stays registered", { orgId });
            return null;
        }
    },
};
