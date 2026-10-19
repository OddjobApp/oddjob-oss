
import { OllamaClient } from "@domain/ai/core/providers/ollama-client.js";
import { AIApiCallConfig } from "../shared/schema/jobs/config-ai.js";

async function runBenchmark() {
    console.log("Starting Local AI Benchmark (Ollama + RTX 5070)...");

    const client = new OllamaClient({ baseUrl: "http://localhost:11434", model: "deepseek-r1:latest" });

    const longPrompt = "Generate a 1000 word essay about the future of decentralized AI agents and their impact on global economy. ".repeat(10);

    const config: AIApiCallConfig = {
        model: "deepseek-r1:latest",
        userPrompt: longPrompt,
        temperature: 0.1,
        maxTokens: 500,
        useCache: false,
        maxContextTokens: 65536,
        topK: 40,
        topP: 0.9,
        repeatPenalty: 1.1,
        saveOutputToFile: false
    };

    console.log(`Prompt size: ~${Math.round(longPrompt.length / 4)} tokens`);
    console.log("Executing prompt with Flash Attention 2 enabled...");

    const startTime = Date.now();
    const response = await client.execute(config, "", "");
    const totalTime = Date.now() - startTime;

    if (response.success && response.metadata) {
        const tokens = (response.metadata as any).tokensUsed || 0;
        const tokensPerSec = tokens / (totalTime / 1000);

        console.log("-----------------------------------------");
        console.log("BENCHMARK RESULTS");
        console.log("-----------------------------------------");
        console.log(`Total Time: ${totalTime}ms`);
        console.log(`Tokens Generated: ${tokens}`);
        console.log(`Throughput: ${tokensPerSec.toFixed(2)} tokens/sec`);
        console.log("-----------------------------------------");
        console.log("Verification: Check Ollama logs for 'Flash Attention enabled'");
    } else {
        console.error("Benchmark failed:", response.error || "Unknown error");
    }
}

runBenchmark().catch(console.error);
