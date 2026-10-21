/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { signAgentMailWebhook, verifyAgentMailWebhook, WEBHOOK_TOLERANCE_SECONDS } from "./agentmail-webhook-signature.js";

const secretA = `whsec_${Buffer.from("organization-a-signing-secret-32b").toString("base64")}`;
const secretB = `whsec_${Buffer.from("organization-b-signing-secret-32b").toString("base64")}`;
const body = Buffer.from(JSON.stringify({ event_type: "message.received", event_id: "evt_1" }));
const now = 1_800_000_000;
const ts = String(now);
const signed = (secret = secretA, raw = body, at = ts) => ({ id: "msg_1", timestamp: at, signature: signAgentMailWebhook(secret, "msg_1", at, raw) });

describe("AgentMail webhook signature", () => {
    it("accepts a delivery signed with the organization's own secret", () => {
        expect(verifyAgentMailWebhook(secretA, body, signed(), now)).toBe(true);
    });

    it("rejects a delivery signed with another organization's secret", () => {
        expect(verifyAgentMailWebhook(secretA, body, signed(secretB), now)).toBe(false);
    });

    it("rejects a body changed after signing", () => {
        const tampered = Buffer.from(body.toString().replace("evt_1", "evt_2"));
        expect(verifyAgentMailWebhook(secretA, tampered, signed(), now)).toBe(false);
    });

    it("rejects a replay outside the tolerance, in either direction", () => {
        const old = String(now - WEBHOOK_TOLERANCE_SECONDS - 1);
        const future = String(now + WEBHOOK_TOLERANCE_SECONDS + 1);
        expect(verifyAgentMailWebhook(secretA, body, signed(secretA, body, old), now)).toBe(false);
        expect(verifyAgentMailWebhook(secretA, body, signed(secretA, body, future), now)).toBe(false);
        expect(verifyAgentMailWebhook(secretA, body, signed(secretA, body, String(now - WEBHOOK_TOLERANCE_SECONDS)), now)).toBe(true);
    });

    it("accepts any one matching signature in a rotation list", () => {
        const headers = signed();
        expect(verifyAgentMailWebhook(secretA, body, { ...headers, signature: `v1,${"A".repeat(44)} ${headers.signature}` }, now)).toBe(true);
    });

    it.each([
        ["no headers", {}],
        ["no signature", { id: "msg_1", timestamp: ts }],
        ["a non-numeric timestamp", { ...signed(), timestamp: "soon" }],
        ["an unversioned signature", { ...signed(), signature: signed().signature.slice(3) }],
    ])("rejects %s", (_label, headers) => {
        expect(verifyAgentMailWebhook(secretA, body, headers as any, now)).toBe(false);
    });

    it("rejects a secret that is not a whsec_ value and an empty body", () => {
        expect(verifyAgentMailWebhook("not-a-secret", body, signed(), now)).toBe(false);
        expect(verifyAgentMailWebhook(secretA, Buffer.alloc(0), signed(), now)).toBe(false);
    });
});
