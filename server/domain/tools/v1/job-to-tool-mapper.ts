import { z } from "zod";
import type { ToolDefinition } from "./capabilities/types.js";
import { jobExecutorRegistry } from "../../jobs/core/executors/index.js";
import { createLogger } from "@server/utils/logger.js";
import { SchemaGenerator, type GeneratedToolSchema } from "./schema-generator.service.js";

const logger = createLogger("JobToToolMapper");

// Job type categories for organized tool groups
export const JOB_TYPE_GROUPS: Record<string, string> = {
    curl: "HTTP",
    api: "HTTP",
    shell: "Scripting",
    python: "Scripting",
    node_script: "Scripting",
    sql_query: "Database",
    ai_agent: "AI",
    agent_ai: "AI",
    ai_api_call: "AI",
    reranker: "AI",
    dispatcher: "Integration",
    slack_post: "Integration",
    email_send: "Integration",
    teams_post: "Integration",
    selenium: "Automation",
    file_ops: "File System",
    folder_import: "File System",
    file_export: "File System",
    file_writer: "File System",
    git_op: "Version Control",
    github_op: "Version Control",
    confluence_sync: "Sync",
    jira_sync: "Sync",
    google_drive_sync: "Sync",
    github_sync: "Sync",
    sharepoint_sync: "Sync",
    youtube_sync: "Sync",
    openapi: "Integration",
    airflow_dag_run: "Integration",
    transformer: "Data",
    iterator: "Flow Control",
    decision: "Flow Control",
    repeater: "Flow Control",
    human_approval: "Human-in-Loop",
    supervisor: "AI",
    form_agent: "AI",
    static_response: "Data",
    cloud_function: "Cloud",
    monitoring_query: "Monitoring",
    save_to_dataset: "Data",
};

/**
 * Creates a mock pipeline context for job execution via tool
 */
function createMockPipeline(job: any, name: string) {
    return {
        id: 0,
        name: `Tool-Invoked ${name}`,
        organizationId: job.organizationId,
    };
}

/**
 * JobToToolMapper
 *
 * Dynamically maps specialized Job records to agent ToolDefinitions.
 * This allows published "Apps" (which create Jobs) to be invoked as tools by Agents.
 *
 * PHASE 2 ENHANCEMENTS:
 * - Specialized parameter schemas for each job type (not generic "input" string)
 * - Proper type validation using Zod schemas
 * - Consistent error handling and logging
 * - Organized tool groups by function
 */
export class JobToToolMapper {
    /**
     * Maps a Job record to a ToolDefinition for use in AI Agent loops.
     * Uses specialized hand-written mappings for common types.
     */
    static mapJobToTool(job: any): ToolDefinition {
        const type = job.type;
        // Ensure name is safe for LLM tool calling (lowercase, underscores)
        const name = (job.tool || job.name).toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]/g, "");
        const group = JOB_TYPE_GROUPS[type] || "Apps";

        // Route to specialized mapper based on job type
        switch (type) {
            case "dispatcher":
                return this.mapDispatcherJob(job, name, group);
            case "curl":
            case "api":
                return this.mapCurlJob(job, name, group);
            case "shell":
                return this.mapShellJob(job, name, group);
            case "python":
                return this.mapPythonJob(job, name, group);
            case "sql_query":
                return this.mapSqlQueryJob(job, name, group);
            case "ai_agent":
            case "agent_ai":
                return this.mapAiAgentJob(job, name, group);
            case "ai_api_call":
                return this.mapAiApiCallJob(job, name, group);
            case "slack_post":
                return this.mapSlackPostJob(job, name, group);
            case "email_send":
                return this.mapEmailSendJob(job, name, group);
            case "selenium":
                return this.mapSeleniumJob(job, name, group);
            case "file_ops":
                return this.mapFileOpsJob(job, name, group);
            case "folder_import":
                return this.mapFolderImportJob(job, name, group);
            case "transformer":
                return this.mapTransformerJob(job, name, group);
            default:
                return this.mapGenericJob(job, name, type, group);
        }
    }

    /**
     * Maps a Job to a Tool using dynamic schema generation from Zod config schema.
     * This is useful for jobs with complex configurations or for future job types
     * that don't have specialized hand-written mappings.
     *
     * @param job - The job record with config containing the Zod schema
     * @param options - Configuration options
     * @returns ToolDefinition with dynamically generated parameter schema
     */
    static mapJobToToolWithDynamicSchema(
        job: any,
        options: {
            useConfigSchema?: boolean;  // If true, generate from job.configSchema
            fallbackToHandwritten?: boolean; // If true, use handwritten mappings when available
        } = {}
    ): ToolDefinition {
        const { useConfigSchema = false, fallbackToHandwritten = true } = options;
        const type = job.type;
        const name = (job.tool || job.name).toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]/g, "");
        const group = JOB_TYPE_GROUPS[type] || "Apps";

        // If fallback is enabled and we have a handwritten mapping, use it
        if (fallbackToHandwritten && this.hasHandwrittenMapping(type)) {
            return this.mapJobToTool(job);
        }

        // Otherwise, use dynamic schema generation
        if (useConfigSchema && job.configSchema) {
            try {
                const generated = SchemaGenerator.generateFromJobConfig(
                    type,
                    job.configSchema,
                    job.name
                );

                return this.buildToolFromGeneratedSchema(job, name, group, generated);
            } catch (error) {
                logger.warn(`Dynamic schema generation failed for ${type}, falling back to generic`, { error: String(error) });
                return this.mapGenericJob(job, name, type, group);
            }
        }

        // Fall back to generic mapping
        return this.mapGenericJob(job, name, type, group);
    }

    /**
     * Check if a job type has a specialized handwritten mapping
     */
    public static hasHandwrittenMapping(type: string): boolean {
        const mappedTypes = [
            "dispatcher", "curl", "api", "shell", "python",
            "sql_query", "ai_agent", "agent_ai", "ai_api_call", "slack_post",
            "email_send", "selenium", "file_ops", "folder_import", "transformer"
        ];
        return mappedTypes.includes(type);
    }

    /**
     * Build a ToolDefinition from a GeneratedToolSchema
     */
    private static buildToolFromGeneratedSchema(
        job: any,
        name: string,
        group: string,
        generated: GeneratedToolSchema
    ): ToolDefinition {
        const type = job.type;

        return {
            name,
            label: job.name,
            description: job.description || `${type} job with dynamically generated schema`,
            group,
            parameters: generated.schema,
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor(type);
                if (!executor) throw new Error(`No executor found for job type: ${type}`);

                logger.info(`Executing ${type} job via dynamic schema mapping`, { jobId: job.id });

                const mockPipeline = createMockPipeline(job, job.name);

                const execResult = await executor.execute(
                    job,
                    { ...job.config, ...params },
                    mockPipeline as any,
                    { ...context, data: params } as any
                );

                return execResult.output;
            },
        };
    }

    /**
     * Dispatcher job - specialized mapping for service dispatch
     */
    private static mapDispatcherJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Trigger a service dispatch (tow, medical, security, etc.) to a specific location.",
            group,
            parameters: z.object({
                serviceType: z.string().describe("Type of service requested (e.g. 'tow', 'flat_tire', 'lockout', 'accident')"),
                location: z.string().describe("Physical location or address where help is needed"),
                lat: z.number().optional().describe("Latitude of the incident location"),
                lng: z.number().optional().describe("Longitude of the incident location"),
                notes: z.string().optional().describe("Additional context or special instructions for the dispatcher"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("dispatcher");
                if (!executor) throw new Error("Dispatcher executor not found");

                logger.info(`Invoking Dispatcher tool via Job ${job.id}`, params);

                const config = {
                    serviceType: params.serviceType,
                    userLocationSource: "variable" as const,
                    userLocationVar: "{{data.resolvedLocation}}",
                    isDemoMode: false,
                };

                const mockPipeline = createMockPipeline(job, "Dispatch");

                const execResult = await executor.execute(
                    job,
                    config as any,
                    mockPipeline as any,
                    {
                        ...context,
                        data: {
                            ...params,
                            resolvedLocation: {
                                lat: params.lat || 0,
                                lng: params.lng || 0,
                                address: params.location,
                                resolvedBy: params.lat && params.lng ? "gps" : "manual",
                            },
                        },
                    } as any
                );

                return execResult.output;
            },
        };
    }

    /**
     * Curl/HTTP job - full HTTP request capabilities
     */
    private static mapCurlJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Make HTTP requests to external APIs or services.",
            group,
            parameters: z.object({
                url: z.string().describe("Target URL or path (absolute URL or relative path starting with /)"),
                method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET").describe("HTTP method"),
                headers: z.record(z.string(), z.string()).optional().describe("HTTP headers as key-value pairs"),
                queryParams: z.record(z.string(), z.any()).optional().describe("Query parameters"),
                body: z.string().optional().describe("Request body (JSON string, form data, etc.)"),
                authType: z.enum(["none", "bearer", "basic"]).optional().describe("Authentication type if needed"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("curl") || jobExecutorRegistry.getExecutor("api");
                if (!executor) throw new Error("HTTP executor not found");

                logger.info(`Executing HTTP request via Job ${job.id}`, { url: params.url, method: params.method });

                const config = {
                    url: params.url,
                    method: params.method,
                    headers: params.headers,
                    queryParams: params.queryParams,
                    body: params.body,
                    authType: params.authType || "none",
                };

                const mockPipeline = createMockPipeline(job, "HTTP Request");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * Shell script job - execute shell commands
     */
    private static mapShellJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Execute shell commands on the local system.",
            group,
            parameters: z.object({
                command: z.string().describe("Shell command to execute"),
                parameters: z.string().optional().describe("Additional command parameters/arguments"),
                workingDirectory: z.string().optional().describe("Working directory for command execution"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("shell");
                if (!executor) throw new Error("Shell executor not found");

                logger.info(`Executing shell command via Job ${job.id}`, { command: params.command });

                const config = {
                    executable: params.command,
                    parameters: params.parameters,
                    workingDirectory: params.workingDirectory,
                };

                const mockPipeline = createMockPipeline(job, "Shell Command");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * Python script job - execute Python code
     */
    private static mapPythonJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Execute Python scripts for data processing and automation.",
            group,
            parameters: z.object({
                script: z.string().describe("Python script code to execute"),
                requirements: z.string().optional().describe("Additional pip requirements (space-separated)"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("python");
                if (!executor) throw new Error("Python executor not found");

                logger.info(`Executing Python script via Job ${job.id}`);

                const config = {
                    scriptContent: params.script,
                    requirements: params.requirements,
                };

                const mockPipeline = createMockPipeline(job, "Python Script");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * SQL Query job - execute database queries
     */
    private static mapSqlQueryJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Execute SQL queries against connected databases.",
            group,
            parameters: z.object({
                query: z.string().describe("SQL query to execute"),
                parameters: z.record(z.string(), z.string()).optional().describe("Query parameters for prepared statements"),
                outputMode: z.enum(["list", "single"]).default("list").describe("Return all rows or single result"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("sql_query");
                if (!executor) throw new Error("SQL executor not found");

                logger.info(`Executing SQL query via Job ${job.id}`);

                const config = {
                    query: params.query,
                    parameters: params.parameters,
                    outputMode: params.outputMode,
                    credentialId: job.config?.credentialId,
                };

                const mockPipeline = createMockPipeline(job, "SQL Query");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * AI Agent job - run autonomous AI agents
     */
    private static mapAiAgentJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Run an autonomous AI agent to accomplish a goal.",
            group,
            parameters: z.object({
                goal: z.string().describe("The goal or task for the AI agent to accomplish"),
                persona: z.enum(["generic", "researcher", "critic", "analyst", "creator", "strategist", "debugger"]).optional().describe("Agent persona/specialty"),
                maxIterations: z.number().int().optional().describe("Maximum thinking iterations (default: 10)"),
                allowedTools: z.array(z.string()).optional().describe("Specific tools the agent can use"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("ai_agent");
                if (!executor) throw new Error("AI Agent executor not found");

                logger.info(`Running AI Agent via Job ${job.id}`, { goal: params.goal });

                const config = {
                    ...job.config,
                    goal: params.goal,
                    persona: params.persona || job.config?.persona || "generic",
                    maxIterations: params.maxIterations || job.config?.maxIterations || 10,
                    allowedTools: params.allowedTools || job.config?.allowedTools,
                };

                const mockPipeline = createMockPipeline(job, "AI Agent");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * AI API Call job - direct LLM calls
     */
    private static mapAiApiCallJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Make direct AI/LLM API calls with custom prompts.",
            group,
            parameters: z.object({
                prompt: z.string().describe("The prompt to send to the AI model"),
                systemPrompt: z.string().optional().describe("System instructions for the AI"),
                temperature: z.number().min(0).max(2).optional().describe("Response creativity (0-2, default: 0.7)"),
                maxTokens: z.number().int().optional().describe("Maximum tokens in response"),
                responseFormat: z.enum(["json", "text"]).optional().describe("Expected response format"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("ai_api_call");
                if (!executor) throw new Error("AI API executor not found");

                logger.info(`Executing AI API call via Job ${job.id}`);

                const config = {
                    ...job.config,
                    userPrompt: params.prompt,
                    systemPrompt: params.systemPrompt || job.config?.systemPrompt,
                    temperature: params.temperature ?? job.config?.temperature ?? 0.7,
                    maxTokens: params.maxTokens || job.config?.maxTokens,
                    requestType: params.responseFormat || job.config?.requestType,
                };

                const mockPipeline = createMockPipeline(job, "AI API Call");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * Slack post job - send Slack messages
     */
    private static mapSlackPostJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Send messages to Slack channels.",
            group,
            parameters: z.object({
                channel: z.string().describe("Slack channel ID or name (e.g., #general, C123456)"),
                message: z.string().describe("Message text to send"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("slack_post");
                if (!executor) throw new Error("Slack executor not found");

                logger.info(`Sending Slack message via Job ${job.id}`, { channel: params.channel });

                const config = {
                    channelId: params.channel,
                    message: params.message,
                    credentialId: job.config?.credentialId,
                };

                const mockPipeline = createMockPipeline(job, "Slack Post");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * Email send job - send emails
     */
    private static mapEmailSendJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Send emails via configured email provider.",
            group,
            parameters: z.object({
                to: z.string().describe("Recipient email address(es), comma-separated for multiple"),
                subject: z.string().describe("Email subject line"),
                body: z.string().describe("Email body content"),
                isHtml: z.boolean().optional().describe("Whether body is HTML (default: false)"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("email_send");
                if (!executor) throw new Error("Email executor not found");

                logger.info(`Sending email via Job ${job.id}`, { to: params.to });

                const config = {
                    to: params.to,
                    subject: params.subject,
                    body: params.body,
                    isHtml: params.isHtml || false,
                    credentialId: job.config?.credentialId,
                };

                const mockPipeline = createMockPipeline(job, "Email Send");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * Selenium job - browser automation
     */
    private static mapSeleniumJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Automate browser actions and web scraping.",
            group,
            parameters: z.object({
                url: z.string().describe("Starting URL to navigate to"),
                goal: z.string().optional().describe("Automation goal or task description (for AI-driven automation)"),
                steps: z.string().optional().describe("JSON array of automation steps"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("selenium");
                if (!executor) throw new Error("Selenium executor not found");

                logger.info(`Running browser automation via Job ${job.id}`, { url: params.url });

                let parsedSteps;
                try {
                    parsedSteps = params.steps ? JSON.parse(params.steps) : undefined;
                } catch (e) {
                    throw new Error("Invalid steps JSON format");
                }

                const config = {
                    ...job.config,
                    startUrl: params.url,
                    goal: params.goal || job.config?.goal,
                    steps: parsedSteps || job.config?.steps,
                };

                const mockPipeline = createMockPipeline(job, "Browser Automation");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * File operations job - file system operations
     */
    private static mapFileOpsJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Perform file system operations (copy, move, delete, list).",
            group,
            parameters: z.object({
                operation: z.enum(["copy", "move", "delete", "list", "create_dir"]).describe("File operation to perform"),
                sourcePath: z.string().describe("Source file or directory path"),
                destinationPath: z.string().optional().describe("Destination path (for copy/move)"),
                recursive: z.boolean().optional().describe("Apply operation recursively to directories"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("file_ops");
                if (!executor) throw new Error("File operations executor not found");

                logger.info(`Executing file operation via Job ${job.id}`, { operation: params.operation, path: params.sourcePath });

                const config = {
                    operation: params.operation,
                    sourcePath: params.sourcePath,
                    destinationPath: params.destinationPath,
                    recursive: params.recursive || false,
                };

                const mockPipeline = createMockPipeline(job, "File Operation");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * Folder import job - import files from directory
     */
    private static mapFolderImportJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Import and process files from a directory.",
            group,
            parameters: z.object({
                folderPath: z.string().describe("Path to the folder to import from"),
                pattern: z.string().optional().describe("File pattern (e.g., '*.csv', '*.json')"),
                recursive: z.boolean().optional().describe("Include subdirectories"),
                mode: z.enum(["list_only", "read_content", "ingest_dataset"]).optional().describe("Import mode"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("folder_import");
                if (!executor) throw new Error("Folder import executor not found");

                logger.info(`Importing folder via Job ${job.id}`, { path: params.folderPath });

                const config = {
                    folderPath: params.folderPath,
                    pattern: params.pattern || "**/*",
                    recursive: params.recursive ?? job.config?.recursive ?? false,
                    mode: params.mode || job.config?.mode || "list_only",
                };

                const mockPipeline = createMockPipeline(job, "Folder Import");

                const execResult = await executor.execute(job, config as any, mockPipeline as any, {
                    ...context,
                    data: params,
                } as any);

                return execResult.output;
            },
        };
    }

    /**
     * Transformer job - data transformation
     */
    private static mapTransformerJob(job: any, name: string, group: string): ToolDefinition {
        return {
            name,
            label: job.name,
            description: job.description || "Transform data structures and extract entities.",
            group,
            parameters: z.object({
                input: z.string().describe("Input data (JSON string) to transform"),
                rules: z.string().describe("JSON array of transformation rules"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor("transformer");
                if (!executor) throw new Error("Transformer executor not found");

                logger.info(`Running data transformation via Job ${job.id}`);

                let parsedInput;
                let parsedRules;
                try {
                    parsedInput = JSON.parse(params.input);
                    parsedRules = JSON.parse(params.rules);
                } catch (e) {
                    throw new Error("Invalid JSON format for input or rules");
                }

                const config = {
                    rules: parsedRules,
                    inputSource: "provided" as const,
                };

                const mockPipeline = createMockPipeline(job, "Data Transformer");

                const execResult = await executor.execute(
                    job,
                    config as any,
                    mockPipeline as any,
                    {
                        ...context,
                        data: { input: parsedInput },
                    } as any
                );

                return execResult.output;
            },
        };
    }

    /**
     * Generic fallback for job types without specialized mapping
     */
    private static mapGenericJob(job: any, name: string, type: string, group: string): ToolDefinition {
        logger.warn(`Using generic tool mapping for job type: ${type}. Consider adding specialized mapping.`);

        return {
            name,
            label: job.name,
            description: job.description || `Execute the ${job.name} capability (${type}).`,
            group,
            parameters: z.object({
                input: z.string().describe("Input data or instructions for the job (JSON string recommended)"),
            }),
            execute: async (params, context) => {
                const executor = jobExecutorRegistry.getExecutor(type);
                if (!executor) throw new Error(`No executor found for job type: ${type}`);

                logger.info(`Executing generic job via Job ${job.id}`, { type });

                let parsedInput;
                try {
                    parsedInput = JSON.parse(params.input);
                } catch {
                    // If not valid JSON, use as raw string
                    parsedInput = { rawInput: params.input };
                }

                const mockPipeline = createMockPipeline(job, job.name);

                const execResult = await executor.execute(
                    job,
                    { ...job.config, ...parsedInput },
                    mockPipeline as any,
                    {
                        ...context,
                        data: parsedInput,
                    } as any
                );

                return execResult.output;
            },
        };
    }
}


