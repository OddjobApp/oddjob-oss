/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentmailConnections, agentmailWebhookEvents, approvalRequests, crewSessions, crewTurns, encryptedCredentials } from "@shared/schema/index.js";
import { ensureFixtureOrgs } from "../../../../tests/helpers/fixture-orgs.js";
import { agentMailThreadSync } from "../core/agentmail-thread-sync.service.js";
import { orgAgentMailService } from "../core/org-agentmail.service.js";
import { signAgentMailWebhook } from "../core/agentmail-webhook-signature.js";
import orgAgentMailRouter from "../routes/org-agentmail.js";
import legacyAgentMailRouter from "../routes/agentmail.js";

/**
 * Each organization's AgentMail inbox delivers to its own webhook, and a delivery
 * reaches only that organization: its rooms, its missions, its approvals.
 *
 * Two organizations connect their own inboxes against a stubbed AgentMail API
 * (everything else is real: router, Postgres, encryption). Both rooms are linked to
 * the SAME thread ID, the worst case for routing by thread. A reply carrying a
 * random canary into A's inbox must land in A's room and nowhere in B's.
 */

const ORG_A = 9401;
const ORG_B = 9402;
const inbox = { [ORG_A]: "mail-a@agentmail.to", [ORG_B]: "mail-b@agentmail.to" } as Record<number, string>;
const secret = { [ORG_A]: `whsec_${Buffer.from(`secret-a-${randomUUID()}`).toString("base64")}`, [ORG_B]: `whsec_${Buffer.from(`secret-b-${randomUUID()}`).toString("base64")}` } as Record<number, string>;
const token: Record<number, string> = {};
const deleted: string[] = [];
const THREAD = `thread-${randomUUID()}`;
const sessionKeys = { [ORG_A]: `mail-room-a-${randomUUID()}`, [ORG_B]: `mail-room-b-${randomUUID()}` } as Record<number, string>;
const sessionIds: Record<number, number> = {};
let foreignApprovalId = 0;

// The AgentMail API, per organization key: inbox lookup, webhook create and delete.
function agentMailApi(url: string, init: RequestInit = {}) {
    const auth = String((init.headers as Record<string, string>)?.Authorization ?? "");
    const org = auth.endsWith("key-a") ? ORG_A : ORG_B;
    if (init.method === "POST" && url.endsWith("/webhooks")) {
        const body = JSON.parse(String(init.body));
        token[org] = body.url.split("/webhooks/")[1];
        return Promise.resolve(new Response(JSON.stringify({ webhook_id: `wh_${org}`, secret: secret[org] })));
    }
    if (init.method === "DELETE") { deleted.push(url.split("/").pop()!); return Promise.resolve(new Response(null, { status: 204 })); }
    if (url.includes("/inboxes/")) return Promise.resolve(new Response(JSON.stringify({ inbox_id: decodeURIComponent(url.split("/inboxes/")[1]) })));
    // Acknowledgement replies: accepted, not inspected here.
    return Promise.resolve(new Response(JSON.stringify({ message_id: "m", thread_id: THREAD })));
}

const app = express();
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
app.use("/api/integrations/agentmail", orgAgentMailRouter);
app.use("/api/integrations/agentmail", legacyAgentMailRouter);

function event(org: number, text: string, overrides: Record<string, unknown> = {}) {
    return {
        type: "event", event_type: "message.received", event_id: `evt_${randomUUID()}`,
        message: { inbox_id: inbox[org], thread_id: THREAD, message_id: `m_${randomUUID()}`, from: "Client <client@example.com>", subject: "Re: update", text, ...overrides },
    };
}
function deliver(toToken: string, payload: unknown, signWith: string, at = Math.floor(Date.now() / 1000)) {
    const raw = Buffer.from(JSON.stringify(payload));
    const id = `msg_${randomUUID()}`;
    return request(app).post(`/api/integrations/agentmail/webhooks/${toToken}`)
        .set("content-type", "application/json")
        .set("svix-id", id).set("svix-timestamp", String(at))
        .set("svix-signature", signAgentMailWebhook(signWith, id, String(at), raw))
        .send(raw.toString());
}
async function turnsIn(org: number) {
    return db.select({ content: crewTurns.content }).from(crewTurns).where(eq(crewTurns.sessionId, sessionIds[org]));
}

async function cleanup() {
    const ids = Object.values(sessionIds);
    if (ids.length) {
        await db.delete(crewTurns).where(inArray(crewTurns.sessionId, ids));
        await db.delete(crewSessions).where(inArray(crewSessions.id, ids));
    }
    if (foreignApprovalId) await db.delete(approvalRequests).where(eq(approvalRequests.id, foreignApprovalId));
    for (const org of [ORG_A, ORG_B]) {
        await db.delete(agentmailWebhookEvents).where(eq(agentmailWebhookEvents.organizationId, org));
        await db.delete(encryptedCredentials).where(and(eq(encryptedCredentials.organizationId, org), eq(encryptedCredentials.entityType, "organization_agentmail")));
        await db.delete(agentmailConnections).where(eq(agentmailConnections.organizationId, org));
    }
}

describe("per-organization AgentMail webhooks", () => {
    beforeAll(async () => {
        vi.stubEnv("ENCRYPTION_KEY", "42".repeat(32));
        vi.stubEnv("APP_URL", "https://oddjob.example");
        vi.stubGlobal("fetch", vi.fn(agentMailApi));
        await ensureFixtureOrgs([[ORG_A, "AgentMail A"], [ORG_B, "AgentMail B"]]);
        await cleanup();

        await orgAgentMailService.connect(ORG_A, { inboxId: inbox[ORG_A], apiKey: "key-a" });
        await orgAgentMailService.connect(ORG_B, { inboxId: inbox[ORG_B], apiKey: "key-b" });

        // B's room first: a lookup by thread ID alone then finds B's room for A's reply.
        for (const org of [ORG_B, ORG_A]) {
            const [session] = await db.insert(crewSessions).values({
                organizationId: org, sessionKey: sessionKeys[org], title: `Mail room ${org}`, status: "active", mode: "explore",
            }).returning({ id: crewSessions.id });
            sessionIds[org] = session.id;
            await agentMailThreadSync.linkThreadToCrewSession(THREAD, sessionKeys[org], "client@example.com", org);
        }

        const [approval] = await db.insert(approvalRequests).values({
            organizationId: ORG_B, executionId: `exec-${randomUUID()}`, approverType: "internal",
            approverEmail: "client@example.com", status: "pending", token: randomUUID(),
        } as any).returning({ id: approvalRequests.id });
        foreignApprovalId = approval.id;
    });

    afterAll(async () => {
        await cleanup();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("gives each organization its own webhook, secret and status", async () => {
        expect(token[ORG_A]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(token[ORG_B]).not.toBe(token[ORG_A]);
        expect(await orgAgentMailService.status(ORG_A)).toMatchObject({ configured: true, inboundMode: "webhook" });
        expect((await orgAgentMailService.resolveWebhook(token[ORG_A]))?.organizationId).toBe(ORG_A);
        expect((await orgAgentMailService.resolveWebhook(token[ORG_B]))?.organizationId).toBe(ORG_B);
    });

    it("delivers a reply into its own organization's room only, though both rooms share the thread ID", async () => {
        const canary = `canary-${randomUUID()}`;
        const res = await deliver(token[ORG_A], event(ORG_A, `Looks good. ${canary}`), secret[ORG_A]);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ destination: "crew", sessionKey: sessionKeys[ORG_A] });
        expect(JSON.stringify(await turnsIn(ORG_A))).toContain(canary);
        expect(JSON.stringify(await turnsIn(ORG_B))).not.toContain(canary);
    });

    it("rejects a delivery to one organization's webhook signed with the other's secret", async () => {
        const canary = `canary-${randomUUID()}`;
        const res = await deliver(token[ORG_B], event(ORG_B, canary), secret[ORG_A]);
        expect(res.status).toBe(401);
        expect(JSON.stringify(await turnsIn(ORG_B))).not.toContain(canary);
    });

    it("rejects a signed delivery for an inbox the organization does not own", async () => {
        const canary = `canary-${randomUUID()}`;
        const res = await deliver(token[ORG_A], event(ORG_B, canary), secret[ORG_A]);
        expect(res.status).toBe(403);
        expect(JSON.stringify([...await turnsIn(ORG_A), ...await turnsIn(ORG_B)])).not.toContain(canary);
    });

    it("handles a retried delivery once", async () => {
        const canary = `canary-${randomUUID()}`;
        const payload = event(ORG_A, canary);
        expect((await deliver(token[ORG_A], payload, secret[ORG_A])).body.destination).toBe("crew");
        expect((await deliver(token[ORG_A], payload, secret[ORG_A])).body.duplicate).toBe(true);
        const hits = (await turnsIn(ORG_A)).filter(turn => turn.content.includes(canary));
        expect(hits).toHaveLength(1);
    });

    it("rejects a replayed delivery outside the timestamp window, and an unknown webhook", async () => {
        const stale = Math.floor(Date.now() / 1000) - 3600;
        expect((await deliver(token[ORG_A], event(ORG_A, "late"), secret[ORG_A], stale)).status).toBe(401);
        expect((await deliver("A".repeat(43), event(ORG_A, "nobody"), secret[ORG_A])).status).toBe(404);
    });

    it("does not let one organization's inbox decide another organization's approval", async () => {
        const res = await deliver(token[ORG_A], event(ORG_A, `APPROVE 123456\nRequest ID: ${foreignApprovalId}`, { thread_id: `other-${randomUUID()}` }), secret[ORG_A]);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ intent: "approve", decided: false });
        const [approval] = await db.select({ status: approvalRequests.status }).from(approvalRequests).where(eq(approvalRequests.id, foreignApprovalId));
        expect(approval.status).toBe("pending");
    });

    it("answers 410 on the retired shared webhook", async () => {
        const res = await request(app).post("/api/integrations/agentmail/webhook").send(event(ORG_A, "legacy"));
        expect(res.status).toBe(410);
    });

    it("deletes the organization's webhook on disconnect, after which its URL is unknown", async () => {
        await orgAgentMailService.disconnect(ORG_A);
        expect(deleted).toContain(`wh_${ORG_A}`);
        expect(await orgAgentMailService.resolveWebhook(token[ORG_A])).toBeNull();
        expect((await deliver(token[ORG_A], event(ORG_A, "after disconnect"), secret[ORG_A])).status).toBe(404);
        // The other organization is untouched.
        expect((await orgAgentMailService.resolveWebhook(token[ORG_B]))?.organizationId).toBe(ORG_B);
    });
});
