import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), execute: vi.fn(), spend: vi.fn(),
    anthropic: vi.fn(), anthropicTransports: [] as unknown[], openai: vi.fn(), openaiMetadata: [] as unknown[] }));
vi.mock("./org-model.service.js", () => ({ orgModelService: { resolve: mocks.resolve } }));
vi.mock("./providers/google-client.js", () => ({ GoogleClient: class { execute = mocks.execute; } }));
vi.mock("./providers/anthropic-client.js", () => ({
    AnthropicClient: class { constructor(transport?: unknown) { mocks.anthropicTransports.push(transport); } execute = mocks.anthropic; },
    bedrockTransport: (runtimeUrl: string) => ({ provider: "bedrock", runtimeUrl }),
}));
vi.mock("./providers/openai-client.js", () => ({ OpenAIClient: class {
    constructor(metadata: unknown) { mocks.openaiMetadata.push(metadata); }
    execute = mocks.openai;
} }));
vi.mock("@domain/system/system-config.service.js", () => ({ systemConfigService: { trackSpend: mocks.spend } }));
import { OrganizationAIClient } from "./organization-ai-client.js";
import { withAiOrganization } from "./ai-org-context.js";

describe("BYOK execution boundary", () => {
    afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
    it("isolates concurrent organizations and ignores supplied platform keys", async () => {
        mocks.resolve.mockImplementation(async id => ({ provider: "google", apiKey: `org-${id}`, model: "gemini-2.5-flash" }));
        mocks.spend.mockResolvedValue({ allowed: true });
        mocks.execute.mockResolvedValue({ success: true, output: "done" });
        const legacy = vi.fn();
        const client = new OrganizationAIClient(legacy);
        await Promise.all([7, 8].map(id => withAiOrganization(async () => id,
            () => client.execute({ model: "other", useCache: true } as any, "hello", "platform-key"))));
        expect(mocks.execute.mock.calls.map(call => call[2]).sort()).toEqual(["org-7", "org-8"]);
        expect(mocks.execute.mock.calls.map(call => call[0].organizationId).sort()).toEqual([7, 8]);
        expect(mocks.execute.mock.calls.every(call => call[0].useCache === false)).toBe(true);
        expect(legacy).not.toHaveBeenCalled();
    });
    it("rejects an explicit organization different from the authenticated scope", async () => {
        const client = new OrganizationAIClient(vi.fn());
        await expect(withAiOrganization(async () => 7,
            () => client.execute({ organizationId: 8 } as any, "hello", "key"))).rejects.toThrow("does not match");
        expect(mocks.resolve).not.toHaveBeenCalled();
    });
    it("resolves keys anew and stops after disconnect, even when caching was requested", async () => {
        vi.stubEnv("NODE_ENV", "production");
        mocks.resolve.mockResolvedValueOnce({ provider: "google", apiKey: "old", model: "gemini-2.5-flash" })
            .mockResolvedValueOnce({ provider: "google", apiKey: "new", model: "gemini-2.5-flash" }).mockResolvedValueOnce(null);
        mocks.spend.mockResolvedValue({ allowed: true });
        mocks.execute.mockResolvedValue({ success: true, output: "done" });
        const client = new OrganizationAIClient(vi.fn());
        await withAiOrganization(async () => 7, async () => {
            await client.execute({} as any, "hello", "");
            await client.execute({} as any, "hello", "");
            await expect(client.execute({} as any, "hello", "")).rejects.toThrow("Connect your organization");
        });
        expect(mocks.execute.mock.calls.map(call => call[2])).toEqual(["old", "new"]);
    });
    it("fails closed on absent production scope and exhausted budgets", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const client = new OrganizationAIClient(vi.fn());
        await expect(client.execute({} as any, "hello", "key")).rejects.toThrow("Organization context");
        mocks.resolve.mockResolvedValue({ provider: "google", apiKey: "key", model: "gemini-2.5-flash" });
        mocks.spend.mockResolvedValue({ allowed: false, reason: "monthly budget exceeded" });
        await expect(client.execute({ organizationId: 7 } as any, "hello", "key")).rejects.toThrow("budget");
        expect(mocks.execute).not.toHaveBeenCalled();
    });
    it("runs a Bedrock connection on the Anthropic client over its own Region's runtime", async () => {
        mocks.spend.mockResolvedValue({ allowed: true });
        mocks.anthropic.mockResolvedValue({ success: true, output: "claude via bedrock" });
        mocks.anthropicTransports.length = 0;
        mocks.resolve.mockResolvedValue({ provider: "bedrock", apiKey: "ABSK-org-key", model: "us.anthropic.claude-sonnet-4-6",
            baseUrl: "https://bedrock-runtime.us-east-2.amazonaws.com" });
        const client = new OrganizationAIClient(vi.fn());
        await withAiOrganization(async () => 7, () => client.execute(
            { model: "gemini-2.5-flash", baseUrl: "https://attacker.example", useCache: true } as any, "hi", "platform-key"));
        // The endpoint is the connection's, never the call's.
        expect(mocks.anthropicTransports.at(-1)).toEqual({ provider: "bedrock", runtimeUrl: "https://bedrock-runtime.us-east-2.amazonaws.com" });
        expect(mocks.anthropic.mock.calls[0][0]).toMatchObject({ model: "us.anthropic.claude-sonnet-4-6", provider: "bedrock", baseUrl: undefined, useCache: false });
        expect(mocks.anthropic.mock.calls[0][2]).toBe("ABSK-org-key");
        expect(mocks.execute).not.toHaveBeenCalled();
    });
    it("runs each provider on its own client, endpoint and model, whatever the call asked for", async () => {
        mocks.spend.mockResolvedValue({ allowed: true });
        mocks.anthropic.mockResolvedValue({ success: true, output: "claude" });
        mocks.openai.mockResolvedValue({ success: true, output: "compat", metadata: { promptTokens: 3, completionTokens: 2 } });
        mocks.openaiMetadata.length = 0;
        const client = new OrganizationAIClient(vi.fn());
        const asked = { model: "gemini-2.5-flash", baseUrl: "https://attacker.example/v1", useCache: true } as any;

        mocks.resolve.mockResolvedValue({ provider: "anthropic", apiKey: "ant-key", model: "claude-sonnet-5-5" });
        await withAiOrganization(async () => 7, () => client.execute(asked, "hi", "platform-key"));
        expect(mocks.anthropic.mock.calls[0][0]).toMatchObject({ model: "claude-sonnet-5-5", provider: "anthropic", baseUrl: undefined, useCache: false });
        expect(mocks.anthropic.mock.calls[0][2]).toBe("ant-key");

        mocks.resolve.mockResolvedValue({ provider: "xai", apiKey: "xai-key", model: "grok-4", baseUrl: "https://api.x.ai/v1" });
        await withAiOrganization(async () => 7, () => client.execute(asked, "hi", "platform-key"));
        expect(mocks.openaiMetadata.at(-1)).toEqual({ baseUrl: "https://api.x.ai/v1" });
        expect(mocks.openai.mock.calls[0][0]).toMatchObject({ model: "grok-4", baseUrl: "https://api.x.ai/v1" });
        expect(mocks.openai.mock.calls[0][2]).toBe("xai-key");
        expect(mocks.execute).not.toHaveBeenCalled();
        expect(mocks.spend.mock.calls.at(-1)![3]).toMatchObject({ provider: "xai", model: "grok-4" });
    });
});
