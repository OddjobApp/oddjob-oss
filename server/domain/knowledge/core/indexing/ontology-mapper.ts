import { graphService } from "../graph/graph-service.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import type { CreateNodeInput, CreateEdgeInput } from "../types.js";

const logger = createLogger("OntologyMapper");

export interface OntologyMappingSchema {
    entityType: string;
    idField: string;
    label: string;
    propertyMappings: Record<string, string>; // e.g. { "customer_name": "name" }
    relationships?: Array<{
        targetEntityType: string;
        targetIdField: string;
        relationName: string;
    }>;
    defaultSecurityClassification?: number;
}

export class OntologyMapper {
    /**
     * Map an incoming JSON payload to Knowledge Nodes and Edges based on a predefined schema.
     */
    static async mapPayload(
        payload: Record<string, any>[],
        schema: OntologyMappingSchema,
        orgContext: OrgContext,
        missionId?: number
    ): Promise<void> {
        logger.info(`Mapping ${payload.length} items to ontology [${schema.entityType}]`);
        
        for (const item of payload) {
            try {
                // 1. Extract primary fields
                const externalId = String(item[schema.idField] || crypto.randomUUID());
                const rawName = item[schema.propertyMappings['name'] || 'name'] || `${schema.entityType}_${externalId}`;
                
                // 2. Map properties
                const properties: Record<string, any> = {};
                for (const [sourceKey, targetKey] of Object.entries(schema.propertyMappings)) {
                    if (item[sourceKey] !== undefined) {
                        properties[targetKey] = item[sourceKey];
                    }
                }

                // Append full raw payload for forensic safety
                properties._raw_stream_data = item;
                
                // Inject streaming security classification (RBAC Pillar)
                properties.securityClassification = item.securityClassification || schema.defaultSecurityClassification || 1;

                // 3. Create or update the core Node
                const nodeInput: CreateNodeInput = {
                    name: rawName,
                    label: schema.label,
                    externalId: externalId,
                    properties,
                    sourceType: "streaming_ingestion",
                    missionId,
                    verificationStatus: "verified" // Streamed source of truth
                };

                const createdNode = await graphService.createNode(nodeInput, orgContext);

                // 4. Handle hierarchical relationships if specified
                if (schema.relationships && schema.relationships.length > 0) {
                    const edgesToCreate: CreateEdgeInput[] = [];
                    
                    for (const rel of schema.relationships) {
                        const targetIdVal = item[rel.targetIdField];
                        if (!targetIdVal) continue;
                        
                        // We attempt to resolve the target node by externalId using the search API or graphService
                        // For a robust implementation, we would write a specialized getByExternalId query
                        // Here we use a minimal placeholder implementation to resolve it if it exists.
                        const targetNodesResult = await graphService.searchNodes(orgContext, {
                            query: String(targetIdVal), // Usually we'd search externalId strictly
                            label: rel.targetEntityType,
                            limit: 1
                        });

                        if (targetNodesResult.nodes.length > 0) {
                            edgesToCreate.push({
                                sourceNodeId: createdNode.id,
                                targetNodeId: targetNodesResult.nodes[0].id,
                                relation: rel.relationName,
                                weight: 1.0,
                                missionId
                            });
                        }
                    }

                    if (edgesToCreate.length > 0) {
                        await graphService.createEdgesBatch(edgesToCreate, orgContext);
                    }
                }
            } catch (err) {
                logger.error(`Failed to map payload item to ontology: ${err}`);
            }
        }
    }
}
