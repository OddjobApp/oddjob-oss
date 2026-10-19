/**
 * Oddjob MCP Server - Job Tools
 * 
 * Exposes tools for managing jobs through the Model Context Protocol.
 */

import { z } from "zod";

// Complete list of job types from schema (21 types)
const allJobTypes = [
    "shell",           // Execute shell commands/scripts
    "api",             // Generic API calls
    "curl",            // HTTP requests (REST APIs)
    "python",          // Execute Python scripts
    "ai_api_call",     // AI/LLM completions (single-turn)
    "repeater",        // Loop over array, execute nested job for each
    "transformer",     // Data transformation (JSON mapping, entity extraction)
    "openapi",         // OpenAPI spec-driven API calls
    "airflow_dag_run", // Trigger Airflow DAGs
    "human_approval",  // Wait for human approval (forms, email)
    "slack_post",      // Send Slack messages
    "email_send",      // Send emails via SMTP
    "sql_query",       // Execute SQL queries
    "ai_agent",        // AI Agent with tools (multi-turn reasoning)
    "decision",        // Conditional branching (if/else)
    "iterator",        // Iterate over an array or dataset, run job/pipeline per item
    "reranker",        // RAG reranking (semantic scoring)
    "folder_import",   // Import files from folders
    "file_export",     // Export data to files
    "file_ops",        // File system operations (copy, move, delete, list)
    "selenium",        // Browser automation (Playwright)
    "node_script",     // Execute Node.js scripts
] as const;

export const jobToolDefinitions = [
    {
        name: "list_jobs",
        description: "List all jobs in the organization. Jobs are reusable task definitions that can be executed as pipeline steps.",
        inputSchema: {
            type: "object" as const,
            properties: {
                search: {
                    type: "string",
                    description: "Optional: Search term to filter jobs by name",
                },
                type: {
                    type: "string",
                    enum: allJobTypes,
                    description: "Optional: Filter by job type",
                },
                limit: {
                    type: "number",
                    description: "Maximum results. Default: 20, Max: 100",
                },
            },
        },
    },
    {
        name: "get_job_details",
        description: "Get detailed configuration of a specific job including its type, config, and execution requirements.",
        inputSchema: {
            type: "object" as const,
            properties: {
                jobId: {
                    type: "number",
                    description: "ID of the job",
                },
                jobName: {
                    type: "string",
                    description: "Alternative: Name of the job (if ID not known)",
                },
            },
        },
    },
    {
        name: "create_job",
        description: `Create a new job definition. Requires admin permissions.

Job Types Available:
- **shell**: Execute shell commands/scripts
- **curl/api**: Make HTTP requests to REST APIs
- **python**: Execute Python scripts
- **ai_api_call**: Single-turn AI/LLM completion
- **ai_agent**: Multi-turn AI agent with tool use
- **transformer**: Data transformation & entity extraction
- **repeater**: Loop over array, run nested job for each
- **iterator**: Iterate an array/dataset, run job/pipeline per item
- **decision**: Conditional branching (if/else logic)
- **sql_query**: Execute SQL queries against databases
- **openapi**: OpenAPI spec-driven API calls
- **selenium**: Browser automation (web scraping, testing)
- **slack_post**: Send Slack messages
- **email_send**: Send emails via SMTP
- **airflow_dag_run**: Trigger Airflow DAGs
- **human_approval**: Wait for manual approval
- **folder_import**: Import files from directories
- **file_export**: Export data to files
- **file_ops**: File system operations (copy, move, delete, list, checksum)
- **reranker**: RAG semantic reranking
- **node_script**: Execute Node.js scripts`,
        inputSchema: {
            type: "object" as const,
            properties: {
                name: {
                    type: "string",
                    description: "Unique name for the job",
                },
                type: {
                    type: "string",
                    enum: allJobTypes,
                    description: "Type of job (see description for options)",
                },
                description: {
                    type: "string",
                    description: "Description of what the job does",
                },
                config: {
                    type: "object",
                    description: `Job-type specific configuration:
- curl/api: {url, method, headers, body, authType, credentialId}
- shell: {executable, parameters, workingDirectory}
- python: {scriptContent, requirements}
- ai_api_call: {credentialId, model, userPrompt, systemPrompt, temperature}
- ai_agent: {credentialId, model, goal, maxIterations, allowedTools}
- transformer: {rules: [{sourcePath, targetPath, type}], entityExtraction: {...}}
- sql_query: {credentialId, query, outputMode}
- openapi: {specId, operationId, parameters, credentialId}
- selenium: {browserType, headless, steps: [{action, selector, value}]}
- slack_post: {credentialId, channelId, message}
- email_send: {credentialId, to, subject, body}
- repeater: {inputSource, nestedJobType, nestedJobConfig, itemVariable}
- iterator: {mode, targetId, inputArray, itemVarName, concurrency}
- decision: {condition}
- human_approval: {formId, assigneeEmail, timeoutHours}
- folder_import: {folderPath, pattern, mode, recursive}
- file_export: {destinationPath, content, format}
- file_ops: {operation, sourcePath, destinationPath, force, recursive, preChecks, postChecks}`,
                },
                outputDatasetId: {
                    type: "number",
                    description: "Optional. Route this job's output into the dataset with this ID. This is the job's output dataset field, NOT part of `config`. Use the dataset's numeric ID (from list_datasets).",
                },
            },
            required: ["name", "type"],
        },
    },
    {
        name: "update_job",
        description: "Update an existing job's configuration. Requires admin permissions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                jobId: {
                    type: "number",
                    description: "ID of the job to update",
                },
                name: {
                    type: "string",
                    description: "New name (optional)",
                },
                description: {
                    type: "string",
                    description: "New description (optional)",
                },
                config: {
                    type: "object",
                    description: "Updated configuration (optional)",
                },
                isActive: {
                    type: "boolean",
                    description: "Enable or disable the job (optional)",
                },
                outputDatasetId: {
                    type: "number",
                    description: "Route this job's output into the dataset with this ID (e.g. save results to a repository). This is the job's output dataset field, NOT part of `config`. Use the dataset's numeric ID (from list_datasets). Pass null to stop routing output to a dataset.",
                },
            },
            required: ["jobId"],
        },
    },
    {
        name: "delete_job",
        description: "Delete a job. Requires admin permissions. Cannot delete jobs that are in use by active pipelines.",
        inputSchema: {
            type: "object" as const,
            properties: {
                jobId: {
                    type: "number",
                    description: "ID of the job to delete",
                },
            },
            required: ["jobId"],
        },
    },
];

// Input validation schemas
export const ListJobsInput = z.object({
    search: z.string().optional(),
    type: z.string().optional(),
    limit: z.number().min(1).max(100).default(20),
});

export const GetJobDetailsInput = z.object({
    jobId: z.number().optional(),
    jobName: z.string().optional(),
});

export const CreateJobInput = z.object({
    name: z.string().min(1),
    type: z.enum([
        "shell", "api", "curl", "python", "ai_api_call", "repeater",
        "transformer", "openapi", "airflow_dag_run", "human_approval",
        "slack_post", "email_send", "sql_query", "ai_agent", "decision",
        "iterator", "reranker", "folder_import", "file_export", "file_ops",
        "selenium", "node_script", "git_op", "file_writer", "confluence_sync",
        "google_drive_sync"
    ]),
    description: z.string().optional(),
    config: z.record(z.any()).optional(),
    // See UpdateJobInput.outputDatasetId — routes job output into a dataset.
    outputDatasetId: z.number().int().positive().nullable().optional(),
});

export const UpdateJobInput = z.object({
    jobId: z.number(),
    name: z.string().optional(),
    description: z.string().optional(),
    config: z.record(z.any()).optional(),
    isActive: z.boolean().optional(),
    // Route this job's output into a dataset. This is a top-level job field
    // (jobs.output_dataset_id), NOT part of `config` — job.service.storeOutput
    // honors it at runtime. Pass null to stop routing output to a dataset.
    outputDatasetId: z.number().int().positive().nullable().optional(),
});

export const DeleteJobInput = z.object({
    jobId: z.number(),
});

