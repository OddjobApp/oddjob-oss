import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { markDegradation } from "./ai-degradation.js";
import { resolveOrgGeminiKey } from "./org-gemini-key.js";

/**
 * Amazon Titan Text Embeddings V2 on the organization's own Bedrock connection.
 * In-Region on-demand (no cross-Region profile), 1024 dimensions, normalized.
 */
export const TITAN_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0";
const TITAN_DIMENSIONS = 1024;
/** Titan V2 takes up to 8,192 tokens; ~5 characters per token leaves headroom. */
const TITAN_MAX_CHARS = 40_000;
const TITAN_CONCURRENCY = 4;

const NO_EMBEDDING_KEY =
    "Connect your organization's Gemini key or Amazon Bedrock key (Platform → AI Models) before indexing knowledge";

interface Embedder {
    embedQuery(text: string): Promise<number[]>;
    embedDocuments(texts: string[]): Promise<number[][]>;
}

async function titanEmbed(runtimeUrl: string, apiKey: string, text: string): Promise<number[]> {
    const response = await fetch(`${runtimeUrl}/model/${encodeURIComponent(TITAN_EMBEDDING_MODEL)}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ inputText: text.slice(0, TITAN_MAX_CHARS) || " ", dimensions: TITAN_DIMENSIONS, normalize: true }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`Amazon Bedrock embedding failed (HTTP ${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
    const body = await response.json() as { embedding?: number[] };
    if (!Array.isArray(body.embedding) || body.embedding.length === 0) {
        throw new Error("Amazon Bedrock returned no embedding");
    }
    return body.embedding;
}

function titanEmbedder(runtimeUrl: string, apiKey: string): Embedder {
    return {
        embedQuery: (text) => titanEmbed(runtimeUrl, apiKey, text),
        async embedDocuments(texts) {
            const out: number[][] = new Array(texts.length);
            let next = 0;
            const worker = async () => {
                while (next < texts.length) {
                    const i = next++;
                    out[i] = await titanEmbed(runtimeUrl, apiKey, texts[i]);
                }
            };
            await Promise.all(Array.from({ length: Math.min(TITAN_CONCURRENCY, texts.length) }, worker));
            return out;
        },
    };
}

/**
 * The organization's embedder: Gemini when it has a Gemini key (unchanged, so an
 * index built with Gemini stays one vector space), otherwise Titan on its own
 * Amazon Bedrock connection. No platform key either way.
 */
async function resolveEmbedder(model: string): Promise<Embedder> {
    const geminiKey = await resolveOrgGeminiKey(null);
    if (geminiKey) return new GoogleGenerativeAIEmbeddings({ apiKey: geminiKey, model, maxRetries: 0 });

    const { resolveAiOrganization } = await import("./ai-org-context.js");
    const orgId = await resolveAiOrganization(null);
    if (orgId !== null) {
        const { orgModelService } = await import("./org-model.service.js");
        const bedrock = await orgModelService.resolve(orgId, "bedrock");
        if (bedrock?.apiKey && bedrock.baseUrl) return titanEmbedder(bedrock.baseUrl, bedrock.apiKey);
    }
    throw new Error(NO_EMBEDDING_KEY);
}

/**
 * Collections are sized for the largest embedding (QDRANT_VECTOR_SIZE, 3072):
 * a longer vector is truncated, a shorter one (Titan's 1024) is zero-padded.
 * Zero padding leaves cosine similarity between two padded vectors unchanged.
 */
export function fitToCollection(vector: number[], size = Number(process.env.QDRANT_VECTOR_SIZE || 3072)): number[] {
    if (vector.length >= size) return vector.slice(0, size);
    return vector.concat(new Array(size - vector.length).fill(0));
}

/** No singleton key or shared response cache: resolve ownership at each request. */
export function organizationEmbeddings(model = process.env.RAG_EMBEDDING_MODEL || "gemini-embedding-001") {
    // Quota failures propagate to the caller unchanged — but a caller that
    // swallows them into "no results" must still be able to see that retrieval
    // is degraded, so mark before rethrowing.
    const marked = <T>(op: () => Promise<T>): Promise<T> =>
        op().catch((err) => {
            markDegradation("embeddings", String(err?.message ?? err).slice(0, 200));
            throw err;
        });
    return {
        embedQuery: async (text: string) =>
            marked(() => resolveEmbedder(model).then((e) => e.embedQuery(text))).then((v) => fitToCollection(v)),
        embedDocuments: async (texts: string[]) =>
            marked(() => resolveEmbedder(model).then((e) => e.embedDocuments(texts))).then((vs) => vs.map((v) => fitToCollection(v))),
    };
}
