import { redisManager } from "@domain/core/infrastructure/redis/redis-client.js";
import { AGENT_TOOLS } from "@domain/tools/v1/tool-registry.service.js";
import { jobTypes } from "@shared/schema/index.js";

const REDIS_KEY = "system:context:ollama:v2";
const TTL_SECONDS = 3600; // 1 hour

/**
 * SystemContextService
 * 
 * Dynamically generates and caches a "System Schema" document for Ollama.
 * This ensures the local model always has ground truth about Tools and DB Tables,
 * preventing hallucinations.
 */
export const systemContextService = {
    /**
     * Get the cached system context.
     * If missing, generates and caches it.
     */
    async getCachedContext(forceRefresh = false): Promise<string> {
        if (!forceRefresh) {
            try {
                const cached = await redisManager.client.get(REDIS_KEY);
                if (cached) return cached;
            } catch (e) {
                console.warn("[SystemContext] Failed to read from Redis", e);
            }
        }

        return this.generateAndCache();
    },

    /**
     * Generates the System Context Markdown and caches it.
     */
    async generateAndCache(): Promise<string> {
        console.log("[SystemContext] Generating fresh system context...");

        const toolsDoc = this.generateToolsDoc();
        const schemaDoc = this.generateSchemaDoc();
        const jobsDoc = this.generateJobTypesDoc();

        const fullDoc = `
# SYSTEM CAPABILITIES & SCHEMA
(Use this ground truth for answering questions)

## 1. AVAILABLE TOOLS
${toolsDoc}

## 2. AVAILABLE JOB TYPES (Automation Capabilities)
${jobsDoc}

## 3. DATABASE SCHEMA (Core Tables)
${schemaDoc}
`;

        try {
            await redisManager.client.setex(REDIS_KEY, TTL_SECONDS, fullDoc);
        } catch (e) {
            console.warn("[SystemContext] Failed to cache to Redis", e);
        }

        return fullDoc;
    },

    generateToolsDoc(): string {
        try {
            // AGENT_TOOLS is a key-value map
            const toolNames = Object.keys(AGENT_TOOLS);
            return toolNames.map(name => {
                const Tool = AGENT_TOOLS[name as keyof typeof AGENT_TOOLS];
                return `- **${name}**: ${Tool.description}`;
            }).join("\n");
        } catch (e) {
            console.error("Error generating tool doc", e);
            return "Error listing tools.";
        }
    },

    generateJobTypesDoc(): string {
        const descriptions: Record<string, string> = {
            shell: "Execute shell commands (bash/sh) on the server. Useful for system admin tasks.",
            api: "Make external HTTP API calls (GET, POST, etc.) with configurable headers and body.",
            curl: "Execute cURL commands directly. Good for complex API interactions.",
            python: "Execute Python scripts. Useful for data processing and logic.",
            ai_api_call: "Make calls to AI models (LLMs) via generic API interface.",
            repeater: "Iterate over a list or range and execute a sub-job for each item.",
            transformer: "Transform data using rules or scripts (ETL operations).",
            openapi: "Interact with OpenAPI/Swagger definition endpoints.",
            airflow_dag_run: "Trigger and monitor Airflow DAG runs.",
            human_approval: "Pause execution and wait for manual human approval.",
            slack_post: "Post messages to Slack channels.",
            email_send: "Send emails via SMTP or API.",
            sql_query: "Execute SQL queries against the internal or connected databases.",
            ai_agent: "Run an autonomous AI Agent with tools to solve complex tasks.",
            decision: "Conditional branching logic (If/Else) based on step outputs.",
            iterator: "Iterate over an array from a previous step's output.",
            reranker: "Re-rank search results or documents using semantic similarity.",
            folder_import: "Import files recursively from a local folder.",
            file_export: "Export data to a local file.",
            selenium: "Browser automation using Selenium WebDriver (headless/headed).",
            node_script: "Execute Node.js / JavaScript code in a sandboxed environment.",
            git_op: "Perform Git operations (Clone, Pull, Commit, Push, Checkout).",
            file_writer: "Write content to specific files.",
            file_ops: "Perform file system operations (List, Copy, Move, Delete).",
            confluence_sync: "Sync content from Confluence spaces.",
            google_drive_sync: "Sync files from Google Drive folders."
        };

        return jobTypes.map((type: any) => {
            const desc = descriptions[type] || "Standard automation job.";
            return `- **${type}**: ${desc}`;
        }).join("\n");
    },

    generateSchemaDoc(): string {
        // Hardcoded concise schema for critical tables
        return `
- **jobs**: Stores task definitions.
  - Columns: id (int), name (text), description (text), status (active/paused), schedule_id (int), pipeline_id (int).
  
- **pipelines**: Stores workflow definitions.
  - Columns: id (int), name (text), status (active), steps (json), current_version (int).

- **execution_steps**: Stores history of run steps.
  - Columns: id (int), job_id (int), step_name (text), status (completed/failed), logs (text).

- **schedules**: Stores cron triggers.
  - Columns: id (int), cron_expression (text), next_run (timestamp), active (bool).
`;
    }
};




