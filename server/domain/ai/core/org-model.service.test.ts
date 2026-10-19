import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ rows: [] as any[], where: vi.fn(), insert: vi.fn(), transaction: vi.fn(), update: vi.fn(), txUpdate: vi.fn() }));
vi.mock("@server/database_service.js", () => {
    const tx = {
        select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: 7 }] }) }) }),
        delete: () => ({ where: mocks.where }),
        insert: () => ({ values: mocks.insert }),
        update: () => ({ set: (values: any) => ({ where: async () => { mocks.txUpdate(values); } }) }),
    };
    return { db: {
        select: () => ({ from: () => ({ where: (scope: any) => {
            mocks.where(scope);
            // Filter by the credential type the scope names, as Postgres would.
            const params = new PgDialect().sqlToQuery(scope).params;
            const rows = mocks.rows.map(row => ({ credentialType: "gemini", ...row }))
                .filter(row => params.includes(row.credentialType));
            return { limit: async () => rows };
        } }) }),
        transaction: (work: any) => { mocks.transaction(); return work(tx); },
        delete: () => ({ where: mocks.where }),
        update: () => ({ set: (values: any) => ({ where: async () => { mocks.update(values); } }) }),
    } };
});
import { orgModelService } from "./org-model.service.js";
import { decrypt, encrypt, isOwnerBound } from "@server/utils/encryption.js";

describe("organization Gemini connections", () => {
    const apiKey = "organization-key-1234567890";
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.rows = [];
        vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true,
            json: async () => ({ supportedGenerationMethods: ["generateContent"] }) }));
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    it("validates using a header, persists ciphertext, and returns no secret", async () => {
        const result = await orgModelService.save(7, { apiKey, model: "gemini-2.5-flash" });
        expect(JSON.stringify(result)).not.toContain(apiKey);
        const [url, options] = vi.mocked(fetch).mock.calls[0];
        expect(url).not.toContain(apiKey);
        expect(options?.headers).toEqual({ "x-goog-api-key": apiKey });
        const stored = mocks.insert.mock.calls[0][0];
        expect(stored.organizationId).toBe(7);
        expect(stored.encryptedData).not.toContain(apiKey);
        expect(isOwnerBound(stored.encryptedData)).toBe(true);
        expect(JSON.parse(decrypt(stored.encryptedData, "organization_ai:7:gemini"))).toEqual({ apiKey, model: "gemini-2.5-flash", isDefault: true });
        expect(result.keyHint).toBe("…7890");
        expect(mocks.transaction).toHaveBeenCalledOnce();
    });

    it("does not overwrite a working connection when Google rejects the new key", async () => {
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
        await expect(orgModelService.save(7, { apiKey, model: "gemini-2.5-flash" })).rejects.toThrow("HTTP 403");
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("scopes reads and deletion to the organization and returns only public status", async () => {
        mocks.rows = [{ id: 1, encryptedData: encrypt(JSON.stringify({ apiKey, model: "gemini-2.5-flash" }), "organization_ai:7:gemini") }];
        expect(await orgModelService.status(7)).toEqual({ configured: true, provider: "google", model: "gemini-2.5-flash", keyHint: "…7890",
            connections: [{ provider: "google", model: "gemini-2.5-flash", region: null, keyHint: "…7890", isDefault: true }] });
        await orgModelService.remove(7);
        for (const [scope] of mocks.where.mock.calls) {
            const query = new PgDialect().sqlToQuery(scope);
            expect(query.sql).toContain('"organization_id"');
            expect(query.params.slice(0, 3)).toEqual([7, "organization_ai", 7]);
        }
        const removed = new PgDialect().sqlToQuery(mocks.where.mock.calls.at(-1)![0]);
        expect(removed.params).toEqual([7, "organization_ai", 7, "gemini"]);
    });

    it("refuses a key sealed to another organization", async () => {
        // A row moved into org 7's slot from org 8 must not hand org 7 org 8's key.
        mocks.rows = [{ id: 1, encryptedData: encrypt(JSON.stringify({ apiKey, model: "gemini-2.5-flash" }), "organization_ai:8:gemini") }];
        await expect(orgModelService.resolve(7)).rejects.toThrow();
    });

    it("re-seals a key stored before owner binding and still serves it", async () => {
        const legacy = encrypt(JSON.stringify({ apiKey, model: "gemini-2.5-flash" }));
        mocks.rows = [{ id: 1, encryptedData: legacy }];
        const connection = await orgModelService.resolve(7);
        expect(connection?.apiKey).toBe(apiKey);
        const [{ encryptedData }] = mocks.update.mock.calls[0];
        expect(isOwnerBound(encryptedData)).toBe(true);
        expect(JSON.parse(decrypt(encryptedData, "organization_ai:7:gemini")).apiKey).toBe(apiKey);
    });

    it("does not re-seal a key that is already bound", async () => {
        mocks.rows = [{ id: 1, encryptedData: encrypt(JSON.stringify({ apiKey, model: "gemini-2.5-flash" }), "organization_ai:7:gemini") }];
        await orgModelService.resolve(7);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it("does not fall back when storage cannot be decrypted", async () => {
        mocks.rows = [{ encryptedData: "invalid" }];
        await expect(orgModelService.resolve(7)).rejects.toThrow();
    });

    it("rejects missing scope and URL-shaped model input before contacting Google", async () => {
        await expect(orgModelService.resolve(0)).rejects.toThrow("organization");
        await expect(orgModelService.save(7, { apiKey, model: "../other?key=x" })).rejects.toThrow("valid Google Gemini");
        expect(fetch).not.toHaveBeenCalled();
    });

    describe("several providers, one default", () => {
        const seal = (provider: string, data: object) =>
            ({ id: provider.length, credentialType: provider, encryptedData: encrypt(JSON.stringify(data), `organization_ai:7:${provider}`) });

        it("validates OpenAI-compatible keys on the provider's fixed endpoint with a bearer header", async () => {
            vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "grok-4" }] }) } as Response);
            const result = await orgModelService.save(7, { provider: "xai", apiKey: "xai-organization-key-12345", model: "grok-4" });
            const [url, options] = vi.mocked(fetch).mock.calls[0];
            expect(url).toBe("https://api.x.ai/v1/models");
            expect(options?.headers).toEqual({ Authorization: "Bearer xai-organization-key-12345" });
            const stored = mocks.insert.mock.calls[0][0];
            expect(stored.credentialType).toBe("xai");
            expect(JSON.parse(decrypt(stored.encryptedData, "organization_ai:7:xai")))
                .toEqual({ apiKey: "xai-organization-key-12345", model: "grok-4", isDefault: true });
            expect(JSON.stringify(result)).not.toContain("xai-organization-key-12345");
        });

        it("refuses a model the provider does not list for the key", async () => {
            vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "gpt-5" }] }) } as Response);
            await expect(orgModelService.save(7, { provider: "openai", apiKey: "sk-organization-key-123456", model: "gpt-9" }))
                .rejects.toThrow('does not offer the model "gpt-9"');
            expect(mocks.transaction).not.toHaveBeenCalled();
        });

        it("checks Anthropic keys against the model with the API version header", async () => {
            await orgModelService.save(7, { provider: "anthropic", apiKey: "sk-ant-organization-key-1234", model: "claude-sonnet-5-5" });
            const [url, options] = vi.mocked(fetch).mock.calls[0];
            expect(url).toBe("https://api.anthropic.com/v1/models/claude-sonnet-5-5");
            expect(options?.headers).toEqual({ "x-api-key": "sk-ant-organization-key-1234", "anthropic-version": "2023-06-01" });
        });

        it("stores the chosen Qwen region and never accepts a URL", async () => {
            vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
            await orgModelService.save(7, { provider: "qwen", apiKey: "sk-qwen-organization-key-1", model: "qwen-plus", region: "cn" });
            expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
            await orgModelService.save(7, { provider: "qwen", apiKey: "sk-qwen-organization-key-1", model: "qwen-plus", region: "https://evil.example" });
            expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models");
            await expect(orgModelService.save(7, { provider: "https://evil.example", apiKey, model: "x" })).rejects.toThrow("valid API key");
        });

        it("keeps Gemini the default when a second provider is added, and resolves either by name", async () => {
            mocks.rows = [seal("gemini", { apiKey, model: "gemini-2.5-flash" }),
                seal("anthropic", { apiKey: "sk-ant-organization-key-1234", model: "claude-sonnet-5-5" })];
            expect((await orgModelService.resolve(7))?.provider).toBe("google");
            expect(await orgModelService.resolve(7, "anthropic")).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", baseUrl: undefined });
            expect(await orgModelService.resolve(7, "xai")).toBeNull();
        });

        it("follows the flagged default, and moves the flag when the default changes", async () => {
            mocks.rows = [seal("gemini", { apiKey, model: "gemini-2.5-flash", isDefault: true }),
                seal("qwen", { apiKey: "sk-qwen-organization-key-1", model: "qwen-plus", region: "cn" })];
            expect((await orgModelService.resolve(7))?.provider).toBe("google");
            await orgModelService.setDefault(7, "qwen");
            const unflagged = JSON.parse(decrypt(mocks.txUpdate.mock.calls[0][0].encryptedData, "organization_ai:7:gemini"));
            expect(unflagged).toEqual({ apiKey, model: "gemini-2.5-flash" });
            const flagged = JSON.parse(decrypt(mocks.insert.mock.calls[0][0].encryptedData, "organization_ai:7:qwen"));
            expect(flagged).toEqual({ apiKey: "sk-qwen-organization-key-1", model: "qwen-plus", region: "cn", isDefault: true });

            mocks.rows = [seal("gemini", { apiKey, model: "gemini-2.5-flash" }),
                seal("qwen", { apiKey: "sk-qwen-organization-key-1", model: "qwen-plus", region: "cn", isDefault: true })];
            expect(await orgModelService.resolve(7)).toMatchObject({ provider: "qwen",
                baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" });
        });

        it("will not make a provider the default before it is connected", async () => {
            await expect(orgModelService.setDefault(7, "muse")).rejects.toThrow("Connect Meta Muse");
            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it("refuses a key sealed to another provider's slot", async () => {
            mocks.rows = [{ id: 1, credentialType: "openai",
                encryptedData: encrypt(JSON.stringify({ apiKey, model: "gpt-5" }), "organization_ai:7:anthropic") }];
            await expect(orgModelService.resolve(7, "openai")).rejects.toThrow();
        });
    });
});
