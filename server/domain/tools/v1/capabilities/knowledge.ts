import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { requireToolOrgId } from "./org-context.js";

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

export const KNOWLEDGE_TOOLS: Record<string, ToolDefinition> = {
    // --- Knowledge Graph Tools ---
    search_knowledge_graph: {
        name: "search_knowledge_graph",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Search Graph",
        group: "Knowledge Graph",
        description: "Search for entities in the knowledge graph by name or type.",
        parameters: z.object({
            query: z.string().optional().describe("Optional: Search query for entity names"),
            entityType: z.string().optional().describe("Optional: Filter by entity type"),
            includeRelationships: z.boolean().optional().describe("Include connected entities"),
            limit: z.number().optional().describe("Result limit (max 50)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleSearchKnowledgeGraph } = await import("@server/mcp/handlers.js");
            const result = await handleSearchKnowledgeGraph(params, context);
            return extractMcpText(result);
        }
    },
    get_entity_impact: {
        name: "get_entity_impact",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Analyze Impact",
        group: "Knowledge Graph",
        description: "Analyze what entities depend on a specific entity (impact analysis).",
        parameters: z.object({
            entityName: z.string().describe("Name of the entity to analyze"),
            entityType: z.string().optional(),
            direction: z.enum(["inbound", "outbound", "both"]).optional().default("both"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetEntityImpact } = await import("@server/mcp/handlers.js");
            const result = await handleGetEntityImpact(params, context);
            return extractMcpText(result);
        }
    },
    explore_relationships: {
        name: "explore_relationships",

        idempotency: "read-safe",
        label: "Explore Relationships",
        group: "Knowledge Graph",
        description: "Traverse the knowledge graph from a starting entity to explore its connections. Use this to 'walk' the graph deeply.",
        parameters: z.object({
            entityName: z.string().describe("Name of the starting entity"),
            depth: z.number().min(1).max(3).default(1).describe("Traversal depth (1-3)"),
            direction: z.enum(["inbound", "outbound", "both"]).default("both"),
            relations: z.array(z.string()).optional().default([]).describe("Optional: Filter by relation types"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleExploreRelationships } = await import("@server/mcp/handlers.js");
            const result = await handleExploreRelationships(params, context);
            return extractMcpText(result);
        }
    },
    get_graph_statistics: {
        name: "get_graph_statistics",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Graph Stats",
        group: "Knowledge Graph",
        description: "Get statistics about the knowledge graph (entity counts, relationship counts).",
        parameters: z.object({}),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetGraphStatistics } = await import("@server/mcp/handlers.js");
            const result = await handleGetGraphStatistics(params, context);
            return extractMcpText(result);
        }
    },
    create_entity: {
        name: "create_entity",

        idempotency: "none",
        label: "Create Entity",
        group: "Knowledge Graph",
        adminOnly: true,
        description: "Create a new entity in the knowledge graph. Requires admin permissions.",
        parameters: z.object({
            name: z.string().describe("Entity name"),
            entityType: z.string().describe("Type of entity (e.g., Service, Database, API)"),
            externalId: z.string().optional(),
            properties: z.record(z.any()).optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to create entities.";
            }
            // The MCP handlers resolve a missing or null org to ODDJOB_ORG_ID || 1.
            requireToolOrgId(context);
            const { handleCreateEntity } = await import("@server/mcp/handlers.js");
            const result = await handleCreateEntity(params, context);
            return extractMcpText(result);
        }
    },
    create_relationship: {
        name: "create_relationship",

        idempotency: "none",
        label: "Create Relationship",
        group: "Knowledge Graph",
        adminOnly: true,
        description: "Create a relationship between two entities. Requires admin permissions.",
        parameters: z.object({
            sourceEntityName: z.string().describe("Name of the source entity"),
            targetEntityName: z.string().describe("Name of the target entity"),
            relationType: z.string().describe("Type of relationship (e.g., DEPENDS_ON, USES, OWNS)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to create relationships.";
            }
            requireToolOrgId(context);
            const { handleCreateRelationship } = await import("@server/mcp/handlers.js");
            const result = await handleCreateRelationship(params, context);
            return extractMcpText(result);
        }
    },
    suggest_schema: {
        name: "suggest_schema",

        idempotency: "read-safe",
        label: "Suggest Schema",
        group: "Knowledge Graph",
        adminOnly: true,
        description: "Use AI to suggest a knowledge graph schema for a given domain. Requires admin permissions.",
        parameters: z.object({
            domainDescription: z.string().describe("Description of the domain to model"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to suggest schemas.";
            }
            requireToolOrgId(context);
            const { handleSuggestSchema } = await import("@server/mcp/handlers.js");
            const result = await handleSuggestSchema(params, context);
            return extractMcpText(result);
        }
    },
    get_documents_for_entity: {
        name: "get_documents_for_entity",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Entity Docs",
        group: "Knowledge Graph",
        description: "Find documents and technical specifications linked to a specific entity in the knowledge graph.",
        parameters: z.object({
            entityId: z.number().optional().describe("ID of the entity (node)"),
            entityName: z.string().optional().describe("Alternatively, the name of the entity"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { db } = await import("@server/database_service.js");
                const { knowledgeNodes, knowledgeDocuments } = await import("@shared/schema/index.js");
                const { eq, and, ilike, sql } = await import("drizzle-orm");

                let nodeId = params.entityId;
                if (!nodeId && params.entityName) {
                    const [foundNode] = await db.select({ id: knowledgeNodes.id }).from(knowledgeNodes)
                        .where(and(
                            eq(knowledgeNodes.organizationId, (context as any)?.organizationId || 0),
                            ilike(knowledgeNodes.name, params.entityName)
                        )).limit(1);
                    if (foundNode) nodeId = foundNode.id;
                }

                if (!nodeId) return "Entity not found.";

                // 1. Direct link on node
                const [node] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
                const docs: any[] = [];

                if (node?.knowledgeDocumentId) {
                    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, node.knowledgeDocumentId)).limit(1);
                    if (doc) docs.push(doc);
                }

                // 2. Mentions in metadata (from enrichment)
                const mentionedDocs = await db.select()
                    .from(knowledgeDocuments)
                    .where(and(
                        eq(knowledgeDocuments.organizationId, (context as any)?.organizationId || 0),
                        sql`${knowledgeDocuments.metadata}->'linkedNodeIds' @> ${JSON.stringify([nodeId])}::jsonb`
                    ))
                    .limit(10);

                mentionedDocs.forEach((d: any) => {
                    if (!docs.some(existing => existing.id === d.id)) docs.push(d);
                });

                if (docs.length === 0) return `No documents found linked to '${node?.name || params.entityName || nodeId}'.`;

                return `Found ${docs.length} documents for entity:\n` + docs.map(d =>
                    `- **${d.title}** (ID: ${d.id}, Source: ${d.sourceType}): ${d.url || 'No URL available'}`
                ).join("\n");
            } catch (e: any) {
                return `Error fetching documents: ${e.message}`;
            }
        }
    },
    get_entity_details: {
        name: "get_entity_details",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Entity Details",
        group: "Knowledge Graph",
        description: "Get full details, properties, and linked documents for a specific entity by its ID.",
        parameters: z.object({
            entityId: z.number().describe("Numerical ID of the entity"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { graphService } = await import("@domain/knowledge/core/graph/graph-service.js");
                const node = await graphService.getNodeById(params.entityId, { organizationId: (context as any)?.organizationId || 0 } as any);

                let docLink = "";
                if (node.knowledgeDocumentId) {
                    docLink = `\n- Linked Document ID: ${node.knowledgeDocumentId}`;
                }

                return `### Entity: ${node.name} (${node.label})\n` +
                    `- ID: ${node.id}\n` +
                    `- External ID: ${node.externalId || 'None'}\n` +
                    `${docLink}\n\n` +
                    `#### Properties:\n` + JSON.stringify(node.data, null, 2);
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        }
    },

    // --- Document Tools ---
    //
    // `search_documents` used to be defined here. It could never run: TOOL_ALIASES
    // maps that name to `search_unified_knowledge`, and BOTH resolution points —
    // agent-runner.ts:25 at setup and tool-executor.service.ts:22 at dispatch —
    // consult the alias table before the registry. The alias is the right call,
    // since search_unified_knowledge covers documentation, datasets and the graph
    // and takes `filter_source: "documentation"` for exactly this case. Only the
    // unreachable definition is gone; the name still works, and the MCP server
    // keeps its own handleSearchDocuments route.
    list_documents: {
        name: "list_documents",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Documents",
        group: "Knowledge Management",
        description: "List all documents in the knowledge base.",
        parameters: z.object({
            search: z.string().optional(),
            limit: z.number().optional().default(20).describe("Max 100"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleListDocuments } = await import("@server/mcp/handlers.js");
            const result = await handleListDocuments(params, context);
            return extractMcpText(result);
        }
    },
    get_document_content: {
        name: "get_document_content",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Document Content",
        group: "Knowledge Management",
        description: "Get the full content of a specific document.",
        parameters: z.object({
            documentId: z.number().describe("ID of the document"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetDocumentContent } = await import("@server/mcp/handlers.js");
            const result = await handleGetDocumentContent(params, context);
            return extractMcpText(result);
        }
    },

    // --- Document Template Tools ---
    get_document_template: {
        name: "get_document_template",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Document Template",
        group: "Knowledge Management",
        description: "Get the full content of a document template. Use this when a user asks for an example report, test plan, or any templated document format.",
        parameters: z.object({
            templateId: z.number().optional().describe("ID of the template"),
            templateName: z.string().optional().describe("Name of the template (fuzzy match)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { documentTemplateService } = await import("@domain/knowledge/index.js");
                const { db } = await import("@server/database_service.js");
                const { documentTemplates } = await import("@shared/schema/index.js");
                const { eq, and, ilike } = await import("drizzle-orm");

                let template;

                if (params.templateId) {
                    template = await documentTemplateService.getById(params.templateId, context?.organizationId || 0);
                } else if (params.templateName) {
                    // Fuzzy search by name
                    const [found] = await db.select()
                        .from(documentTemplates)
                        .where(and(
                            eq(documentTemplates.organizationId, context?.organizationId || 0),
                            ilike(documentTemplates.name, `%${params.templateName}%`)
                        ))
                        .limit(1);
                    template = found;
                }

                if (!template) {
                    return `Document template not found. Please provide a valid templateId or templateName.`;
                }

                // Get resolved content (handles both direct content and knowledge-document references)
                const content = await documentTemplateService.getResolvedContent(template);

                return `# ${template.name}\n**Type:** ${template.type}\n**Category:** ${template.category || 'General'}\n\n---\n\n${content}`;
            } catch (e: any) {
                return `Error fetching document template: ${e.message}`;
            }
        }
    },

    list_document_templates: {
        name: "list_document_templates",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Document Templates",
        group: "Knowledge Management",
        description: "List all available document templates for the organization. Use this to show users what templates they can use.",
        parameters: z.object({
            category: z.string().optional().describe("Filter by category"),
            type: z.string().optional().describe("Filter by type (markdown, pdf, excel, etc.)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { documentTemplateService } = await import("../../../knowledge/index.js");

                const templates = await documentTemplateService.list(context?.organizationId || 0);

                if (templates.length === 0) {
                    return "No document templates found for this organization.";
                }

                let filtered = templates;
                if (params.category) {
                    filtered = filtered.filter((t: any) => t.category?.toLowerCase().includes(params.category!.toLowerCase()));
                }
                if (params.type) {
                    filtered = filtered.filter((t: any) => t.type.toLowerCase() === params.type!.toLowerCase());
                }

                const templateList = filtered.map(t =>
                    `- **${t.name}** (ID: ${t.id}, Type: ${t.type}): ${t.description || 'No description'}`
                ).join("\n");

                return `## Available Document Templates\n\n${templateList}`;
            } catch (e: any) {
                return `Error listing document templates: ${e.message}`;
            }
        }
    },
    // --- Concept Tools ---
    list_concepts: {
        name: "list_concepts",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Concepts",
        group: "Knowledge Graph",
        description: "List all high-level semantic concepts defined in the knowledge graph. These group granular topics together.",
        parameters: z.object({}),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { conceptService } = await import("@domain/knowledge/core/graph/concept-service.js");
                const concepts = await conceptService.listConcepts(context as any);
                if (concepts.length === 0) return "No concepts discovered yet. Try running 'auto_link_concepts' or ingest more data.";
                return concepts.map(c => `- **${c.name}**: ${c.description || 'No description'}`).join("\n");
            } catch (e: any) {
                return `Error listing concepts: ${e.message}`;
            }
        }
    },
    get_concept_topics: {
        name: "get_concept_topics",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Concept Topics",
        group: "Knowledge Graph",
        description: "Get all granular topics associated with a specific high-level concept.",
        parameters: z.object({
            conceptName: z.string().describe("Name of the concept to explore")
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { db } = await import("@server/database_service.js");
                const { knowledgeConcepts, knowledgeTopicConcepts, knowledgeTopics } = await import("@shared/schema/index.js");
                const { eq, and, ilike } = await import("drizzle-orm");

                const [concept] = await db.select().from(knowledgeConcepts).where(
                    and(
                        eq(knowledgeConcepts.organizationId, context?.organizationId || 0),
                        ilike(knowledgeConcepts.name, params.conceptName)
                    )
                ).limit(1);

                if (!concept) return `Concept '${params.conceptName}' not found.`;

                const topics = await db.select({ name: knowledgeTopics.name })
                    .from(knowledgeTopicConcepts)
                    .innerJoin(knowledgeTopics, eq(knowledgeTopicConcepts.topicId, knowledgeTopics.id))
                    .where(eq(knowledgeTopicConcepts.conceptId, concept.id));

                if (topics.length === 0) return `No topics mapped to concept '${concept.name}' yet.`;
                return `Topics in '${concept.name}':\n` + topics.map(t => `- ${t.name}`).join("\n");
            } catch (e: any) {
                return `Error fetching concept topics: ${e.message}`;
            }
        }
    },
    get_concept_governance: {
        name: "get_concept_governance",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Concept Governance",
        group: "Knowledge Graph",
        description: "Get governance policies and rules associated with a specific high-level concept.",
        parameters: z.object({
            conceptName: z.string().describe("Name of the concept")
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { db } = await import("@server/database_service.js");
                const { knowledgeConcepts, knowledgePolicyConstraints, governorPolicyRules } = await import("@shared/schema/index.js");
                const { eq, and, ilike } = await import("drizzle-orm");

                const [concept] = await db.select().from(knowledgeConcepts).where(
                    and(
                        eq(knowledgeConcepts.organizationId, context?.organizationId || 0),
                        ilike(knowledgeConcepts.name, params.conceptName)
                    )
                ).limit(1);

                if (!concept) return `Concept '${params.conceptName}' not found.`;

                const rules = await db.select({
                    name: governorPolicyRules.type,
                    config: governorPolicyRules.configuration,
                    severity: knowledgePolicyConstraints.severity
                })
                    .from(knowledgePolicyConstraints)
                    .innerJoin(governorPolicyRules, eq(knowledgePolicyConstraints.policyRuleId, governorPolicyRules.id))
                    .where(eq(knowledgePolicyConstraints.conceptId, concept.id));

                if (rules.length === 0) return `No governance policies linked to concept '${concept.name}'.`;

                return `Governance Rules for '${concept.name}':\n` +
                    rules.map(r => `- **${r.name}** [${r.severity}]: ${JSON.stringify(r.config)}`).join("\n");
            } catch (e: any) {
                return `Error fetching concept governance: ${e.message}`;
            }
        }
    },
    get_concept_smes: {
        name: "get_concept_smes",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Concept SMEs",
        group: "Knowledge Graph",
        description: "Get the Subject Matter Experts (SMEs) for a specific high-level concept.",
        parameters: z.object({
            conceptName: z.string().describe("Name of the concept")
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { db } = await import("@server/database_service.js");
                const { knowledgeConcepts, knowledgeSmes } = await import("@shared/schema/index.js");
                const { eq, and, ilike } = await import("drizzle-orm");

                const [concept] = await db.select().from(knowledgeConcepts).where(
                    and(
                        eq(knowledgeConcepts.organizationId, context?.organizationId || 0),
                        ilike(knowledgeConcepts.name, params.conceptName)
                    )
                ).limit(1);

                if (!concept) return `Concept '${params.conceptName}' not found.`;

                const smes = await db.select().from(knowledgeSmes).where(eq(knowledgeSmes.conceptId, concept.id));

                if (smes.length === 0) return `No SMEs identified for concept '${concept.name}' yet.`;

                return `SMEs for '${concept.name}':\n` +
                    smes.map(s => `- **${s.userId}** (${s.level})`).join("\n");
            } catch (e: any) {
                return `Error fetching concept SMEs: ${e.message}`;
            }
        }
    },
    learn_lesson: {
        name: "learn_lesson",

        idempotency: "none",
        label: "Learn Lesson",
        group: "Knowledge Management",
        description: "Persist a 'Lesson Learned' or strategic insight discovered during a mission. Use this to update the Agency Intelligence base.",
        parameters: z.object({
            missionId: z.number().describe("ID of the current mission"),
            content: z.string().describe("The insight or lesson content (markdown)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { knowledgeService } = await import("@domain/knowledge/knowledge.service.js");
                const result = await knowledgeService.curateLesson(params.missionId, params.content, context as any);
                return `Lesson persisted successfully. Document ID: ${result.documentId}. Linked to Agency Intelligence.`;
            } catch (e: any) {
                return `Error persisting lesson: ${e.message}`;
            }
        }
    },
    publish_wiki_article: {
        name: "publish_wiki_article",

        idempotency: "idempotent",
        label: "Publish Wiki Article",
        group: "Knowledge Management",
        description: "Publish a formal, structured article to the Organizational Memory Wiki. Use this for substantial research findings, technical guides, or operational truth discovered during a mission.",
        parameters: z.object({
            title: z.string().describe("The professional title of the wiki article."),
            content: z.string().describe("The full article content in Markdown format."),
            category: z.string().optional().describe("Optional: Semantic category (e.g., 'Market Intelligence', 'Technical Specs')"),
            missionId: z.number().optional().describe("Optional: Link to a specific mission run"),
            topicNames: z.array(z.string()).optional().default([]).describe("Optional: Additional topics to link this article to.")
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { knowledgeService } = await import("@domain/knowledge/knowledge.service.js");
                const docInput = {
                    title: params.title,
                    textContent: params.content,
                    sourceType: "wiki_article",
                    metadata: { 
                        missionId: params.missionId, 
                        category: params.category,
                        publisher: "agent",
                        publishedAt: new Date().toISOString()
                    },
                    topicNames: ["Agency Intelligence", ...(params.topicNames || [])]
                };

                const document = await (knowledgeService as any).createDocument(docInput, context as any);
                return `Wiki article '${params.title}' published successfully to the Knowledge Graph. Document ID: ${document.id}.`;
            } catch (e: any) {
                return `Error publishing wiki article: ${e.message}`;
            }
        }
    },
    generate_diagnostic_questions: {
        name: "generate_diagnostic_questions",

        idempotency: "read-safe",
        label: "Generate Diagnostic Questions",
        group: "Knowledge Management",
        description: "Dynamically generate highly specific troubleshooting questions for a physical asset based on its type and reported problem.",
        parameters: z.object({
            assetType: z.string().describe("The type of asset (e.g., Forklift, Coffee Machine, HVAC)"),
            problemDescription: z.string().describe("The problem reported by the user"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const { knowledgeBaseQuestionEngineService } = await import("@domain/agents/core/knowledge-base-question-engine.service.js");
                const questions = await knowledgeBaseQuestionEngineService.generateAssetDiagnosticQuestions(
                    params.assetType,
                    params.problemDescription,
                    requireToolOrgId(context as any)
                );
                
                return `Based on the asset type (${params.assetType}) and problem (${params.problemDescription}), the Knowledge Base Question Engine suggests asking the user these questions:\n` +
                    questions.map(q => `- ${q}`).join("\n");
            } catch (e: any) {
                return `Error generating diagnostic questions: ${e.message}`;
            }
        }
    },
    import_huggingface_dataset: {
        name: "import_huggingface_dataset",

        idempotency: "none",
        label: "Import HuggingFace Dataset",
        group: "Knowledge Management",
        description: "Import a dataset from the Hugging Face Hub directly into Oddjob's fine-tuning system.",
        parameters: z.object({
            dataset: z.string().describe("The Hugging Face dataset name (e.g. 'iioos/agent-tool-usage' or 'Salesforce/xlam-function-calling-60k')"),
            config: z.string().optional().describe("Optional dataset configuration/subset name (often 'default' or same as dataset name)"),
            split: z.string().optional().default("train").describe("Optional dataset split (default: 'train')"),
            inputColumn: z.string().optional().describe("Optional column name for prompts/inputs. If omitted, will be auto-detected."),
            outputColumn: z.string().optional().describe("Optional column name for completions/outputs. If omitted, will be auto-detected."),
            limit: z.number().optional().default(50).describe("Maximum number of rows to import (max 100, default: 50)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const limit = Math.min(params.limit || 50, 100);
                const configName = params.config || "default";
                const splitName = params.split || "train";
                
                // 1. Fetch from Hugging Face Datasets Server
                const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(params.dataset)}&config=${encodeURIComponent(configName)}&split=${encodeURIComponent(splitName)}&offset=0&limit=${limit}`;
                
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch from Hugging Face Datasets API (HTTP ${response.status}): ${await response.text()}`);
                }
                
                const data = (await response.json()) as any;
                if (!data.rows || !Array.isArray(data.rows) || data.rows.length === 0) {
                    throw new Error(`No rows returned for dataset '${params.dataset}' under config '${configName}' and split '${splitName}'.`);
                }
                
                // 2. Auto-detect columns if not specified
                const firstRow = data.rows[0]?.row;
                if (!firstRow) {
                    throw new Error("Dataset response contained empty rows.");
                }
                
                const keys = Object.keys(firstRow);
                let inCol = params.inputColumn;
                let outCol = params.outputColumn;
                
                if (!inCol) {
                    const inputCandidates = ["prompt", "input", "instruction", "query", "question", "user", "text"];
                    inCol = inputCandidates.find(c => keys.includes(c)) || keys[0];
                }
                if (!outCol) {
                    const outputCandidates = ["completion", "output", "response", "answer", "chosen", "assistant", "label"];
                    outCol = outputCandidates.find(c => keys.includes(c) && c !== inCol) || keys.find(k => k !== inCol);
                }
                
                if (!inCol || !outCol) {
                    throw new Error("Could not determine input and output columns from the dataset features.");
                }
                
                // 3. Map examples
                const examplesToImport = data.rows.map((r: any) => {
                    const row = r.row;
                    
                    // Specific handling for conversations/messages/trajectory arrays
                    if (row.conversations && Array.isArray(row.conversations)) {
                        const userMsg = row.conversations.find((m: any) => m.role === 'user')?.text || "";
                        const aiMsg = row.conversations.find((m: any) => m.role === 'ai')?.text || "";
                        if (userMsg && aiMsg) {
                            return { input: userMsg, output: aiMsg };
                        }
                    }
                    if (row.trajectory && Array.isArray(row.trajectory)) {
                        const userMsg = row.trajectory.find((m: any) => m.role === 'user')?.text || "";
                        const aiMsg = row.trajectory.find((m: any) => m.role === 'ai')?.text || "";
                        if (userMsg && aiMsg) {
                            return { input: userMsg, output: aiMsg };
                        }
                    }
                    if (row.messages && Array.isArray(row.messages)) {
                        const userMsg = row.messages.find((m: any) => m.role === 'user' || m.role === 'human')?.content || "";
                        const assistantMsg = row.messages.find((m: any) => m.role === 'assistant' || m.role === 'ai' || m.role === 'model')?.content || "";
                        if (userMsg && assistantMsg) {
                            return { input: userMsg, output: assistantMsg };
                        }
                    }
                    if (row.chosen && Array.isArray(row.chosen)) {
                        const userMsg = row.chosen.find((m: any) => m.role === 'user' || m.role === 'human')?.content || "";
                        const assistantMsg = row.chosen.find((m: any) => m.role === 'assistant' || m.role === 'ai' || m.role === 'model')?.content || "";
                        if (userMsg && assistantMsg) {
                            return { input: userMsg, output: assistantMsg };
                        }
                    }
                    if (row.question && row.answers && typeof row.answers === "object") {
                        const answerText = Array.isArray(row.answers.text) ? row.answers.text[0] : (row.answers.text || "");
                        if (answerText) {
                            const contextPart = row.context ? `Context: ${row.context}\n\n` : "";
                            return {
                                input: `${contextPart}Question: ${row.question}`,
                                output: String(answerText)
                            };
                        }
                    }
                    if (row.prompt && row.response_0 && row.response_1 && (row.safer_response_id === 0 || row.safer_response_id === 1)) {
                        const saferResponse = row.safer_response_id === 0 ? row.response_0 : row.response_1;
                        if (saferResponse) {
                            return {
                                input: String(row.prompt),
                                output: String(saferResponse)
                            };
                        }
                    }

                    const inputVal = row[inCol || ""];
                    const outputVal = row[outCol || ""];
                    
                    return {
                        input: typeof inputVal === "object" ? JSON.stringify(inputVal) : String(inputVal ?? ""),
                        output: typeof outputVal === "object" ? JSON.stringify(outputVal) : String(outputVal ?? ""),
                    };
                }).filter((ex: any) => ex.input.trim() && ex.output.trim());
                
                if (examplesToImport.length === 0) {
                    throw new Error(`Failed to map any examples using columns: input='${inCol}', output='${outCol}'.`);
                }
                
                // 4. Resolve or create dataset
                const { fineTuningService } = await import("@domain/ai/core/fine-tuning.service.js");
                const orgId = requireToolOrgId(context as any);
                const datasetName = `HF: ${params.dataset}`;
                const datasetDescription = `Imported from Hugging Face: ${params.dataset} (split: ${splitName}, config: ${configName}). Columns used: input='${inCol}', output='${outCol}'.`;
                
                const allDatasets = await fineTuningService.listDatasets(orgId);
                let dataset: any = allDatasets.find((d: any) => d.name === datasetName);
                if (!dataset) {
                    dataset = await fineTuningService.createDataset({
                        name: datasetName,
                        description: datasetDescription,
                    }, orgId, (context as any)?.userId || "system");
                }
                
                if (!dataset) {
                    throw new Error(`Failed to create or resolve dataset '${datasetName}'.`);
                }
                
                // 5. Import examples
                const count = await fineTuningService.importExamples(dataset.id, examplesToImport, orgId);
                
                return `Successfully imported ${count} examples from Hugging Face dataset '${params.dataset}' into Oddjob dataset '${dataset.name}' (ID: ${dataset.id}).\n` +
                       `Auto-detected Columns: Input='${inCol}', Output='${outCol}'.`;
            } catch (e: any) {
                return `Error importing Hugging Face dataset: ${e.message}`;
            }
        }
    },
};
