import {
    SearchKnowledgeGraphInput,
    GetEntityImpactInput,
    CreateEntityInput,
    CreateRelationshipInput,
    SuggestSchemaInput,
    ExploreRelationshipsInput,
    PruneKnowledgeInput,
    DetectKnowledgeGapsInput,
} from "../tools/knowledge-graph.js";
import { knowledgeService, graphService, statsService } from "../../domain/knowledge/index.js";
import { memoryEvolutionService } from "../../domain/knowledge/core/evolution/memory-evolution.service.js";
import { knowledgeSynthesisService } from "../../domain/knowledge/core/evolution/knowledge-synthesis.service.js";
import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";

export async function handleSearchKnowledgeGraph(args: unknown, context?: ToolContext) {
    try {
        const input = SearchKnowledgeGraphInput.parse(args);
        const orgContext = getOrgContext(context);

        console.log(`[MCP: search_knowledge_graph] Org: ${orgContext.organizationId}, Query: "${input.query}", Type: "${input.entityType}"`);

        const { nodes, total } = await graphService.searchNodes(orgContext, {
            query: input.query,
            label: input.entityType,
            limit: input.limit,
            knowledgeTopicIds: context?.allowedTopicIds || undefined,
            datasetIds: context?.allowedDatasetIds || undefined,
            missionId: (context as any)?.missionId || undefined
        });

        console.log(`[MCP: search_knowledge_graph] Found ${nodes.length} nodes (Total: ${total}).`);

        let edges: any[] = [];
        if (input.includeRelationships && nodes.length > 0) {
            const nodeIds = nodes.map(n => n.id);
            const edgeResult = await graphService.listEdges(orgContext, {
                nodeIds,
                limit: 100
            });
            edges = edgeResult.edges;
        }

        return successResponse(
            {
                nodes: nodes.map(n => ({
                    id: n.id,
                    name: n.name,
                    type: n.label,
                    externalId: n.externalId,
                    knowledgeDocumentId: n.knowledgeDocumentId,
                    knowledgeTopicId: n.knowledgeTopicId,
                    sourceUrl: (n.data as any)?.url || (n.data as any)?.sourceRef || null,
                    properties: n.data,
                })),
                relationships: edges.map(e => ({
                    id: e.id,
                    source: e.sourceId,
                    target: e.targetId,
                    type: e.relation,
                })),
                pagination: {
                    total,
                    limit: input.limit
                }
            },
            `Found ${nodes.length} entities matching "${input.query}"${edges.length > 0 ? ` with ${edges.length} relationships` : ""}`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleGetEntityImpact(args: unknown, context?: ToolContext) {
    try {
        const input = GetEntityImpactInput.parse(args);
        const orgContext = getOrgContext(context);
        console.log(`[MCP: get_entity_impact] Org: ${orgContext.organizationId}, Name: "${input.entityName}", Type: "${input.entityType}"`);

        const { nodes } = await graphService.searchNodes(orgContext, {
            query: input.entityName,
            label: input.entityType,
            limit: 1
        });

        const targetEntity = nodes[0];

        if (!targetEntity) {
            return errorResponse(`Entity "${input.entityName}" not found`);
        }

        const directionMap: Record<string, "outgoing" | "incoming" | "both"> = {
            "inbound": "incoming",
            "outbound": "outgoing",
            "both": "both"
        };

        const traversed = await graphService.traverseGraph(targetEntity.id, orgContext, {
            depth: 1,
            direction: directionMap[input.direction || "both"] || "both"
        });

        const inboundEdges = traversed.edges.filter(e => e.targetId === targetEntity.id);
        const outboundEdges = traversed.edges.filter(e => e.sourceId === targetEntity.id);

        return successResponse(
            {
                entity: {
                    id: targetEntity.id,
                    name: targetEntity.name,
                    type: targetEntity.label,
                },
                impact: {
                    dependsOnThis: inboundEdges.length,
                    thisDependsOn: outboundEdges.length,
                    totalConnections: traversed.nodes.length - 1,
                },
                inboundRelationships: inboundEdges.map(e => {
                    const node = traversed.nodes.find(n => n.id === e.sourceId);
                    return {
                        relation: e.relation,
                        from: node ? { id: node.id, name: node.name, type: node.label } : null,
                    };
                }),
                outboundRelationships: outboundEdges.map(e => {
                    const node = traversed.nodes.find(n => n.id === e.targetId);
                    return {
                        relation: e.relation,
                        to: node ? { id: node.id, name: node.name, type: node.label } : null,
                    };
                }),
            },
            `"${targetEntity.name}" has ${inboundEdges.length} entities depending on it and depends on ${outboundEdges.length} entities`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleCreateEntity(args: unknown, context?: ToolContext) {
    try {
        const input = CreateEntityInput.parse(args);
        const orgContext = getOrgContext(context);

        const newNode = await graphService.createNode({
            name: input.name,
            label: input.entityType,
            properties: input.properties || {},
            externalId: input.externalId || null,
            scope: "private"
        }, orgContext);

        return successResponse(
            {
                id: newNode.id,
                name: newNode.name,
                type: newNode.label,
                properties: newNode.data,
            },
            `Created new ${input.entityType} entity: "${input.name}" (ID: ${newNode.id})`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleCreateRelationship(args: unknown, context?: ToolContext) {
    try {
        const input = CreateRelationshipInput.parse(args);
        const orgContext = getOrgContext(context);

        const { nodes: sourceNodes } = await graphService.searchNodes(orgContext, { query: input.sourceEntityName, limit: 1 });
        const { nodes: targetNodes } = await graphService.searchNodes(orgContext, { query: input.targetEntityName, limit: 1 });

        const sourceEntity = sourceNodes[0];
        const targetEntity = targetNodes[0];

        if (!sourceEntity) return errorResponse(`Source entity "${input.sourceEntityName}" not found`);
        if (!targetEntity) return errorResponse(`Target entity "${input.targetEntityName}" not found`);

        const newEdge = await graphService.createEdge({
            sourceNodeId: sourceEntity.id,
            targetNodeId: targetEntity.id,
            relation: input.relationType,
            weight: 1,
        }, orgContext);

        return successResponse(
            {
                id: newEdge.id,
                source: { id: sourceEntity.id, name: sourceEntity.name },
                target: { id: targetEntity.id, name: targetEntity.name },
                relation: newEdge.relation,
            },
            `Created relationship: "${sourceEntity.name}" --[${input.relationType}]--> "${targetEntity.name}"`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleSuggestSchema(args: unknown, context?: ToolContext) {
    try {
        const input = SuggestSchemaInput.parse(args);
        const orgContext = getOrgContext(context);
        const schema = await knowledgeService.suggestSchema(input.domainDescription, orgContext);
        return successResponse(schema);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleGetGraphStatistics(args: unknown, context?: ToolContext) {
    try {
        const orgContext = getOrgContext(context);
        const stats = await statsService.getStats(orgContext);
        return successResponse({
            totalEntities: stats.totalNodes,
            totalRelationships: stats.totalEdges,
            entitiesByType: stats.nodesByType,
            relationshipsByType: stats.edgesByType,
        });
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleExploreRelationships(args: unknown, context?: ToolContext) {
    try {
        const input = ExploreRelationshipsInput.parse(args);
        const orgContext = getOrgContext(context);

        // 1. Resolve start node
        const { nodes } = await graphService.searchNodes(orgContext, {
            query: input.entityName,
            limit: 1
        });

        const startNode = nodes[0];
        if (!startNode) return errorResponse(`Entity "${input.entityName}" not found`);

        const directionMap: Record<string, "outgoing" | "incoming" | "both"> = {
            "inbound": "incoming",
            "outbound": "outgoing",
            "both": "both"
        };

        // 2. Traverse
        const traversal = await graphService.traverseGraph(startNode.id, orgContext, {
            depth: input.depth,
            direction: directionMap[input.direction] || "both",
            relations: input.relations
        });

        // 3. Format Output
        // Create a map for quick node lookup
        const nodeMap = new Map(traversal.nodes.map(n => [n.id, n]));

        const formattedEdges = traversal.edges.map(e => {
            const source = nodeMap.get(e.sourceId);
            const target = nodeMap.get(e.targetId);

            return {
                relation: e.relation,
                source: source ? { id: source.id, name: source.name, type: source.label } : { id: e.sourceId },
                target: target ? { id: target.id, name: target.name, type: target.label } : { id: e.targetId },
                properties: e.data
            };
        });

        return successResponse({
            root: { id: startNode.id, name: startNode.name, type: startNode.label },
            depth: input.depth,
            foundNodes: traversal.nodes.length,
            foundEdges: traversal.edges.length,
            nodes: traversal.nodes.map(n => ({ id: n.id, name: n.name, type: n.label })),
            connections: formattedEdges
        }, `Explored ${input.depth} levels from "${startNode.name}". Found ${traversal.nodes.length} nodes and ${traversal.edges.length} connections.`);

    } catch (error: any) {
        return errorResponse(error.message);
    }
}

