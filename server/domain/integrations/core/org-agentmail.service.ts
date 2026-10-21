import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/database_service.js";
import { agentmailConnections, encryptedCredentials } from "@shared/schema/index.js";
import { encrypt, decrypt } from "@server/utils/encryption.js";
import { encryptedCredentialOwner } from "@server/utils/encrypted-credential-owner.js";
import { BadRequestError } from "@server/utils/errors.js";

const inputSchema = z.object({
    inboxId: z.string().trim().min(1).max(320).regex(/^[a-zA-Z0-9@._+-]+$/),
    apiKey: z.string().trim().min(1).max(16_384).regex(/^[\x21-\x7e]+$/),
}).strict();

export function requireAgentMailOrg(organizationId: unknown): number {
    if (typeof organizationId !== "number" || !Number.isSafeInteger(organizationId) || organizationId <= 0) {
        throw new BadRequestError("Organization context required for AgentMail");
    }
    return organizationId;
}

function ref(orgId: number) {
    return { organizationId: orgId, entityType: "organization_agentmail", entityId: orgId, credentialType: "api_key" };
}
function scope(orgId: number) {
    return and(eq(encryptedCredentials.organizationId, orgId),
        eq(encryptedCredentials.entityType, "organization_agentmail"),
        eq(encryptedCredentials.entityId, orgId), eq(encryptedCredentials.credentialType, "api_key"));
}

export const orgAgentMailService = {
    async status(organizationId: number) {
        const orgId = requireAgentMailOrg(organizationId);
        const [connection] = await db.select({ inboxId: agentmailConnections.inboxId }).from(agentmailConnections)
            .innerJoin(encryptedCredentials, scope(orgId))
            .where(eq(agentmailConnections.organizationId, orgId)).limit(1);
        return { configured: !!connection, inboxId: connection?.inboxId ?? null, inboundMode: "polling" as const };
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

    async connect(organizationId: number, input: unknown) {
        const orgId = requireAgentMailOrg(organizationId);
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) throw new BadRequestError("Enter a valid AgentMail inbox ID and API key");
        const { inboxId, apiKey } = parsed.data;
        // Verify access without sending mail, provisioning billable resources, or trusting a supplied URL.
        let response: Response;
        try {
            response = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}`, {
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
        const encryptedData = encrypt(apiKey, encryptedCredentialOwner(ref(orgId))!);
        try {
            await db.transaction(async tx => {
                await tx.execute(sql`SELECT pg_advisory_xact_lock(641022, ${orgId})`);
                await tx.insert(agentmailConnections).values({ organizationId: orgId, inboxId })
                    .onConflictDoUpdate({ target: agentmailConnections.organizationId, set: { inboxId, updatedAt: new Date() } });
                await tx.delete(encryptedCredentials).where(scope(orgId));
                await tx.insert(encryptedCredentials).values({ ...ref(orgId), encryptedData });
            });
        } catch (error) {
            const cause = error as { code?: string; cause?: { code?: string } };
            if (cause.code === "23505" || cause.cause?.code === "23505") {
                throw new BadRequestError("This AgentMail inbox is already connected to another organization");
            }
            throw error;
        }
        return this.status(orgId);
    },

    async disconnect(organizationId: number) {
        const orgId = requireAgentMailOrg(organizationId);
        await db.transaction(async tx => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(641022, ${orgId})`);
            await tx.delete(encryptedCredentials).where(scope(orgId));
            await tx.delete(agentmailConnections).where(eq(agentmailConnections.organizationId, orgId));
        });
    },
};
