import { z } from "zod";
import { pipelineService } from "../../../pipeline/core/pipeline.service.js";
import type { ToolDefinition, ToolContext } from "./types.js";
import { requireToolOrgId } from "./org-context.js";
import { JOB_SCHEMAS } from "../../../../config/jobs/schemas.js";
import { retrieveSimilarDocuments } from "@domain/knowledge/core/rag-langchain.service.js";
import { topicService } from "../../../../domain/knowledge/core/topic-service.js";
import { jobService } from "../../../../domain/jobs/job.service.js";
import { documentService } from "../../../../domain/knowledge/core/extraction/document-service.js";
import { graphService } from "../../../../domain/knowledge/core/graph/graph-service.js";

export const CORE_TOOLS: Record<string, ToolDefinition> = {
    sleep: {
        name: "sleep",

        idempotency: "read-safe",
        label: "Sleep / Delay",
        group: "Control Flow",
        description: "Suspend execution for a specified duration.",
        parameters: z.object({
            seconds: z.number().min(1).describe("Duration to sleep in seconds"),
            reason: z.string().optional().describe("Reason for suspension")
        }),
        execute: async ({ seconds, reason }: any, context: ToolContext) => {
            const sleepUntil = new Date(Date.now() + seconds * 1000);
            return {
                _status: "waiting_async", // Special flag for Executor
                sleepUntil,
                suspensionMetadata: { reason: reason || "Sleep tool invoked" }
            };
        }
    },
    // `search_knowledge_base` used to be defined here, with its own SQL + vector
    // search. It could never run: TOOL_ALIASES maps that name to
    // `search_unified_knowledge`, and both resolution points — agent-runner.ts:25
    // at setup and tool-executor.service.ts:22 at dispatch — consult the alias
    // table before the registry. The alias is correct (unified search is the
    // superset), so the unreachable definition is gone and the name still works.
    get_document_relationships: {
        name: "get_document_relationships",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Understand Relationships",
        group: "Core Capabilities",
        description: "Find jobs, pipelines, and datasets linked to a Knowledge Store document or topic. Use this to show users which automations use their knowledge.",
        parameters: z.object({
            topicId: z.number().optional().describe("ID of the knowledge topic to search"),
            topicName: z.string().optional().describe("Name of the topic to search (if ID unknown)"),
            documentId: z.number().optional().describe("ID of the document to search"),
        }),
        execute: async ({ topicId, topicName, documentId }: any, context: ToolContext) => {
            try {
                const results: string[] = [];
                // The caller's organization, never null and never super-admin: with
                // a null organization and a super-admin flag the services below
                // skip their org filter, and this tool reported every tenant's
                // jobs, documents and pipelines.
                const orgContext: any = {
                    userId: context?.userId || "unknown",
                    organizationId: requireToolOrgId(context),
                    isAdmin: !!context?.isAdmin,
                    isSuperAdmin: false,
                    isOrgAdmin: !!context?.isOrgAdmin
                };

                // Check permissions if running within a job context
                if (context?.jobConfig) {
                    const kTypes = (context.jobConfig as any).knowledgeTypes;
                    // Requires either 'docs' or 'graph' depending on what we are looking up
                    if (kTypes && !kTypes.includes('docs') && !kTypes.includes('graph')) {
                        return "Access Denied: This agent is not configured to access Knowledge Documents or Graphs.";
                    }
                }

                // If topicName provided, find topicId
                let resolvedTopicId = topicId;
                if (!resolvedTopicId && topicName) {
                    const topics = await topicService.findTopicByName(topicName, orgContext);
                    if (topics.length > 0) {
                        resolvedTopicId = topics[0].id;
                        results.push(`📁 Found topic: "${topics[0].name}" (ID: ${resolvedTopicId})`);
                    } else {
                        results.push(`⚠️ No topic found matching "${topicName}"`);
                    }
                }

                // Validate access to resolvedTopicId
                if (resolvedTopicId && (context?.jobConfig as any)?.topicIds) {
                    if (!(context.jobConfig as any).topicIds.includes(resolvedTopicId)) {
                        return `Access Denied: This agent is not authorized to access Topic ID ${resolvedTopicId}.`;
                    }
                }

                // Find jobs that use this topic via retrievalSettings.topicIds
                if (resolvedTopicId) {
                    const jobs = await jobService.findJobsUsingTopic(resolvedTopicId, orgContext);

                    if (jobs.length > 0) {
                        results.push("\n**🔧 Jobs using this topic:**");
                        jobs.forEach((job: any) => {
                            results.push(`- [${job.name}](/jobs/${job.id}) (Type: ${job.type})`);
                        });
                    } else {
                        results.push("\n*No jobs found using this topic.*");
                    }

                    // Find documents in this topic
                    const documents = await documentService.listDocuments(orgContext, {
                        topicId: resolvedTopicId,
                        limit: 10
                    });

                    if (documents.length > 0) {
                        results.push("\n**📄 Documents in this topic:**");
                        documents.forEach((doc: any) => {
                            results.push(`- ${doc.title} (ID: ${doc.id})`);
                        });
                    }
                }

                // Find knowledge graph entities linked to document
                if (documentId) {
                    const { nodes } = await graphService.searchNodes(orgContext, {
                        knowledgeDocumentId: documentId,
                        limit: 10
                    });

                    if (nodes.length > 0) {
                        results.push("\n**🔗 Knowledge Graph Entities from this document:**");
                        nodes.forEach((entity: any) => {
                            results.push(`- [${entity.name}](/knowledge/graph?entity=${entity.id}) (${entity.label})`);
                        });
                    }
                }

                // Find pipelines that contain jobs using this knowledge
                if (resolvedTopicId) {
                    const pipelines = await pipelineService.findPipelinesUsingTopic(resolvedTopicId, orgContext);

                    if (pipelines.length > 0) {
                        results.push("\n**⚙️ Pipelines using this knowledge:**");
                        pipelines.forEach(pipeline => {
                            results.push(`- [${pipeline.name}](/pipelines/${pipeline.id})`);
                        });
                    }
                }

                return results.length > 0
                    ? results.join("\n")
                    : "No relationships found. Try searching with a topic name or document ID.";
            } catch (error: any) {
                return `Error finding relationships: ${error.message}`;
            }
        },
    },
    calculator: {
        name: "calculator",

        idempotency: "read-safe",
        label: "Calculator",
        group: "Core Capabilities",
        description: "Perform basic arithmetic calculations.",
        parameters: z.object({
            expression: z.string().describe("The mathematical expression to evaluate (e.g. '2 + 2')"),
        }),
        execute: async ({ expression }: any, context: ToolContext) => {
            // Basic safety check: only allow numbers and operators
            if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
                return "Error: Invalid characters in expression.";
            }
            try {
                // Evaluate safely
                return String(new Function(`return ${expression}`)());
            } catch (e) {
                return `Calculation error: ${e}`;
            }
        },
    },
    http_request: {
        name: "http_request",

        idempotency: "none",
        label: "HTTP Request",
        group: "Core Capabilities",
        description: "Make an HTTP request to an external API (GET, POST, etc).",
        parameters: z.object({
            method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
            url: z.string().url(),
            headers: z.record(z.string()).optional(),
            body: z.string().optional().describe("JSON string or raw body content"),
        }),
        execute: async ({ method, url, headers, body }: any, context: ToolContext) => {
            try {
                const res = await fetch(url, {
                    method,
                    headers: headers || { "Content-Type": "application/json" },
                    body,
                });
                const text = await res.text();
                return `Status: ${res.status}\nBody: ${text.substring(0, 2000)}`; // limit output
            } catch (e) {
                return `Request failed: ${e}`;
            }
        },
    },
    current_time: {
        name: "current_time",

        idempotency: "read-safe",
        label: "Current Time",
        group: "Core Capabilities",
        description: "Get the current server time (ISO string).",
        parameters: z.object({}),
        execute: async (params: any, context: ToolContext) => {
            return new Date().toISOString();
        },
    },
    get_job_schema: {
        name: "get_job_schema",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Job Schema",
        group: "Core Capabilities",
        description: "Get the full configuration schema for a specific job type. Returns required fields, optional fields, types, and examples. Use this to understand how to configure a job before creating it.",
        parameters: z.object({
            jobType: z.string().describe("The job type to get schema for (e.g., 'folder_import', 'transformer', 'curl')"),
        }),
        execute: async ({ jobType }: any, context: ToolContext) => {
            const schema = JOB_SCHEMAS[jobType as keyof typeof JOB_SCHEMAS];
            if (!schema) {
                const types = Object.keys(JOB_SCHEMAS).join(", ");
                return `Unknown job type "${jobType}". Available types: ${types}`;
            }
            return JSON.stringify(schema, null, 2);
        }
    },
    get_pipeline_variable_syntax: {
        name: "get_pipeline_variable_syntax",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Pipeline Variable Syntax",
        group: "Core Capabilities",
        description: "Get reference documentation for pipeline variable syntax. Learn how to pass data between steps using {{steps.N.output}} syntax.",
        parameters: z.object({}),
        execute: async (params: any, context: ToolContext) => {
            return `# Pipeline Variable Syntax

## Referencing Previous Step Output
Use {{steps.N.output}} to reference the output of step N (0-indexed):

- {{steps.0.output}} - Output of first step
- {{steps.1.output}} - Output of second step
- {{steps.2.output.items}} - Access "items" field of third step's output

## Nested Access
- {{steps.0.output.data.records}} - Deep nested access
- {{steps.1.output[0]}} - First item of array output

## Input Data
- {{input}} - Pipeline trigger input data
- {{input.webhook.body}} - Webhook body if triggered via webhook

## Common Patterns

### Chain CURL → Transformer → File Export
Step 1 (curl): Fetches API data → output is JSON
Step 2 (transformer): Input "{{steps.0.output}}" → transforms data
Step 3 (file_export): content: "{{steps.1.output}}" → writes to file

### Folder Import → Process Each File
Step 1 (folder_import): Lists/reads files → output is array
Step 2 (iterator): inputArray: "{{steps.0.output.files}}" → processes each

### Conditional Processing
Step 1 (curl): Fetch data
Step 2 (decision): condition: "{{steps.0.output.count}} > 0"
Step 3 (job, if true): Process data
Step 4 (slack_post, if false): Notify "no data"`;
        }
    },
    request_execute_mode: {
        name: "request_execute_mode",

        idempotency: "idempotent",
        label: "Request Execute Mode",
        group: "Core Capabilities",
        description: "Request the user to switch the Assistant to Execute mode to carry out side-effect actions. Use this after you have a solid plan and are ready to run it.",
        parameters: z.object({
            reason: z.string().describe("Explanation of why execute mode is needed and what actions will be taken."),
        }),
        execute: async ({ reason }: any, context: ToolContext) => {
            return JSON.stringify({
                type: "mode_switch_request",
                targetMode: "execute",
                reason,
                message: "Shall I switch to Execute mode and carry out this plan?"
            });
        },
    }
};
