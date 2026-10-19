import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { markDegradation } from "./ai-degradation.js";
import { resolveOrgGeminiKey } from "./org-gemini-key.js";

/** No singleton key or shared response cache: resolve ownership at each request. */
export function organizationEmbeddings(model = process.env.RAG_EMBEDDING_MODEL || "gemini-embedding-001") {
    const client = async () => {
        const apiKey = await resolveOrgGeminiKey(null);
        if (!apiKey) throw new Error("Connect your organization's Gemini key before indexing knowledge");
        return new GoogleGenerativeAIEmbeddings({ apiKey, model, maxRetries: 0 });
    };
    const trim = (vector: number[]) => vector.slice(0, Number(process.env.QDRANT_VECTOR_SIZE || 3072));
    // Quota failures propagate to the caller unchanged — but a caller that
    // swallows them into "no results" must still be able to see that retrieval
    // is degraded, so mark before rethrowing.
    const marked = <T>(op: () => Promise<T>): Promise<T> =>
        op().catch((err) => {
            markDegradation("embeddings", String(err?.message ?? err).slice(0, 200));
            throw err;
        });
    return {
        embedQuery: async (text: string) => marked(() => client().then((c) => c.embedQuery(text))).then(trim),
        embedDocuments: async (texts: string[]) => marked(() => client().then((c) => c.embedDocuments(texts))).then((v) => v.map(trim)),
    };
}
