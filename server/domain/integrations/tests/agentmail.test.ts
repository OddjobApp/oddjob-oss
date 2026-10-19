import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ─── Mock fetch globally ──────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Mock DB + schema ─────────────────────────────────────────────────────────
vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    },
}));
vi.mock("@shared/schema/index.js", () => ({
    otpCodes: "otpCodes",
    approvalRequests: "approvalRequests",
    users: "users",
    missions: "missions",
    forensicEventLog: "forensicEventLog",
}));
vi.mock("drizzle-orm", () => ({
    eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn(), desc: vi.fn(),
}));

// ─── Imports under test ───────────────────────────────────────────────────────
// Must import AFTER mocks are in place
import { parseEmailIntent } from "../core/agentmail-intent.service.js";

describe("AgentMail Intent Parser", () => {
    describe("parseEmailIntent", () => {
        it("detects APPROVE intent", async () => {
            const r = await parseEmailIntent("APPROVE 847291\n\nThanks");
            expect(r.intent).toBe("approve");
            expect(r.passcode).toBe("847291");
        });

        it("detects REJECT intent", async () => {
            const r = await parseEmailIntent("REJECT 123456");
            expect(r.intent).toBe("reject");
            expect(r.passcode).toBe("123456");
        });

        it("detects STEER intent", async () => {
            const r = await parseEmailIntent("STEER focus more on cost reduction");
            expect(r.intent).toBe("steer");
            expect(r.payload).toContain("focus more on cost reduction");
        });

        it("detects NUDGE as steer", async () => {
            const r = await parseEmailIntent("NUDGE prioritise accuracy over speed");
            expect(r.intent).toBe("steer");
        });

        it("detects LAUNCH intent", async () => {
            const r = await parseEmailIntent("LAUNCH summarise Q1 financials");
            expect(r.intent).toBe("launch");
        });

        it("returns unknown for unrecognised body", async () => {
            const r = await parseEmailIntent("Hey, just checking in!");
            expect(r.intent).toBe("unknown");
        });

        it("strips quoted reply lines before parsing", async () => {
            const body = [
                "> On Apr 15 2026, Oddjob wrote:",
                "> Please reply APPROVE or REJECT",
                "",
                "APPROVE 999888",
            ].join("\n");
            const r = await parseEmailIntent(body);
            expect(r.intent).toBe("approve");
            expect(r.passcode).toBe("999888");
        });

        it("extracts Request ID when present", async () => {
            const r = await parseEmailIntent("APPROVE 123456\n\nRequest ID: 42");
            expect(r.requestId).toBe(42);
        });

        it("handles mixed-case intent keywords", async () => {
            expect((await parseEmailIntent("approve 111222")).intent).toBe("approve");
            expect((await parseEmailIntent("Reject 333444")).intent).toBe("reject");
        });
    });
});

// ─── AgentMailService ─────────────────────────────────────────────────────────
describe("AgentMailService", () => {
    let agentMailService: any;

    beforeEach(async () => {
        vi.resetModules();
        process.env.AGENTMAIL_API_KEY = "test_key";
        process.env.AGENTMAIL_INBOX = "oddjobapp@agentmail.to";
        process.env.AGENTMAIL_WEBHOOK_SECRET = "whsec_" + Buffer.from("testsecret").toString("base64");

        mockFetch.mockReset();
        const mod = await import("../core/agentmail.service.js");
        agentMailService = mod.agentMailService;
    });

    describe("isConfigured()", () => {
        it("returns true when API key is set", () => {
            expect(agentMailService.isConfigured()).toBe(true);
        });

        it("returns false without an inbox, rather than sending from a default one", () => {
            delete process.env.AGENTMAIL_INBOX;
            expect(agentMailService.isConfigured()).toBe(false);
        });
    });

    describe("send()", () => {
        it("calls the correct endpoint with the correct body", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ message_id: "msg1", thread_id: "thr1" }),
            });

            const result = await agentMailService.send({
                to: ["user@example.com"],
                subject: "Test",
                text: "Hello",
            });

            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.agentmail.to/v0/inboxes/oddjobapp%40agentmail.to/messages/send",
                expect.objectContaining({
                    method: "POST",
                    body: JSON.stringify({ to: ["user@example.com"], subject: "Test", text: "Hello" }),
                })
            );
            expect(result.thread_id).toBe("thr1");
        });

        it("throws on non-ok response", async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                json: async () => ({ message: "Bad request" }),
            });

            await expect(
                agentMailService.send({ to: ["x@x.com"], subject: "Fail" })
            ).rejects.toThrow("AgentMail API error");
        });
    });

    describe("listThreads()", () => {
        it("requests the threads endpoint with limit", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ count: 0, threads: [] }),
            });

            await agentMailService.listThreads(5);

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining("/threads?limit=5"),
                expect.any(Object)
            );
        });
    });

    describe("verifyWebhookSignature()", () => {
        it("returns true for a valid HMAC signature", () => {
            const secret = Buffer.from("testsecret");
            const svixId = "test-id";
            const svixTimestamp = "12345678";
            const body = Buffer.from('{"type":"message.received"}');
            const toSign = `${svixId}.${svixTimestamp}.${body.toString("utf8")}`;
            const computed = crypto.createHmac("sha256", secret).update(toSign).digest("base64");

            const valid = agentMailService.verifyWebhookSignature(body, svixId, svixTimestamp, computed);
            expect(valid).toBe(true);
        });

        it("returns false for a tampered body", () => {
            const secret = Buffer.from("testsecret");
            const svixId = "test-id";
            const svixTimestamp = "12345678";
            const body = Buffer.from('{"type":"message.received"}');
            const tamperedBody = Buffer.from('{"type":"TAMPERED"}');
            const toSign = `${svixId}.${svixTimestamp}.${body.toString("utf8")}`;
            const computed = crypto.createHmac("sha256", secret).update(toSign).digest("base64");

            const valid = agentMailService.verifyWebhookSignature(tamperedBody, svixId, svixTimestamp, computed);
            expect(valid).toBe(false);
        });

        it("returns false when no webhook secret is configured", () => {
            delete process.env.AGENTMAIL_WEBHOOK_SECRET;
            const valid = agentMailService.verifyWebhookSignature(
                Buffer.from("body"), "id", "ts", "sig"
            );
            expect(valid).toBe(false);
        });
    });

    describe("sendHilEmail()", () => {
        it("includes APPROVE/REJECT instructions and passcode in text body", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ message_id: "m1", thread_id: "t1" }),
            });

            await agentMailService.sendHilEmail({
                to: "approver@example.com",
                subject: "[Oddjob] Approve something",
                actionSummary: "Delete all users",
                passcode: "777888",
                approvalToken: "tok123",
                requestId: 99,
                appUrl: "https://app.oddjob.ai",
            });

            const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(callBody.text).toContain("APPROVE 777888");
            expect(callBody.text).toContain("REJECT 777888");
            expect(callBody.html).toContain("APPROVE 777888");
            expect(callBody.to).toContain("approver@example.com");
        });
    });
});
