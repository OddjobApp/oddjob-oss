/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentmailThreads, crewSessions, projectMembers, projects } from "@shared/schema/index.js";
import { ensureFixtureOrgs } from "../../../../tests/helpers/fixture-orgs.js";
import { agentMailService } from "../core/agentmail.service.js";
import { agentMailThreadScope, threadScopeCtx } from "../core/agentmail-thread-scope.service.js";
import { agentMailThreadSync } from "../core/agentmail-thread-sync.service.js";
import { AGENTMAIL_TOOLS } from "../../tools/v1/capabilities/agentmail.js";
import { handleAgentMailGetThread, handleAgentMailListThreads } from "../../../mcp/handlers/agentmail.js";
import { pollAgentMailInbox } from "../../../workers/heartbeat-sources.js";

/**
 * One organization, one AgentMail inbox, and a thread that belongs to a private
 * project. Its subject carries a random canary. A member of the project sees it;
 * a colleague outside the project, an agent acting for no one, and a heartbeat
 * trigger never do, through any reader: list, get, reply, MCP, polling.
 *
 * Postgres and project access are real; only the AgentMail API is stubbed.
 */

const ORG = 9501;
const CANARY = `canary-${randomUUID()}`;
const T_PRIVATE = `thread-private-${randomUUID()}`;
const T_OPEN = `thread-open-${randomUUID()}`;
const T_UNSCOPED = `thread-unscoped-${randomUUID()}`;
const T_BACKFILL = `thread-backfill-${randomUUID()}`;
const MEMBER = `member-${randomUUID()}`;
const OUTSIDER = `outsider-${randomUUID()}`;
let privateProject = 0;
let openProject = 0;
const sessionIds: number[] = [];

const threads = [
    { thread_id: T_PRIVATE, subject: `Acquisition ${CANARY}` },
    { thread_id: T_OPEN, subject: "Open project update" },
    { thread_id: T_UNSCOPED, subject: "General inbox" },
];
const messages = threads.map((t, i) => ({
    message_id: `m-${i}`, thread_id: t.thread_id, from: "Client <client@example.com>",
    subject: t.subject, text: t.subject, created_at: new Date(Date.now() - (3 - i) * 1000).toISOString(),
}));
const sent: Array<{ op: string; arg: unknown }> = [];
const fakeMail = {
    isConfigured: () => true,
    listThreads: async () => ({ count: threads.length, threads }),
    listMessages: async () => ({ count: messages.length, messages: [...messages].reverse() }),
    getThread: async (id: string) => ({ thread_id: id, subject: threads.find((t) => t.thread_id === id)?.subject, messages: [] }),
    getMessage: async (id: string) => messages.find((m) => m.message_id === id)!,
    getInboxAddress: async () => "inbox@agentmail.to",
    reply: async (id: string, arg: unknown) => { sent.push({ op: `reply:${id}`, arg }); return { message_id: "r", thread_id: "x" }; },
    send: async (arg: any) => { sent.push({ op: "send", arg }); return { message_id: "s", thread_id: arg.thread_id ?? `thread-new-${randomUUID()}` }; },
};

const member = { organizationId: ORG, userId: MEMBER };
const outsider = { organizationId: ORG, userId: OUTSIDER };

describe("AgentMail threads are scoped to their project", () => {
    beforeAll(async () => {
        await ensureFixtureOrgs([[ORG, "AgentMail project scope"]]);
        vi.spyOn(agentMailService, "forOrg").mockResolvedValue(fakeMail as any);

        const [p] = await db.insert(projects).values({
            organizationId: ORG, key: `deal-${randomUUID().slice(0, 8)}`, name: "Deal room", visibility: "private", createdBy: MEMBER,
        }).returning({ id: projects.id });
        privateProject = p.id;
        const [o] = await db.insert(projects).values({
            organizationId: ORG, key: `open-${randomUUID().slice(0, 8)}`, name: "Open project", visibility: "org", createdBy: MEMBER,
        }).returning({ id: projects.id });
        openProject = o.id;
        await db.insert(projectMembers).values({ projectId: privateProject, principalType: "user", principalId: MEMBER, role: "editor" });

        // The private thread reaches the table the way production does: sent from the room.
        const [room] = await db.insert(crewSessions).values({
            organizationId: ORG, sessionKey: `deal-room-${randomUUID()}`, title: "Deal room", status: "active", mode: "explore", projectId: privateProject,
        }).returning({ id: crewSessions.id, sessionKey: crewSessions.sessionKey });
        sessionIds.push(room.id);
        await agentMailThreadSync.linkThreadToCrewSession(T_PRIVATE, room.sessionKey, "client@example.com", ORG);
        await agentMailThreadScope.record(ORG, T_OPEN, { projectId: openProject });
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        await db.delete(agentmailThreads).where(eq(agentmailThreads.organizationId, ORG));
        if (sessionIds.length) await db.delete(crewSessions).where(inArray(crewSessions.id, sessionIds));
        await db.delete(projects).where(eq(projects.organizationId, ORG));
    });

    it("records a room's thread under the room's project", async () => {
        const [row] = await db.select().from(agentmailThreads).where(eq(agentmailThreads.threadId, T_PRIVATE));
        expect(row.projectId).toBe(privateProject);
        expect(row.crewSessionId).toBe(sessionIds[0]);
    });

    it("never moves a thread out of its project", async () => {
        await agentMailThreadScope.record(ORG, T_PRIVATE, { projectId: null });
        await agentMailThreadScope.record(ORG, T_PRIVATE, { projectId: openProject });
        const [row] = await db.select().from(agentmailThreads).where(eq(agentmailThreads.threadId, T_PRIVATE));
        expect(row.projectId).toBe(privateProject);
    });

    it("lists the private thread to a project member only", async () => {
        const forMember = await AGENTMAIL_TOOLS.list_agentmail_threads.execute({ limit: 10 }, member);
        const forOutsider = await AGENTMAIL_TOOLS.list_agentmail_threads.execute({ limit: 10 }, outsider);
        expect(forMember).toContain(CANARY);
        expect(forOutsider).not.toContain(CANARY);
        expect(forOutsider).not.toContain(T_PRIVATE);
        // Open-project and unscoped mail is everyone's, as before.
        expect(forOutsider).toContain(T_OPEN);
        expect(forOutsider).toContain(T_UNSCOPED);
    });

    it("answers a direct read by an outsider as if the thread did not exist", async () => {
        expect(await AGENTMAIL_TOOLS.get_agentmail_thread.execute({ threadId: T_PRIVATE }, member)).toContain(CANARY);
        const denied = await AGENTMAIL_TOOLS.get_agentmail_thread.execute({ threadId: T_PRIVATE }, outsider);
        expect(denied).not.toContain(CANARY);
        expect(denied).toMatch(/not found/i);
    });

    it("refuses an outsider's reply or send into the private thread", async () => {
        sent.length = 0;
        const reply = await AGENTMAIL_TOOLS.reply_agentmail.execute({ messageId: "m-0", text: "hi" }, outsider);
        const send = await AGENTMAIL_TOOLS.send_agentmail.execute({ to: "x@example.com", subject: "s", text: "t", threadId: T_PRIVATE }, outsider);
        expect(reply).toMatch(/not found/i);
        expect(send).toMatch(/not found/i);
        expect(sent).toEqual([]);

        expect(await AGENTMAIL_TOOLS.reply_agentmail.execute({ messageId: "m-0", text: "hi" }, member)).toMatch(/Reply sent/);
    });

    it("hides the private thread from an agent acting for no user and from org-wide MCP reads", async () => {
        const list = await handleAgentMailListThreads({ limit: 10 }, { organizationId: ORG } as any);
        expect(JSON.stringify(list)).not.toContain(CANARY);
        const get = await handleAgentMailGetThread({ thread_id: T_PRIVATE }, { organizationId: ORG } as any);
        expect(JSON.stringify(get)).not.toContain(CANARY);
        expect(JSON.stringify(await handleAgentMailGetThread({ thread_id: T_PRIVATE }, member as any))).toContain(CANARY);
    });

    it("lets an org admin read every thread", async () => {
        const forAdmin = await AGENTMAIL_TOOLS.list_agentmail_threads.execute({ limit: 10 }, { ...outsider, isOrgAdmin: true });
        expect(forAdmin).toContain(CANARY);
    });

    it("keeps the private thread out of heartbeat-created work", async () => {
        const items = await pollAgentMailInbox(null, { limit: 10 }, ORG);
        const ids = items.map((i) => i.threadId);
        expect(ids).toContain(T_UNSCOPED);
        expect(ids).toContain(T_OPEN);
        expect(ids).not.toContain(T_PRIVATE);
        expect(JSON.stringify(items)).not.toContain(CANARY);
    });

    it("records a thread sent from a project room under that project", async () => {
        sent.length = 0;
        await AGENTMAIL_TOOLS.send_agentmail.execute(
            { to: "x@example.com", subject: "s", text: "t" },
            { ...member, projectId: privateProject, sessionId: sessionIds[0] },
        );
        const rows = await db.select().from(agentmailThreads)
            .where(sql`${agentmailThreads.organizationId} = ${ORG} AND ${agentmailThreads.threadId} LIKE 'thread-new-%'`);
        expect(rows).toHaveLength(1);
        expect(rows[0].projectId).toBe(privateProject);
    });

    it("reports a send that went out as sent, even if its project could not be recorded", async () => {
        sent.length = 0;
        const record = vi.spyOn(agentMailThreadScope, "record").mockRejectedValueOnce(new Error("database unavailable"));
        const result = await AGENTMAIL_TOOLS.send_agentmail.execute(
            { to: "x@example.com", subject: "s", text: "t" },
            { ...member, projectId: privateProject },
        );
        record.mockRestore();
        // Reporting it as failed would invite the agent to send the same email again.
        expect(result).toMatch(/^Email sent successfully/);
        expect(sent).toHaveLength(1);
    });

    it("migration backfills threads already linked to project rooms", async () => {
        const [room] = await db.insert(crewSessions).values({
            organizationId: ORG, sessionKey: `old-room-${randomUUID()}`, title: "Old room", status: "active", mode: "explore",
            projectId: privateProject, cycleContext: { emailThreadId: T_BACKFILL } as any,
        }).returning({ id: crewSessions.id });
        sessionIds.push(room.id);

        const migration = readFileSync(resolve(__dirname, "../../../../migrations/runtime/0156_agentmail_threads.sql"), "utf8");
        await db.execute(sql.raw(migration));

        const [row] = await db.select().from(agentmailThreads).where(eq(agentmailThreads.threadId, T_BACKFILL));
        expect(row.projectId).toBe(privateProject);
        await expect(agentMailThreadScope.assertReadable(threadScopeCtx(outsider, ORG), T_BACKFILL)).rejects.toThrow(/not found/i);
    });
});
