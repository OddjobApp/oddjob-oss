import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { assertOrgId } from "@server/utils/auth-context.js";
import { requireToolOrgId } from "./org-context.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

// Helper function to extract text from MCP response format
function extractMcpText(mcpResult: any): string {
    if (mcpResult?.content && Array.isArray(mcpResult.content)) {
        const textContent = mcpResult.content.find((c: any) => c.type === "text");
        if (textContent?.text) {
            return textContent.text;
        }
    }
    return JSON.stringify(mcpResult, null, 2);
}

export const DATA_TOOLS: Record<string, ToolDefinition> = {
    external_sql_query: {
        name: "external_sql_query",

        idempotency: "read-safe",
        label: "External DB Query",
        group: "Datasets & External",
        description: "Execute a SQL query against an EXTERNAL database using a stored credential. CRITICAL: Use parameters ($1, $2, etc.) for any user-provided data to prevent SQL injection.",
        parameters: z.object({
            credentialId: z.number().describe("The ID of the database credential to use"),
            query: z.string().describe("The SQL query to execute. Use $1, $2, etc. for parameters."),
            params: z.array(z.any()).optional().default([]).describe("Array of parameters for the query")
        }),
        execute: async ({ credentialId, query, params }: any, context: ToolContext) => {
            let client;
            try {
                // Import credentialsService dynamically to avoid circular deps if any
                const { credentialsService } = await import("@domain/auth/core/credentials-service.js");
                const { Client } = await import("pg");

                let credential;
                try {
                    credential = await credentialsService.getForExecution(credentialId, (context as any)?.organizationId ?? null);
                } catch {
                    return `Error: Credential ${credentialId} not found`;
                }
                if (credential.type !== "database") return `Error: Credential ${credentialId} is not a database credential`;

                const metadata = credential.metadata as any; // DatabaseMetadata (avoid import cycle)
                const password = (await resolveCredentialSecret(credential));

                if (!password) return `Error: Secret for credential ${credentialId} not found`;

                client = new Client({
                    host: metadata.host,
                    port: metadata.port,
                    database: metadata.database,
                    user: metadata.user,
                    password: password,
                    ssl: metadata.ssl ?? false
                });

                await client.connect();
                const res = await client.query(query, params || []);

                // Limit results
                const rows = res.rows.slice(0, 50);
                const summary = rows.length < res.rows.length ? `\n...(showing first 50 of ${res.rows.length} rows)` : "";

                return JSON.stringify(rows, null, 2) + summary;
            } catch (e: any) {
                return `External SQL Error: ${e.message}`;
            } finally {
                if (client) await client.end().catch(() => { });
            }
        },
    },

    // --- Dataset Tools (via MCP handlers) ---
    list_datasets: {
        name: "list_datasets",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Datasets",
        group: "Datasets & External",
        description: "List available datasets with metadata and item counts.",
        parameters: z.object({
            search: z.string().optional(),
            limit: z.number().optional().default(20),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleListDatasets } = await import("@server/mcp/handlers.js");
            const result = await handleListDatasets(params, context);
            return extractMcpText(result);
        }
    },
    get_dataset_details: {
        name: "get_dataset_details",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Dataset Details",
        group: "Datasets & External",
        description: "Get details and sample items from a dataset.",
        parameters: z.object({
            datasetId: z.number().optional(),
            datasetName: z.string().optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetDatasetDetails } = await import("../../../../mcp/handlers.js");
            const result = await handleGetDatasetDetails(params, context);
            return extractMcpText(result);
        }
    },
    create_dataset: {
        name: "create_dataset",

        idempotency: "none",
        label: "Create Dataset",
        group: "Datasets & External",
        adminOnly: true,
        description: "Create a new empty dataset container.",
        parameters: z.object({
            name: z.string().describe("Dataset name"),
            description: z.string().optional(),
            tags: z.array(z.string()).optional().default([]),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to create datasets.";
            }
            // The MCP handler resolves a missing or null org to ODDJOB_ORG_ID || 1.
            requireToolOrgId(context);
            const { handleCreateDataset } = await import("@server/mcp/handlers.js");
            const result = await handleCreateDataset(params, context);

            // --- Transaction Logging ---
            if (context?.transaction && (result as any).success && (result as any).id) {
                await context.transaction.logOperation({
                    type: "db_insert",
                    params: { table: "datasets", id: (result as any).id },
                    rollbackData: null
                });
            }

            return extractMcpText(result);
        }
    },
    query_dataset: {
        name: "query_dataset",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Query Dataset",
        group: "Datasets & External",
        description: "Retrieve items from a dataset.",
        parameters: z.object({
            datasetId: z.number().describe("Dataset ID"),
            limit: z.number().optional().default(20),
            offset: z.number().optional().default(0),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleQueryDataset } = await import("../../../../mcp/handlers.js");
            const result = await handleQueryDataset(params, context);
            return extractMcpText(result);
        }
    },
    add_dataset_items: {
        name: "add_dataset_items",

        idempotency: "none",
        label: "Add Items",
        group: "Datasets & External",
        description: "Add JSON items to an existing dataset.",
        parameters: z.object({
            datasetId: z.number().describe("Dataset ID"),
            items: z.array(z.record(z.any())).default([]).describe("Array of JSON objects"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleAddDatasetItems } = await import("../../../../mcp/handlers.js");
            const result = await handleAddDatasetItems(params, context);

            // --- Transaction Logging ---
            if (context?.transaction && (result as any).success && (result as any).itemIds) {
                await context.transaction.logOperation({
                    type: "db_insert",
                    params: { table: "dataset_items", ids: (result as any).itemIds },
                    rollbackData: null
                });
            }

            return extractMcpText(result);
        }
    },
    run_prediction: {
        name: "run_prediction",

        idempotency: "read-safe",
        label: "Run Prediction",
        group: "Datasets & External",
        description: "Run prediction intelligence on a dataset or CSV file. This will use the Hidden State and Prediction Pods to analyze data and generate predictions.",
        parameters: z.object({
            csvPath: z.string().optional().describe("Path to the CSV file to analyze"),
            datasetId: z.number().optional().describe("Dataset ID to analyze"),
            limit: z.number().optional().default(5).describe("Number of rows to process")
        }),
        execute: async ({ csvPath, datasetId, limit }: any, context: ToolContext) => {
            try {
                const { predictionPod } = await import("@server/domain/prediction-intelligence/prediction/prediction-pod.service.js");
                const { hiddenStatePod } = await import("@server/domain/prediction-intelligence/hidden-state/hidden-state-pod.service.js");
                const { randomUUID } = await import("crypto");
                
                let rows: any[] = [];
                let header: string[] = [];

                if (datasetId) {
                    const { datasetService } = await import("@domain/knowledge/index.js");
                    const orgContext = {
                        organizationId: assertOrgId((context as any)?.organizationId),
                        userId: (context as any)?.userId || "system",
                        isAdmin: !!(context as any)?.isAdmin,
                        isSuperAdmin: !!(context as any)?.isSuperAdmin,
                        isOrgAdmin: !!(context as any)?.isOrgAdmin,
                    };
                    const { items } = await datasetService.getItems(datasetId, orgContext, { limit });
                    
                    if (!items || items.length === 0) {
                        return `Error: No items found in dataset ${datasetId}`;
                    }
                    
                    rows = items.map((item: any) => item.data || item);
                    header = Object.keys(rows[0]);
                } else if (csvPath) {
                    const fs = await import("fs");
                    if (!fs.existsSync(csvPath)) {
                        return `Error: CSV file not found at ${csvPath}`;
                    }

                    const content = fs.readFileSync(csvPath, "utf-8");
                    const lines = content.split("\n").filter(l => l.trim());
                    header = lines[0].split(",");
                    rows = lines.slice(1, limit + 1).map(l => {
                        const vals = l.split(",");
                        const obj: any = {};
                        header.forEach((h, i) => obj[h] = vals[i]);
                        return obj;
                    });
                } else {
                    return "Error: Either csvPath or datasetId must be provided.";
                }

                const results: any[] = [];
                const dynamicTrace: any[] = [];

                for (const row of rows) {
                    const customerId = row[header[0]] || "unknown";
                    const predictionContextId = randomUUID();
                    const actualChurn = row[header[header.length - 1]];
                    const now = new Date().toISOString();

                    // Convert tabular feature cells into first-class prediction quants.
                    const activeQuants = [];
                    for (let i = 1; i < header.length - 1; i++) {
                        const key = header[i];
                        const val = row[key];
                        const numericValue = typeof val === "number" ? val : parseFloat(val) || 0;
                        activeQuants.push({
                            id: randomUUID(),
                            contextId: predictionContextId,
                            type: "event_signal" as const,
                            label: key,
                            magnitude: numericValue,
                            confidence: 0.9,
                            uncertainty: 0.2,
                            entropyContribution: 0.1,
                            sourceEventIds: [randomUUID()],
                            sourceEpisodeIds: [],
                            sourcePredictionIds: [],
                            sourceQuantIds: [],
                            epistemic: { status: "known_unknown" as any, worldKnownness: 0.5, systemKnownness: 0.5, evidenceStrength: 0.5, recognitionLevel: 0.5, resolutionLevel: 0.5 },
                            position: { epistemic: [0.5, 0.5, 0] },
                            trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [0.5, 0.5, 0] },
                            realmContributions: [],
                            branchInfluences: [],
                            hiddenStateInfluences: [],
                            relationships: [],
                            lifecycle: { status: "active" as const, decayRate: 0 },
                            provenance: { sourceSystem: "data-tool", ingestedAt: now },
                            createdAt: now,
                            updatedAt: now
                        });
                    }

                    const predictionContext = { id: predictionContextId, sessionId: "session-1", mode: "realtime" as const, createdAt: now };
                    const quantField = {
                        id: randomUUID(),
                        contextId: predictionContextId,
                        quantCount: activeQuants.length,
                        fieldDensity: activeQuants.length,
                        fieldMomentum: [0, 0, 0],
                        fieldEntropy: 0.5,
                        fieldAlignment: 0.5,
                        fieldDivergence: 0.35,
                        fieldCoherence: 0.5,
                        epistemicCenterOfMass: [0.5, 0.5, 0.2],
                        dominantStatus: "known_unknown" as const,
                        topAttractors: [],
                        collapseProbability: 0.1,
                        createdAt: now,
                    };
                    const realmResults = {
                        contextId: predictionContextId,
                        executionPlan: { id: randomUUID(), mode: "realtime" as const, orderedRealms: [], skippedRealms: [], parallelGroups: [], timeoutMs: 100, createdAt: now },
                        contributions: [],
                        branchInfluences: [],
                        hiddenStateInfluences: [],
                        quantRelationships: [],
                        agreement: undefined,
                        conflicts: [],
                        warnings: [],
                        trace: { id: randomUUID(), contextId: predictionContextId, startedAt: now, completedAt: now, durationMs: 0, realmRuns: [] },
                    };
                    const domainCtx = {
                        mode: "realtime" as const,
                        now,
                        requestId: randomUUID(),
                        correlationId: randomUUID(),
                        organizationId: (context as any)?.organizationId,
                        userId: (context as any)?.userId,
                    };

                    // Estimate Hidden State
                    const stateEstimate = await hiddenStatePod.estimate({
                        context: predictionContext,
                        activeQuants,
                        quantField,
                        realmResults,
                        memoryResults: [],
                        mode: "realtime"
                    }, domainCtx);

                    // Generate Predictions
                    const predictionResult = await predictionPod.generatePredictions({
                        mode: "realtime",
                        context: predictionContext,
                        quantField,
                        activeQuants,
                        realmResults,
                        hiddenState: stateEstimate,
                        memoryMatches: []
                    }, domainCtx);

                    const topPredicate = predictionResult.prediction.topPredicate;
                    const confidence = predictionResult.prediction.confidence;

                    results.push({ customerId, topPredicate, confidence, actualChurn });
                    dynamicTrace.push({ timestamp: new Date().toISOString(), message: `Prediction for ${customerId}: ${topPredicate} (Confidence: ${confidence.toFixed(2)})` });
                }

                return JSON.stringify({
                    success: true,
                    message: `Processed ${results.length} rows.`,
                    results,
                    dynamicTrace
                }, null, 2);

            } catch (error: any) {
                return `Prediction Error: ${error.message}`;
            }
        }
    }
};
