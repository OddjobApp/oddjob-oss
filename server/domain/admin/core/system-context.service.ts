import { nodeRedisClient as redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { AGENT_TOOLS } from "../../tools/v1/tool-registry.service.js";
import { jobTypes } from "@shared/schema/index.js";

const REDIS_KEY = "system:context:ollama:v2";
const TTL_SECONDS = 3600 * 24; // 24 hours

import { createLogger } from "@server/utils/logger.js";
const logger = createLogger("SystemContextService");

export const systemContextService = {
    async getOllamaContext() {
        try {
            const data = await redis.get(REDIS_KEY);
            if (data) return JSON.parse(data);
            return null;
        } catch (err: any) {
            logger.warn(`Failed to get Ollama context from Redis: ${err.message}`);
            return null;
        }
    },

    async setOllamaContext(context: any) {
        await redis.set(REDIS_KEY, JSON.stringify(context), "EX", TTL_SECONDS);
    }
};

export const JOB_DESCRIPTIONS: Record<string, string> = {
    shell: "Execute shell commands (bash/sh) on the server. Useful for system admin tasks.",
    browser: "Launch a headless browser to perform web automation, scraping, or testing.",
    python: "Run a Python script for data processing, analysis, or machine learning.",
    sql: "Execute a SQL query against the connected database.",
    http: "Make an HTTP request to an external API or service.",
    email: "Send an email via the configured SMTP server.",
    slack: "Post a message to a Slack channel.",
    mcp: "Call a tool on a connected Model Context Protocol (MCP) server.",
};

export function getSystemPrompt(capabilities: any) {
    const tools = capabilities.tools || [];
    const jobs = capabilities.jobTypes || [];
    const schema = capabilities.schema || [];

    let prompt = "You are a specialized automation agent.\n\n";
    prompt += "### AVAILABLE TOOLS\n";
    prompt += tools.map((t: any) => `- ${t.name}: ${t.description}`).join("\n") + "\n\n";

    prompt += "### AVAILABLE ACTIVITY TYPES\n";
    prompt += jobs.map((j: any) => `- ${j}: ${JOB_DESCRIPTIONS[j] || "No description available"}`).join("\n") + "\n\n";

    prompt += "### DATABASE SCHEMA\n";
    prompt += schema.map((s: any) => {
        let sPrompt = `Table: ${s.table}\n`;
        sPrompt += s.columns.map((c: any) => `  - ${c.name} (${c.type})`).join("\n");
        return sPrompt;
    }).join("\n\n");

    return prompt;
}


