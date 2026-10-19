import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import { DiscordAdapter } from "./discord.adapter.js";

/**
 * Discord's Ed25519 check used to `return true` unconditionally — including
 * when DISCORD_PUBLIC_KEY was set, so an operator who configured the key got
 * no verification and no indication of that. These tests sign with a real
 * keypair, so a regression to "treat as valid" fails here rather than in
 * production.
 */

/** A real Ed25519 keypair, with the public half in the hex form Discord gives. */
function keypair() {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    // RFC 8410 SPKI for Ed25519 is a fixed 12-byte prefix then the raw 32 bytes.
    const raw = spki.subarray(spki.length - 32);
    return { privateKey, publicKeyHex: raw.toString("hex") };
}

function signed(privateKey: any, timestamp: string, body: string) {
    return cryptoSign(
        null,
        Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(body, "utf8")]),
        privateKey,
    ).toString("hex");
}

describe("DiscordAdapter.verifyWebhook", () => {
    const timestamp = "1735689600";
    const body = JSON.stringify({ type: 2, data: { name: "status" } });

    it("accepts a correctly signed interaction", () => {
        const { privateKey, publicKeyHex } = keypair();
        const adapter = new DiscordAdapter("bot-token", publicKeyHex, "app-id");

        expect(
            adapter.verifyWebhook(
                {
                    "x-signature-ed25519": signed(privateKey, timestamp, body),
                    "x-signature-timestamp": timestamp,
                },
                body,
            ),
        ).toBe(true);
    });

    it("rejects a body that was altered after signing", () => {
        const { privateKey, publicKeyHex } = keypair();
        const adapter = new DiscordAdapter("bot-token", publicKeyHex, "app-id");
        const signature = signed(privateKey, timestamp, body);

        expect(() =>
            adapter.verifyWebhook(
                { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
                JSON.stringify({ type: 2, data: { name: "deploy-production" } }),
            ),
        ).toThrow(/verification failed/i);
    });

    it("rejects a replayed signature under a different timestamp", () => {
        // The timestamp is inside the signed payload, so changing it must break
        // the signature — that is what makes the header worth sending.
        const { privateKey, publicKeyHex } = keypair();
        const adapter = new DiscordAdapter("bot-token", publicKeyHex, "app-id");

        expect(() =>
            adapter.verifyWebhook(
                {
                    "x-signature-ed25519": signed(privateKey, timestamp, body),
                    "x-signature-timestamp": "1735689999",
                },
                body,
            ),
        ).toThrow(/verification failed/i);
    });

    it("rejects a signature made by a different key", () => {
        const victim = keypair();
        const attacker = keypair();
        const adapter = new DiscordAdapter("bot-token", victim.publicKeyHex, "app-id");

        expect(() =>
            adapter.verifyWebhook(
                {
                    "x-signature-ed25519": signed(attacker.privateKey, timestamp, body),
                    "x-signature-timestamp": timestamp,
                },
                body,
            ),
        ).toThrow(/verification failed/i);
    });

    it("rejects rather than passes when the configured key is malformed", () => {
        const adapter = new DiscordAdapter("bot-token", "not-a-valid-hex-key", "app-id");

        expect(() =>
            adapter.verifyWebhook(
                { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": timestamp },
                body,
            ),
        ).toThrow(/verification failed/i);
    });

    it("rejects a malformed signature", () => {
        const { publicKeyHex } = keypair();
        const adapter = new DiscordAdapter("bot-token", publicKeyHex, "app-id");

        expect(() =>
            adapter.verifyWebhook(
                { "x-signature-ed25519": "abcd", "x-signature-timestamp": timestamp },
                body,
            ),
        ).toThrow(/verification failed/i);
    });

    it("still refuses a request with no signature headers", () => {
        const { publicKeyHex } = keypair();
        const adapter = new DiscordAdapter("bot-token", publicKeyHex, "app-id");

        expect(() => adapter.verifyWebhook({}, body)).toThrow(/Missing Ed25519 signature headers/i);
    });

    it("passes unverified only when no public key is configured", () => {
        // Documents the one remaining permissive path: with no key there is
        // nothing to verify against. It is logged as NOT verified.
        const adapter = new DiscordAdapter("bot-token", "", "app-id");

        expect(
            adapter.verifyWebhook(
                { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": timestamp },
                body,
            ),
        ).toBe(true);
    });
});
