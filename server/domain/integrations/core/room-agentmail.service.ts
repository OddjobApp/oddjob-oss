import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/database_service.js";
import { agentmailRoomInboxes, crewSessions } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { orgAgentMailService, requireAgentMailOrg } from "./org-agentmail.service.js";

const assignment = z.object({ inboxId: z.string().trim().min(1).max(320).regex(/^[a-zA-Z0-9@._+-]+$/) }).strict();
async function room(organizationId: number, sessionKey: string) {
    requireAgentMailOrg(organizationId);
    if (typeof sessionKey !== "string" || !sessionKey || sessionKey.length > 512) throw new BadRequestError("Room context required");
    const [session] = await db.select({ id: crewSessions.id }).from(crewSessions)
        .where(and(eq(crewSessions.organizationId, organizationId), eq(crewSessions.sessionKey, sessionKey))).limit(1);
    if (!session) throw new NotFoundError("Room not found");
    return session;
}
export const roomAgentMailService = {
    async status(organizationId: number, sessionKey: string) {
        const session = await room(organizationId, sessionKey);
        const [mapping] = await db.select({ inboxId: agentmailRoomInboxes.inboxId }).from(agentmailRoomInboxes)
            .where(and(eq(agentmailRoomInboxes.organizationId, organizationId), eq(agentmailRoomInboxes.sessionId, session.id))).limit(1);
        const connection = await orgAgentMailService.status(organizationId);
        return { configured: !!mapping && connection.configured, inboxId: mapping?.inboxId ?? null, organizationConnected: connection.configured };
    },
    async resolve(organizationId: number, sessionKey: string) {
        const status = await this.status(organizationId, sessionKey);
        if (!status.configured || !status.inboxId) throw new BadRequestError("Assign an AgentMail inbox in Room Integrations first");
        return { ...await orgAgentMailService.resolve(organizationId), inboxId: status.inboxId };
    },
    async assign(organizationId: number, sessionKey: string, input: unknown) {
        const session = await room(organizationId, sessionKey);
        const parsed = assignment.safeParse(input);
        if (!parsed.success) throw new BadRequestError("Enter a valid AgentMail inbox ID");
        const { apiKey } = await orgAgentMailService.resolve(organizationId);
        const inboxId = parsed.data.inboxId;
        let response: Response;
        try {
            response = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}`, {
                headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000),
            });
        } catch { throw new BadRequestError("AgentMail inbox verification failed"); }
        if (!response.ok) throw new BadRequestError("The organization key cannot access this inbox");
        let inbox: { inbox_id?: unknown };
        try { inbox = await response.json(); } catch { throw new BadRequestError("AgentMail returned an invalid inbox"); }
        if (inbox.inbox_id !== inboxId) throw new BadRequestError("AgentMail returned a different inbox ID");
        try {
            await db.insert(agentmailRoomInboxes).values({ organizationId, sessionId: session.id, inboxId })
                .onConflictDoUpdate({ target: agentmailRoomInboxes.sessionId, set: { inboxId, updatedAt: new Date() } });
        } catch (error) {
            const e = error as { code?: string; cause?: { code?: string } };
            if (e.code === "23505" || e.cause?.code === "23505") throw new BadRequestError("This inbox is already assigned; use a dedicated inbox for this room");
            throw error;
        }
        return this.status(organizationId, sessionKey);
    },
    async disconnect(organizationId: number, sessionKey: string) {
        const session = await room(organizationId, sessionKey);
        await db.delete(agentmailRoomInboxes).where(and(eq(agentmailRoomInboxes.organizationId, organizationId), eq(agentmailRoomInboxes.sessionId, session.id)));
    },
};
