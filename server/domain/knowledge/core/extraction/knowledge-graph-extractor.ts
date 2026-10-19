// @ts-nocheck
/**
 * Knowledge Graph Extractor Service
 * 
 * Extracts entities and relationships from transformed data using entity extraction rules
 */

import type { EntityRule, RelationshipRule, JobOutputSchema } from "@shared/schema/index.js";
import type { KnowledgeNode, KnowledgeEdge } from "@shared/schema/index.js";
import { knowledgeService } from "../../knowledge.service.js";
import { extractEntities, type ExtractedEntity } from "./EntityExtractor.js";
import { extractRelationships, type ExtractedRelationship } from "./RelationshipExtractor.js";
import type { ExtractionSource } from "@shared/schema/index.js";

// Re-export interfaces for consumers
export type { ExtractedEntity, ExtractedRelationship };
export { extractEntities, extractRelationships };

/**
 * Helper to create OrgContext
 */
function getOrgContext(organizationId: number, userId: string) {
  return { organizationId, userId };
}

/**
 * Create or update knowledge graph nodes from extracted entities
 */
export async function createKnowledgeGraphNodes(
  entities: ExtractedEntity[],
  organizationId: number,
  createdBy: string,
  pipelineExecutionId?: number,
  knowledgeDocumentId?: number | null,
  extractionSource: 'transformer' | 'pipeline' = 'pipeline',
  stepOrder?: number,
  jobId?: number
): Promise<KnowledgeNode[]> {
  const nodes: KnowledgeNode[] = [];
  const orgContext = getOrgContext(organizationId, createdBy);

  for (const entity of entities) {
    try {
      // Check if node already exists (by externalId if available)
      let existingNode: KnowledgeNode | null = null;

      if (entity.externalId) {
        existingNode = await knowledgeService.getNodeByExternalId(entity.label, entity.externalId, orgContext) || null;
      }

      // Prepare extraction source data
      const extractionSourceData: ExtractionSource = {
        source: extractionSource,
        stepOrder,
        timestamp: new Date().toISOString(),
        jobId,
      };

      if (existingNode) {
        // MERGE STRATEGY: Update existing node with new data
        const existingSources: ExtractionSource[] =
          (existingNode.extractionSources as any) || [];

        // Add new extraction source
        const updatedSources = [...existingSources, extractionSourceData];

        // Merge data: pipeline data takes precedence for overlapping fields
        const mergedData = {
          ...(existingNode.data as Record<string, any> || {}),
          ...entity.data, // New data overwrites
        };

        // Update node
        const updatedNode = await knowledgeService.updateNode(existingNode.id, {
          name: entity.name,
          properties: mergedData, // Map data to properties
          // Update knowledge document link if provided and not already set
          knowledgeDocumentId: knowledgeDocumentId || existingNode.knowledgeDocumentId,
          // Update pipeline execution if provided and not already set
          pipelineExecutionId: pipelineExecutionId || existingNode.pipelineExecutionId,
          // Update extraction sources
          extractionSources: updatedSources,
          // Propagate temporal metadata if available
          sourceCreatedAt: entity.sourceCreatedAt ? new Date(entity.sourceCreatedAt) : undefined,
          sourceUpdatedAt: entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : undefined,
        }, orgContext);
        if (updatedNode) {
          nodes.push(updatedNode);
        }
      } else {
        // Create new node
        const newNode = await knowledgeService.createNode({
          label: entity.label,
          name: entity.name,
          externalId: entity.externalId,
          properties: entity.data, // Map data -> properties
          knowledgeDocumentId: knowledgeDocumentId || null,
          pipelineExecutionId: pipelineExecutionId || null,
          extractionSources: [extractionSourceData],
          // Propagate temporal metadata
          sourceCreatedAt: entity.sourceCreatedAt ? new Date(entity.sourceCreatedAt) : undefined,
          sourceUpdatedAt: entity.sourceUpdatedAt ? new Date(entity.sourceUpdatedAt) : undefined,
        }, orgContext);
        nodes.push(newNode);
      }
    } catch (error) {
      console.error(`[Knowledge Graph] Error creating/updating node for entity ${entity.entityType}:`, error);
    }
  }

  return nodes;
}

/**
 * Create knowledge graph edges from extracted relationships
 */
export async function createKnowledgeGraphEdges(
  relationships: ExtractedRelationship[],
  nodes: KnowledgeNode[],
  organizationId: number,
  createdBy: string,
  pipelineExecutionId?: number
): Promise<KnowledgeEdge[]> {
  const edges: KnowledgeEdge[] = [];
  const orgContext = getOrgContext(organizationId, createdBy);

  // Create lookup map by externalId for quick node finding
  const nodeMap = new Map<string, KnowledgeNode>();
  for (const node of nodes) {
    if (node.externalId) {
      nodeMap.set(node.externalId, node);
    }
  }

  for (const rel of relationships) {
    try {
      const sourceNode = nodeMap.get(rel.sourceEntity.externalId || '');
      const targetNode = nodeMap.get(rel.targetEntity.externalId || '');

      if (!sourceNode || !targetNode) {
        console.warn(`[Knowledge Graph] Source or target node not found for relationship ${rel.relation}`);
        continue;
      }

      // Check if edge already exists
      const existingEdge = await knowledgeService.getEdgeByNodes(sourceNode.id, targetNode.id, rel.relation, orgContext);

      if (existingEdge) {
        // Update existing edge
        const updateData: any = {
          lastUpdatedByRunId: pipelineExecutionId
        };
        if (rel.weight !== undefined) updateData.weight = rel.weight;

        const updatedEdge = await knowledgeService.updateEdge(existingEdge.id, updateData, orgContext);
        if (updatedEdge) {
          edges.push(updatedEdge);
        }
      } else {
        // Create new edge
        const newEdge = await knowledgeService.createEdge({
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          relation: rel.relation,
          weight: rel.weight || 1,
        }, orgContext);

        edges.push(newEdge);
      }
    } catch (error) {
      console.error(`[Knowledge Graph] Error creating edge for relationship ${rel.relation}:`, error);
    }
  }

  return edges;
}

/**
 * Main function to extract and create knowledge graph from transformed data
 */
export async function extractAndCreateKnowledgeGraph(params: {
  data: any;
  entityRules: EntityRule[];
  relationshipRules: RelationshipRule[];
  organizationId: number | null;
  createdBy: string;
  schema?: JobOutputSchema;
  pipelineExecutionId?: number;
  knowledgeDocumentId?: number | null;
  extractionSource?: 'transformer' | 'pipeline';
  stepOrder?: number;
  jobId?: number;
}): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
  const {
    data: transformedData,
    entityRules,
    relationshipRules,
    organizationId,
    createdBy,
    schema,
    pipelineExecutionId,
    knowledgeDocumentId,
    extractionSource = 'pipeline',
    stepOrder,
    jobId,
  } = params;

  if (!organizationId) {
    throw new Error("Organization ID is required for knowledge graph extraction");
  }

  // Extract entities
  const entities = extractEntities(transformedData, entityRules, schema);

  // Extract relationships
  const relationships = extractRelationships(transformedData, relationshipRules, entities);

  // Create nodes with extraction source tracking
  const nodes = await createKnowledgeGraphNodes(
    entities,
    organizationId,
    createdBy,
    pipelineExecutionId,
    knowledgeDocumentId,
    extractionSource,
    stepOrder,
    jobId
  );

  // Create edges
  const edges = await createKnowledgeGraphEdges(relationships, nodes, organizationId, createdBy, pipelineExecutionId);

  return { nodes, edges };
}


