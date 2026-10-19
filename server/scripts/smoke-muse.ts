/**
 * Live check that the Meta Model API endpoint answers through the
 * OpenAI-compatible client — no DB writes, no org config:
 *
 *   npx tsx server/scripts/smoke-muse.ts
 *
 * Verifies: (1) MODEL_API_KEY auth against api.meta.ai, (2) chat completions,
 * (3) streaming, (4) json_object response_format, and (5) native tool calls.
 * To run Muse traffic through the router instead, seed it as a real
 * llm_providers/llm_models row — the env override path was removed.
 */
import "dotenv/config";
import { OpenAIClient } from "../domain/ai/core/providers/openai-client.js";

const baseConfig = {
    systemPrompt: "",
    temperature: 0,
    requestType: "text" as const,
    useCache: false,
};

async function main() {
    const apiKey = process.env.MODEL_API_KEY;
    if (!apiKey) throw new Error("MODEL_API_KEY unset in .env");
    const baseUrl = process.env.MUSE_BASE_URL || "https://api.meta.ai/v1";
    const model = process.env.MUSE_MODEL || "muse-spark-1.3";
    console.log(`muse → model=${model} baseUrl=${baseUrl}`);

    const client = new OpenAIClient({ baseUrl });

    const res = await client.execute(
        { ...baseConfig, model, userPrompt: "Reply with exactly: muse ok" } as any,
        undefined, apiKey,
    );
    console.log(`execute: ${res.success ? JSON.stringify(res.output) : `FAIL ${res.error}`}`);
    console.log(`  meta: model=${res.metadata?.model} tokens=${res.metadata?.tokensUsed} latency=${res.metadata?.latencyMs}ms`);
    if (!res.success) process.exitCode = 1;

    let acc = "";
    if (client.executeStream) {
        for await (const chunk of client.executeStream(
            { ...baseConfig, model, userPrompt: "Reply with exactly: stream ok" } as any,
            undefined, apiKey,
        )) acc += chunk;
    }
    console.log(`stream: ${JSON.stringify(acc) || "FAIL (no output)"}`);
    if (!acc) process.exitCode = 1;

    const json = await client.execute(
        { ...baseConfig, model, requestType: "json", userPrompt: 'Reply with JSON only: {"ok": true}' } as any,
        undefined, apiKey,
    );
    console.log(`json mode: ${json.success ? json.output : `FAIL ${json.error}`}`);
    if (!json.success) process.exitCode = 1;

    // Native function calling — the channel CREW depends on. The declaration
    // shape matches what crewToolsService.toFunctionDeclarations emits.
    const toolRes = await client.execute(
        {
            ...baseConfig,
            model,
            userPrompt: "What is the weather in Seattle? Use the tool.",
            tools: [{
                name: "get_weather",
                description: "Return current weather for the given location.",
                inputSchema: {
                    type: "object",
                    properties: { location: { type: "string", description: "City name" } },
                    required: ["location"],
                },
            }],
        } as any,
        undefined, apiKey,
    );
    const calls = toolRes.metadata?.toolCalls ?? [];
    console.log(`tool calls: ${toolRes.success ? JSON.stringify(calls) : `FAIL ${toolRes.error}`}`);
    if (!toolRes.success || calls.length === 0 || calls[0].name !== "get_weather") {
        console.error("  expected a native get_weather call — without this, crew turns fall back to text extraction");
        process.exitCode = 1;
    }
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
        console.error("✗", error?.message ?? error);
        process.exit(1);
    });
