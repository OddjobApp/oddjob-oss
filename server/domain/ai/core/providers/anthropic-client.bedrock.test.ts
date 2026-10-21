/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicClient, bedrockTransport } from "./anthropic-client.js";

/**
 * Claude on Amazon Bedrock is the same Messages request on a different wire:
 * the model in the path, the version in the body, a Bedrock API key as bearer.
 */

const RUNTIME = "https://bedrock-runtime.us-east-2.amazonaws.com";
const reply = (body: object) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe("AnthropicClient over Bedrock", () => {
    it("invokes the model on the registry's runtime with a bearer key and Bedrock's API version", async () => {
        const fetchMock = vi.fn().mockResolvedValue(reply({
            content: [{ type: "text", text: "ok" }], usage: { input_tokens: 14, output_tokens: 4 }, stop_reason: "end_turn",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await new AnthropicClient(bedrockTransport(RUNTIME)).execute(
            { model: "us.anthropic.claude-sonnet-4-6", userPrompt: "hi", maxTokens: 5 } as any, undefined, "ABSKorganization-key-1234567890=");

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe(`${RUNTIME}/model/us.anthropic.claude-sonnet-4-6/invoke`);
        expect(options.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer ABSKorganization-key-1234567890=" });
        const body = JSON.parse(options.body);
        expect(body.anthropic_version).toBe("bedrock-2023-05-31");
        expect(body).not.toHaveProperty("model");
        expect(body.max_tokens).toBe(5);
        expect(body.messages[0].role).toBe("user");
        expect(result).toMatchObject({ success: true, output: "ok" });
        expect(result.metadata).toMatchObject({ provider: "bedrock", promptTokens: 14, completionTokens: 4 });
    });

    it("keeps the key out of the URL and encodes a versioned model ID into one path segment", async () => {
        const fetchMock = vi.fn().mockResolvedValue(reply({ content: [], usage: {} }));
        vi.stubGlobal("fetch", fetchMock);
        await new AnthropicClient(bedrockTransport(RUNTIME)).execute(
            { model: "anthropic.claude-3-5-sonnet-20240620-v1:0", userPrompt: "hi" } as any, undefined, "ABSKsecret-key-value-1234567890");
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toBe(`${RUNTIME}/model/anthropic.claude-3-5-sonnet-20240620-v1%3A0/invoke`);
        expect(url).not.toContain("ABSK");
    });

    it("returns tool calls the same way as the direct API", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({
            content: [{ type: "tool_use", name: "search", input: { q: "x" } }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "tool_use",
        })));
        const result = await new AnthropicClient(bedrockTransport(RUNTIME)).execute(
            { model: "us.anthropic.claude-sonnet-4-6", userPrompt: "find x", tools: [{ name: "search", description: "", parameters: { type: "object" } }] } as any,
            undefined, "ABSKorganization-key-1234567890=");
        expect(result.metadata?.toolCalls).toEqual([{ name: "search", args: { q: "x" } }]);
    });

    it("treats a Claude 5 model on Bedrock like Claude 5 on the direct API: no temperature", async () => {
        const fetchMock = vi.fn().mockResolvedValue(reply({ content: [], usage: {} }));
        vi.stubGlobal("fetch", fetchMock);
        await new AnthropicClient(bedrockTransport(RUNTIME)).execute(
            { model: "us.anthropic.claude-sonnet-5-5", userPrompt: "hi", temperature: 0.2 } as any, undefined, "ABSKorganization-key-1234567890=");
        await new AnthropicClient(bedrockTransport(RUNTIME)).execute(
            { model: "us.anthropic.claude-sonnet-4-6", userPrompt: "hi", temperature: 0.2 } as any, undefined, "ABSKorganization-key-1234567890=");
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("temperature");
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).temperature).toBe(0.2);
    });

    it("reports a Bedrock refusal as a failed call naming Bedrock", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '{"message":"not authorized"}' } as Response));
        const result = await new AnthropicClient(bedrockTransport(RUNTIME)).execute(
            { model: "us.anthropic.claude-sonnet-4-6", userPrompt: "hi" } as any, undefined, "ABSKorganization-key-1234567890=");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/^Amazon Bedrock API error \(403\)/);
        expect(result.metadata?.provider).toBe("bedrock");
    });

    it("answers a stream request in one chunk instead of parsing AWS event-stream framing", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ content: [{ type: "text", text: "whole answer" }], usage: {} })));
        const chunks: string[] = [];
        for await (const chunk of new AnthropicClient(bedrockTransport(RUNTIME)).executeStream(
            { model: "us.anthropic.claude-sonnet-4-6", userPrompt: "hi" } as any, undefined, "ABSKorganization-key-1234567890=")) chunks.push(chunk);
        expect(chunks).toEqual(["whole answer"]);
    });

    it("leaves the direct Anthropic API exactly as it was", async () => {
        const fetchMock = vi.fn().mockResolvedValue(reply({ content: [{ type: "text", text: "ok" }], usage: {} }));
        vi.stubGlobal("fetch", fetchMock);
        const result = await new AnthropicClient().execute({ model: "claude-sonnet-4-6", userPrompt: "hi" } as any, undefined, "sk-ant-key");
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe("https://api.anthropic.com/v1/messages");
        expect(options.headers).toEqual({ "Content-Type": "application/json", "x-api-key": "sk-ant-key", "anthropic-version": "2023-06-01" });
        expect(JSON.parse(options.body).model).toBe("claude-sonnet-4-6");
        expect(result.metadata?.provider).toBe("anthropic");
    });
});
