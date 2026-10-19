import { describe, it, expect, beforeEach, vi } from "vitest";
import { EphemeralVaultCacheService } from "../core/ephemeral-vault-cache.service.js";
import { ScribeVaultService } from "../core/scribe-vault.service.js";

// Ensure valid 32-byte hex encryption key for unit tests
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("CORE Vault Services", () => {
    describe("EphemeralVaultCacheService (In-Flight Caching)", () => {
        let cache: EphemeralVaultCacheService;

        beforeEach(() => {
            cache = new EphemeralVaultCacheService();
        });

        it("stores and retrieves in-flight token payloads correctly", async () => {
            const payload = {
                tokenId: "ODDJOB_MASK:8f2a1c9e",
                organizationId: 42,
                documentId: 101,
                nodeId: 5,
                classification: "adult" as const,
                mode: "static_reinsert" as const,
                summary: "Terrace encounter between Alice and Bob",
                rawPayload: "Intense dialogue on the terrace in the rain...",
                localModelHint: "llama3.1:8b",
                createdAt: Date.now(),
            };

            await cache.set(payload);
            const retrieved = await cache.get(42, 101, "ODDJOB_MASK:8f2a1c9e");

            expect(retrieved).not.toBeNull();
            expect(retrieved?.summary).toBe("Terrace encounter between Alice and Bob");
            expect(retrieved?.rawPayload).toBe("Intense dialogue on the terrace in the rain...");
            expect(retrieved?.classification).toBe("adult");
        });

        it("enforces tenant and document isolation in cache keys", async () => {
            const payloadOrg1 = {
                tokenId: "ODDJOB_MASK:unique_token",
                organizationId: 1,
                documentId: 100,
                classification: "confidential" as const,
                mode: "static_reinsert" as const,
                summary: "Secret Org 1",
                rawPayload: "Org 1 secret text",
                createdAt: Date.now(),
            };

            await cache.set(payloadOrg1);

            // Different Org should not find it
            const crossOrg = await cache.get(2, 100, "ODDJOB_MASK:unique_token");
            expect(crossOrg).toBeNull();

            // Different Document should not find it
            const crossDoc = await cache.get(1, 999, "ODDJOB_MASK:unique_token");
            expect(crossDoc).toBeNull();
        });

        it("deletes individual tokens", async () => {
            const payload = {
                tokenId: "ODDJOB_MASK:to_delete",
                organizationId: 1,
                documentId: 10,
                classification: "pii" as const,
                mode: "static_reinsert" as const,
                summary: "Social security number",
                rawPayload: "123-45-6789",
                createdAt: Date.now(),
            };

            await cache.set(payload);
            expect(await cache.get(1, 10, "ODDJOB_MASK:to_delete")).not.toBeNull();

            await cache.delete(1, 10, "ODDJOB_MASK:to_delete");
            expect(await cache.get(1, 10, "ODDJOB_MASK:to_delete")).toBeNull();
        });

        it("flushes all tokens for a document without affecting other documents", async () => {
            await cache.set({
                tokenId: "ODDJOB_MASK:doc1_t1",
                organizationId: 10,
                documentId: 1,
                classification: "ip" as const,
                mode: "static_reinsert" as const,
                summary: "Doc 1 Token 1",
                rawPayload: "Payload 1",
                createdAt: Date.now(),
            });

            await cache.set({
                tokenId: "ODDJOB_MASK:doc2_t1",
                organizationId: 10,
                documentId: 2,
                classification: "ip" as const,
                mode: "static_reinsert" as const,
                summary: "Doc 2 Token 1",
                rawPayload: "Payload 2",
                createdAt: Date.now(),
            });

            const flushed = await cache.flushForDocument(10, 1);
            expect(flushed).toBe(1);

            expect(await cache.get(10, 1, "ODDJOB_MASK:doc1_t1")).toBeNull();
            expect(await cache.get(10, 2, "ODDJOB_MASK:doc2_t1")).not.toBeNull();
        });

        it("respects expiration TTL", async () => {
            const payload = {
                tokenId: "ODDJOB_MASK:expires_fast",
                organizationId: 5,
                documentId: 50,
                classification: "forensic" as const,
                mode: "static_reinsert" as const,
                summary: "Expiring data",
                rawPayload: "Expiring text",
                createdAt: Date.now(),
            };

            // Set with negative TTL so it is already expired
            await cache.set(payload, -1);
            const retrieved = await cache.get(5, 50, "ODDJOB_MASK:expires_fast");
            expect(retrieved).toBeNull();
        });
    });

    describe("ScribeVaultService (Persistent Encrypted Storage)", () => {
        it("encrypts and decrypts payloads accurately", async () => {
            const { encrypt, decrypt } = await import("@server/utils/encryption.js");
            const rawText = "Highly sensitive scene: unredacted graphic details that must remain local.";

            const encrypted = encrypt(rawText);
            expect(encrypted).not.toContain("graphic details");
            expect(encrypted).toMatch(/^v3\.[0-9a-f]{8}\.u\.[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/); // v3.<key id>.unbound.iv.tag.ciphertext

            const decrypted = decrypt(encrypted);
            expect(decrypted).toBe(rawText);
        });
    });
});
