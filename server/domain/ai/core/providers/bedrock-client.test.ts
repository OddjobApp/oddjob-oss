import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../ai-client.service.js", () => ({
    fetchWithRetry: (url: string, options: RequestInit) => fetch(url, options),
    fetchImageAsBase64: async (url: string) => {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        return { mimeType: match![1], data: match![2] };
    },
}));
import { BedrockClient } from "./bedrock-client.js";

const endpoint = "https://bedrock-runtime.us-east-2.amazonaws.com";
const converseReply = (content: unknown[], usage = { inputTokens: 11, outputTokens: 4, totalTokens: 15 }) =>
    ({ ok: true, json: async () => ({ output: { message: { role: "assistant", content } }, stopReason: "end_turn", usage }) }) as Response;
const sent = () => {
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    return { url, headers: options?.headers as Record<string, string>, body: JSON.parse(String(options?.body)) };
};

describe("BedrockClient (Converse with a Bedrock API key)", () => {
    beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(converseReply([{ text: "hello" }]))); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it("posts to the model's Converse route with the key as a bearer token, and reports usage", async () => {
        const result = await new BedrockClient(endpoint).execute({ model: "amazon.nova-lite-v1:0", systemPrompt: "Be brief",
            userPrompt: "Hi", temperature: 0.1, maxTokens: 200 } as any, undefined, "ABSK-org-key");
        const { url, headers, body } = sent();
        expect(url).toBe(`${endpoint}/model/amazon.nova-lite-v1%3A0/converse`);
        expect(headers.Authorization).toBe("Bearer ABSK-org-key");
        expect(body).toEqual({ messages: [{ role: "user", content: [{ text: "Hi" }] }], system: [{ text: "Be brief" }],
            inferenceConfig: { maxTokens: 200, temperature: 0.1 } });
        expect(result).toMatchObject({ success: true, output: "hello",
            metadata: { provider: "bedrock", promptTokens: 11, completionTokens: 4, tokensUsed: 15 } });
    });

    it("omits temperature for Claude 5-generation inference profiles and strips JSON fences", async () => {
        vi.mocked(fetch).mockResolvedValue(converseReply([{ text: "```json\n{\"nodes\":[]}\n```" }]));
        const result = await new BedrockClient(endpoint).execute({ model: "anthropic.claude-sonnet-5-5", userPrompt: "x",
            requestType: "json", temperature: 0.1 } as any, undefined, "ABSK-org-key");
        expect(sent().body.inferenceConfig).toEqual({ maxTokens: 1024 });
        expect(sent().body.system[0].text).toContain("ONLY a single valid JSON object");
        expect(result.output).toBe('{"nodes":[]}');
    });

    it("sends images as bytes, merges same-role turns, and returns tool calls", async () => {
        vi.mocked(fetch).mockResolvedValue(converseReply([{ toolUse: { toolUseId: "t1", name: "lookup", input: { q: "a" } } }]));
        const client = new BedrockClient(endpoint);
        await client.execute({ model: "amazon.nova-lite-v1:0", userPrompt: "Describe",
            attachments: [{ type: "image_url", url: "data:image/png;base64,iVBORw0KGgo=" }] } as any, undefined, "k");
        expect(sent().body.messages[0].content[1]).toEqual({ image: { format: "png", source: { bytes: "iVBORw0KGgo=" } } });

        vi.mocked(fetch).mockClear();
        const result = await client.execute({ model: "amazon.nova-lite-v1:0",
            messages: [{ role: "system", content: "sys" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "model", content: "" }],
            tools: [{ name: "lookup", description: "Find", parameters: { type: "object", properties: { q: { type: "string" } } } }] } as any, undefined, "k");
        const { body } = sent();
        expect(body.system).toEqual([{ text: "sys" }]);
        expect(body.messages).toEqual([{ role: "user", content: [{ text: "a" }, { text: "b" }] }]);
        expect(body.toolConfig.tools[0].toolSpec).toMatchObject({ name: "lookup", inputSchema: { json: { type: "object" } } });
        expect(result.metadata?.toolCalls).toEqual([{ name: "lookup", args: { q: "a" } }]);
    });

    it("fails without calling AWS when the connection has no region or key, and surfaces API errors", async () => {
        expect((await new BedrockClient(undefined).execute({ model: "m" } as any, undefined, "k")).error).toContain("region");
        expect((await new BedrockClient(endpoint).execute({ model: "m" } as any, undefined, "")).error).toContain("API key");
        expect(fetch).not.toHaveBeenCalled();
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, text: async () => "denied" } as Response);
        const result = await new BedrockClient(endpoint).execute({ model: "m", userPrompt: "x" } as any, undefined, "k");
        expect(result).toMatchObject({ success: false, error: "Amazon Bedrock API error (403): denied" });
    });
});
