import * as schema from "@shared/schema/index.js";
import { embedKnowledgeNode, searchNodesSemantically } from "@server/knowledge/knowledge-graph-service.js";
import { KnowledgeNode, jobTypes } from "@shared/schema/index.js";
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";

// Helper to recursively scan directories
async function scanDirectory(dir: string, extension: string = '.tsx'): Promise<string[]> {
    const files: string[] = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...await scanDirectory(fullPath, extension));
            } else if (entry.name.endsWith(extension)) {
                files.push(fullPath);
            }
        }
    } catch (error) {
        // Directory might not exist, strictly ignore
        return [];
    }
    return files;
}

/**
 * System Ingestion Service
 * 
 * Introspects the system architecture and ingests it into the Knowledge Graph
 * so the Agent can understand its own capabilities.
 */
export const systemIngestionService = {

    /**
     * Ingests the Database Schema into the Knowledge Graph
     * Creates nodes for Tables and Columns
     */
    async ingestDatabaseSchema(organizationId: number = 1) { // Default to org 1 for system knowledge
        console.log("[System Ingestion] Ingesting Database Schema...");

        const tables = Object.entries(schema).filter(([key, value]) => {
            // Filter for Drizzle table objects (they usually have a specific structure)
            return value && typeof value === 'object' && 'pg_class_name' in (value as any) === false && '_' in (value as any);
        });

        for (const [tableName, tableObj] of tables) {
            // 1. Create Table Node
            await this.createOrUpdateNode({
                name: tableName,
                label: "Database Table",
                data: {
                    description: `System table: ${tableName}`,
                    source: "system_introspection",
                    type: "table"
                },
                organizationId
            });

            // 2. Introspect Columns (if possible from the Drizzle object)
            // Note: Drizzle objects are complex, simplified introspection here
            try {
                // @ts-ignore - Accessing internal properties of Drizzle table
                const columns = Object.keys(tableObj);
                for (const colName of columns) {
                    if (colName === '_' || colName === 'getSQL') continue;

                    await this.createOrUpdateNode({
                        name: `${tableName}.${colName}`,
                        label: "Database Column",
                        data: {
                            description: `Column ${colName} in table ${tableName}`,
                            table: tableName,
                            source: "system_introspection"
                        },
                        organizationId
                    });

                    // Link Column -> Table
                    // (Edge creation logic assumes nodes exist and we can find them, 
                    // implementation details of edges would go here if we had an edge service exposed)
                }
            } catch (err) {
                console.warn(`[System Ingestion] Could not fully examine columns for ${tableName}`, err);
            }
        }

        console.log(`[System Ingestion] Processed ${tables.length} tables.`);
    },


    /**
     * Ingests Available Job Types
     */
    async ingestJobTypes(organizationId: number = 1) {
        console.log("[System Ingestion] Ingesting Job Types...");

        // Import descriptions from system-context-service to avoid duplication
        const { JOB_DESCRIPTIONS } = await import("@domain/admin/core/system-context.service.js");

        for (const type of jobTypes) {
            const description = JOB_DESCRIPTIONS[type] || `Automation Job Type: ${type}.`;

            await this.createOrUpdateNode({
                name: type,
                label: "Job Type",
                data: {
                    description: description,
                    source: "system_introspection",
                    usage: `Create a job with type '${type}' to perform this action.`
                },
                organizationId
            });
        }
    },


    /**
     * Helper to create or update a node in the KG
     */
    async createOrUpdateNode(nodeData: Partial<KnowledgeNode> & { name: string, organizationId: number }) {
        // 1. Check if exists
        const existing = await db.select().from(knowledgeNodes).where(
            and(
                eq(knowledgeNodes.name, nodeData.name),
                eq(knowledgeNodes.organizationId, nodeData.organizationId),
                eq(knowledgeNodes.label, nodeData.label || "System Entity") // Match on label too to avoid collisions
            )
        ).limit(1);

        // --- NEW: Temporal Metadata Extraction ---
        let sourceCreatedAt = (nodeData as any).sourceCreatedAt;
        let sourceUpdatedAt = (nodeData as any).sourceUpdatedAt;
        
        if (!sourceCreatedAt || !sourceUpdatedAt) {
            const data = nodeData.data as any;
            if (data) {
                if (nodeData.label === "Jira Issue") {
                    if (data.created) sourceCreatedAt = new Date(data.created);
                    if (data.updated) sourceUpdatedAt = new Date(data.updated);
                } else if (nodeData.label === "Confluence Page") {
                    if (data.createdDate) sourceCreatedAt = new Date(data.createdDate);
                    if (data.lastUpdated) sourceUpdatedAt = new Date(data.lastUpdated);
                    else if (data.version?.when) sourceUpdatedAt = new Date(data.version.when);
                } else if (nodeData.label === "Slack Message") {
                    if (data.ts) sourceCreatedAt = new Date(parseFloat(data.ts) * 1000);
                }
            }
        }

        const finalUpdateData = {
            ...nodeData,
            sourceCreatedAt: sourceCreatedAt || (nodeData as any).sourceCreatedAt,
            sourceUpdatedAt: sourceUpdatedAt || sourceCreatedAt || (nodeData as any).sourceUpdatedAt,
            updatedAt: new Date()
        };

        let nodeId: number;
        if (existing.length > 0) {
            // Update
            nodeId = existing[0].id;
            await db.update(knowledgeNodes).set(finalUpdateData).where(eq(knowledgeNodes.id, nodeId));

            // If the incoming data is meaningfully different from what was stored,
            // flag as a potential contradiction so a human can confirm the update is authoritative.
            const existingContent = JSON.stringify(existing[0].data || {});
            const newContent = JSON.stringify(nodeData.data || {});
            const contentDrifted = existingContent !== newContent && newContent.length > 50;
            if (contentDrifted && nodeData.organizationId) {
                try {
                    const { knowledgeBaseQuestionEngineService } = await import(
                        "@domain/agents/core/knowledge-base-question-engine.service.js"
                    );
                    knowledgeBaseQuestionEngineService.createQuestion(
                        nodeData.organizationId,
                        `knowledge-graph:org-${nodeData.organizationId}`,
                        "memory_contradiction",
                        {
                            nodeId,
                            nodeName: nodeData.name,
                            nodeLabel: nodeData.label,
                            conflictingPatterns: [existing[0].name],
                            errorCategory: "knowledge_node_content_drift",
                        }
                    ).catch(() => {}); // fire-and-forget, non-blocking
                } catch (_) {}
            }
            // console.log(`Updated node: ${nodeData.name}`);
        } else {
            // Insert
            const [newNode] = await db.insert(knowledgeNodes).values({
                label: nodeData.label || "System Entity",
                data: nodeData.data || {},
                status: "active",
                ...finalUpdateData
            } as any).returning();

            nodeId = newNode.id;
            // console.log(`Created node: ${nodeData.name}`);
        }

        // 2. Embed in Qdrant
        // Re-fetch to get full object
        const finalNode = await db.query.knowledgeNodes.findFirst({
            where: eq(knowledgeNodes.id, nodeId)
        });

        if (finalNode) {
            // Background the embedding to avoid blocking the ingestion loop
            // Use a small delay to avoid hammering the AI/Qdrant service
            setTimeout(async () => {
                try {
                    await embedKnowledgeNode(finalNode);
                } catch (e) {
                    console.warn(`[System Ingestion] Failed to embed node ${nodeId} (${nodeData.name}):`, e);
                }
            }, Math.random() * 5000); // Spread across 5 seconds
        }
    },
    /**
     * Ingests Frontend Architecture (Pages, Components, Features)
     */
    async ingestFrontendArchitecture(organizationId: number = 1) {
        console.log("[System Ingestion] Ingesting Frontend Architecture...");

        // Assume running from project root
        // If cwd is server/, then ../client/src
        // If cwd is root, then ./client/src
        // Best guess normalization: check if 'client' exists in cwd, otherwise try ../
        let rootDir = process.cwd();
        let clientRoot = path.join(rootDir, "client", "src");

        try {
            await fs.access(clientRoot);
        } catch {
            // Try going up one level if we are in server/
            clientRoot = path.resolve(rootDir, "../client/src");
        }

        console.log(`[System Ingestion] resolved clientRoot: ${clientRoot}`);

        const pagesDir = path.join(clientRoot, "pages");
        const componentsDir = path.join(clientRoot, "components");
        const featuresDir = path.join(clientRoot, "features");

        // 1. Pages
        const pageFiles = await scanDirectory(pagesDir);
        for (const file of pageFiles) {
            const relativePath = path.relative(clientRoot, file);
            const pageName = path.basename(file, path.extname(file));

            await this.createOrUpdateNode({
                name: pageName,
                label: "Page",
                data: {
                    path: relativePath,
                    source: "system_introspection"
                },
                organizationId
            });

            // Analyze imports for relationships
            await this.analyzeImportsAndCreateEdges(file, pageName, "Page", organizationId);
        }

        // 2. Component Groups & Components
        try {
            const groups = await fs.readdir(componentsDir, { withFileTypes: true });
            for (const group of groups) {
                if (!group.isDirectory()) continue;

                // Create Component Group Node
                await this.createOrUpdateNode({
                    name: group.name,
                    label: "Component Group",
                    data: {
                        path: `components/${group.name}`,
                        source: "system_introspection"
                    },
                    organizationId
                });

                // Scan Components inside Group
                const groupPath = path.join(componentsDir, group.name);
                const componentFiles = await scanDirectory(groupPath);

                for (const file of componentFiles) {
                    const componentName = path.basename(file, path.extname(file));
                    if (componentName === 'index') continue;

                    await this.createOrUpdateNode({
                        name: componentName,
                        label: "Component",
                        data: {
                            path: path.relative(clientRoot, file),
                            source: "system_introspection"
                        },
                        organizationId
                    });

                    // Edge: Component Group --(CONTAINS)--> Component
                    await this.createEdge({
                        sourceName: group.name,
                        sourceLabel: "Component Group",
                        targetName: componentName,
                        targetLabel: "Component",
                        relation: "CONTAINS",
                        organizationId
                    });
                }
            }
        } catch (e) {
            console.warn("[System Ingestion] Error scanning components:", e);
        }

        // 3. Features
        try {
            const features = await fs.readdir(featuresDir, { withFileTypes: true });
            for (const feature of features) {
                if (!feature.isDirectory()) continue;

                // Create Feature Node
                await this.createOrUpdateNode({
                    name: feature.name,
                    label: "Feature",
                    data: {
                        path: `features/${feature.name}`,
                        source: "system_introspection"
                    },
                    organizationId
                });

                // Scan Feature contents (Pages, Components)
                const featurePath = path.join(featuresDir, feature.name);

                // Feature -> Pages
                const featurePages = await scanDirectory(path.join(featurePath, "pages"));
                for (const file of featurePages) {
                    const pageName = path.basename(file, path.extname(file));
                    // Create Page Node (if not exists)
                    await this.createOrUpdateNode({
                        name: pageName,
                        label: "Page",
                        data: { path: path.relative(clientRoot, file), source: "system_introspection" },
                        organizationId
                    });

                    // Edge: Feature --(PROVIDES)--> Page
                    await this.createEdge({
                        sourceName: feature.name,
                        sourceLabel: "Feature",
                        targetName: pageName,
                        targetLabel: "Page",
                        relation: "PROVIDES",
                        organizationId
                    });
                }

                // Feature -> Components
                const featureComponents = await scanDirectory(path.join(featurePath, "components"));
                if (featureComponents.length > 0) {
                    // Create a "Feature Component Group" implicitly or link to individual components
                    // Simpler: Link Feature --(PROVIDES)--> Component
                    for (const file of featureComponents) {
                        const componentName = path.basename(file, path.extname(file));
                        await this.createOrUpdateNode({
                            name: componentName,
                            label: "Component",
                            data: { path: path.relative(clientRoot, file), source: "system_introspection" },
                            organizationId
                        });

                        await this.createEdge({
                            sourceName: feature.name,
                            sourceLabel: "Feature",
                            targetName: componentName,
                            targetLabel: "Component",
                            relation: "PROVIDES",
                            organizationId
                        });
                    }
                }

                // Feature -> Job Types (Task) - Heuristic Scan
                const allFeatureFiles = await scanDirectory(featurePath, '.tsx');
                // Also scan .ts files
                allFeatureFiles.push(...await scanDirectory(featurePath, '.ts'));

                for (const file of allFeatureFiles) {
                    const content = await fs.readFile(file, 'utf-8');
                    // Simple heuristic: check for jobTypes.X or "JOB_NAME"
                    // This relies on shared schema job types
                    for (const type of jobTypes) {
                        if (content.includes(`jobTypes.${type}`) || content.includes(`"${type}"`) || content.includes(`'${type}'`)) {
                            await this.createEdge({
                                sourceName: feature.name,
                                sourceLabel: "Feature",
                                targetName: type,
                                targetLabel: "Job Type",
                                relation: "INITIATES",
                                organizationId
                            });
                        }
                    }
                }
            }
        } catch (e) {
            // Features dir might not exist
        }
    },

    /**
     * Helper to analyze imports and create edges
     */
    async analyzeImportsAndCreateEdges(filePath: string, sourceName: string, sourceLabel: string, organizationId: number) {
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.split("\n");

            for (const line of lines) {
                const importMatch = line.match(/import.*from\s+['"](.+)['"]/);
                if (importMatch) {
                    const importPath = importMatch[1];

                    // 1. Component Groups: @domain-ui/core/ui/components/<group>/...
                    const groupMatch = importPath.match(/@\/components\/([^/]+)/);
                    if (groupMatch) {
                        const groupName = groupMatch[1];
                        if (groupName !== "ui" && groupName !== sourceName) { // Exclude UI lib and self
                            await this.createEdge({
                                sourceName: sourceName,
                                sourceLabel: sourceLabel,
                                targetName: groupName,
                                targetLabel: "Component Group",
                                relation: "USES",
                                organizationId
                            });
                        }
                    }

                    // 2. Features: @/features/<feature>/...
                    const featureMatch = importPath.match(/@\/features\/([^/]+)/);
                    if (featureMatch) {
                        const featureName = featureMatch[1];
                        await this.createEdge({
                            sourceName: sourceName,
                            sourceLabel: sourceLabel,
                            targetName: featureName,
                            targetLabel: "Feature",
                            relation: "USES",
                            organizationId
                        });
                    }
                }
            }
        } catch (e) {
            console.warn(`Error analyzing imports for ${filePath}`, e);
        }
    },

    /**
     * Ingests Backend Architecture (Services, Routes, MCP)
     */
    async ingestBackendArchitecture(organizationId: number = 1) {
        console.log("[System Ingestion] Ingesting Backend Architecture...");

        let serverRoot = process.cwd();
        // Check if 'server' dir exists here
        try {
            await fs.access(path.join(serverRoot, "server"));
            serverRoot = path.join(serverRoot, "server");
        } catch {
            // Assume we are already in server or at root where server folders are direct (unlikely for standard structure)
            // If we are in 'Oddjob', and 'server' exists, we use it. 
            // If we are in 'Oddjob/server', we use cwd.
        }

        console.log(`[System Ingestion] resolved serverRoot: ${serverRoot}`);

        const servicesDir = path.join(serverRoot, "services");
        const routesDir = path.join(serverRoot, "routes");
        const mcpDir = path.join(serverRoot, "mcp", "tools");

        // 1. Services
        const serviceFiles = await scanDirectory(servicesDir, '.ts');
        for (const file of serviceFiles) {
            const serviceName = path.basename(file, '.ts');
            const relativePath = path.relative(serverRoot, file);

            await this.createOrUpdateNode({
                name: serviceName,
                label: "Service",
                data: { path: relativePath, source: "system_introspection" },
                organizationId
            });

            // Service -> Job Types (Task)
            const content = await fs.readFile(file, 'utf-8');
            for (const type of jobTypes) {
                if (content.includes(`jobTypes.${type}`) || content.includes(`"${type}"`) || content.includes(`'${type}'`)) {
                    await this.createEdge({
                        sourceName: serviceName,
                        sourceLabel: "Service",
                        targetName: type,
                        targetLabel: "Job Type",
                        relation: "HANDLES",
                        organizationId
                    });
                }
            }

            // Feature -> Service (Heuristic: Feature name in service file or vice versa)
            // This is tricky without explicit mapping. 
            // Simple heuristic: if service name contains feature name (e.g. `analytics-service` -> `analytics` feature)
            const potentialFeature = serviceName.replace("-service", "");
            // Check if that feature node exists
            const featureNode = await db.query.knowledgeNodes.findFirst({
                where: and(
                    eq(knowledgeNodes.name, potentialFeature),
                    eq(knowledgeNodes.label, "Feature"),
                    eq(knowledgeNodes.organizationId, organizationId)
                )
            });

            if (featureNode) {
                await this.createEdge({
                    sourceName: potentialFeature,
                    sourceLabel: "Feature",
                    targetName: serviceName,
                    targetLabel: "Service",
                    relation: "IMPLEMENTED_BY",
                    organizationId
                });
            }
        }

        // 2. API Routes
        const routeFiles = await scanDirectory(routesDir, '.ts');
        for (const file of routeFiles) {
            const routeName = path.basename(file, '.ts');

            await this.createOrUpdateNode({
                name: routeName,
                label: "API Route",
                data: { path: path.relative(serverRoot, file), source: "system_introspection" },
                organizationId
            });

            // API Route -> Service
            // Scan imports: import ... from "../services/xxx.js"
            const content = await fs.readFile(file, 'utf-8');
            const lines = content.split("\n");
            for (const line of lines) {
                const match = line.match(/from\s+['"]\.\.\/services\/([^'"]+)['"]/);
                if (match) {
                    const importedService = path.basename(match[1]); // e.g. "agent-service"
                    await this.createEdge({
                        sourceName: routeName,
                        sourceLabel: "API Route",
                        targetName: importedService,
                        targetLabel: "Service",
                        relation: "CALLS",
                        organizationId
                    });
                }
            }
        }

        // 3. MCP Tools
        const mcpFiles = await scanDirectory(mcpDir, '.ts');
        for (const file of mcpFiles) {
            const toolName = path.basename(file, '.ts');

            await this.createOrUpdateNode({
                name: toolName,
                label: "MCP Tool",
                data: { path: path.relative(serverRoot, file), source: "system_introspection" },
                organizationId
            });

            // MCP Tool -> Feature
            // Same heuristic: tool name approx feature name
            const potentialFeature = toolName.replace("-tool", "");
            const featureNode = await db.query.knowledgeNodes.findFirst({
                where: and(
                    eq(knowledgeNodes.name, potentialFeature),
                    eq(knowledgeNodes.label, "Feature"),
                    eq(knowledgeNodes.organizationId, organizationId)
                )
            });

            if (featureNode) {
                await this.createEdge({
                    sourceName: toolName,
                    sourceLabel: "MCP Tool",
                    targetName: potentialFeature,
                    targetLabel: "Feature",
                    relation: "SUPPORTS",
                    organizationId
                });
            }
        }
    },

    /**
     * Helper to create edge safely
     */
    async createEdge(params: { sourceName: string, sourceLabel: string, targetName: string, targetLabel: string, relation: string, organizationId: number }) {
        // Find source ID
        const source = await db.query.knowledgeNodes.findFirst({
            where: and(
                eq(knowledgeNodes.name, params.sourceName),
                eq(knowledgeNodes.label, params.sourceLabel),
                eq(knowledgeNodes.organizationId, params.organizationId)
            )
        });

        // Find target ID
        const target = await db.query.knowledgeNodes.findFirst({
            where: and(
                eq(knowledgeNodes.name, params.targetName),
                eq(knowledgeNodes.label, params.targetLabel),
                eq(knowledgeNodes.organizationId, params.organizationId)
            )
        });

        if (source && target && source.id !== target.id) {
            // Check if edge exists
            const existing = await db.query.knowledgeEdges.findFirst({
                where: and(
                    eq(knowledgeEdges.sourceId, source.id),
                    eq(knowledgeEdges.targetId, target.id),
                    eq(knowledgeEdges.relation, params.relation)
                )
            });

            if (!existing) {
                await db.insert(knowledgeEdges).values({
                    sourceId: source.id,
                    targetId: target.id,
                    relation: params.relation,
                    organizationId: params.organizationId
                });
            }
        }
    },
};



