/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Knowledge is embedded on the organization's own key: Gemini when it has one,
 * otherwise Amazon Titan on its Bedrock connection. An organization whose only
 * AI is Bedrock could not index anything before.
 */
const mocks = vi.hoisted(() => ({ geminiKey: vi.fn(), org: vi.fn(), resolve: vi.fn(), geminiEmbed: vi.fn() }));
vi.mock("./org-gemini-key.js", () => ({ resolveOrgGeminiKey: mocks.geminiKey }));
vi.mock("./ai-org-context.js", () => ({ resolveAiOrganization: mocks.org }));
vi.mock("./org-model.service.js", () => ({ orgModelService: { resolve: mocks.resolve } }));
vi.mock("./ai-degradation.js", () => ({ markDegradation: vi.fn() }));
vi.mock("@langchain/google-genai", () => ({
    GoogleGenerativeAIEmbeddings: class {
        embedQuery = mocks.geminiEmbed;
        embedDocuments = async (t: string[]) => Promise.all(t.map((x) => mocks.geminiEmbed(x)));
    },
}));
import { fitToCollection, organizationEmbeddings, TITAN_EMBEDDING_MODEL } from "./org-embeddings.js";

const RUNTIME = "https://bedrock-runtime.us-east-2.amazonaws.com";
const titanReply = (seed: number) => new Response(JSON.stringify({ embedding: Array.from({ length: 1024 }, (_, i) => (i === 0 ? seed : 0.01)) }));

describe("organization embeddings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.geminiKey.mockResolvedValue(null);
        mocks.org.mockResolvedValue(7);
        mocks.resolve.mockResolvedValue({ provider: "bedrock", apiKey: "ABSK-org-key", model: "us.anthropic.claude-sonnet-4-6", baseUrl: RUNTIME });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("embeds with Titan on the organization's Bedrock connection when it has no Gemini key", async () => {
        const fetchMock = vi.fn(async () => titanReply(0.5));
        vi.stubGlobal("fetch", fetchMock);
        const vector = await organizationEmbeddings().embedQuery("agile business case");
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`${RUNTIME}/model/${encodeURIComponent(TITAN_EMBEDDING_MODEL)}/invoke`);
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ABSK-org-key");
        expect(JSON.parse(String(init.body))).toEqual({ inputText: "agile business case", dimensions: 1024, normalize: true });
        expect(mocks.resolve).toHaveBeenCalledWith(7, "bedrock");
        // Zero-padded to the collection size.
        expect(vector).toHaveLength(3072);
        expect(vector[0]).toBe(0.5);
        expect(vector.slice(1024).every((x) => x === 0)).toBe(true);
    });

    it("embeds many documents, each in order", async () => {
        let n = 0;
        vi.stubGlobal("fetch", vi.fn(async () => titanReply(++n)));
        const vectors = await organizationEmbeddings().embedDocuments(["a", "b", "c", "d", "e"]);
        expect(vectors).toHaveLength(5);
        expect(new Set(vectors.map((v) => v[0])).size).toBe(5);
    });

    it("keeps Gemini when the organization has a Gemini key, so one index stays one vector space", async () => {
        mocks.geminiKey.mockResolvedValue("gemini-key");
        mocks.geminiEmbed.mockResolvedValue(Array.from({ length: 3072 }, () => 0.1));
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect(await organizationEmbeddings().embedQuery("x")).toHaveLength(3072);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it("names both options when the organization has neither key", async () => {
        mocks.resolve.mockResolvedValue(null);
        await expect(organizationEmbeddings().embedQuery("x")).rejects.toThrow("Gemini key or Amazon Bedrock key");
    });

    it("reports a Bedrock refusal instead of an empty vector", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"AccessDenied"}', { status: 403 })));
        await expect(organizationEmbeddings().embedQuery("x")).rejects.toThrow("HTTP 403");
    });

    it("fits vectors to the collection: pads short ones, truncates long ones", () => {
        expect(fitToCollection([1, 2], 4)).toEqual([1, 2, 0, 0]);
        expect(fitToCollection([1, 2, 3, 4, 5], 4)).toEqual([1, 2, 3, 4]);
    });
});
