// @ts-nocheck
/**
 * Knowledge Graph Integration Service
 * 
 * Handles creation of knowledge graph nodes and edges from HIL form approvals/ratings and Pipeline rules.
 */

import { KnowledgeNode, InsertKnowledgeNode, KnowledgeEdge, InsertKnowledgeEdge } from "@shared/schema/index.js";
import type { KnowledgeGraphConfig, EntityRule, RelationshipRule } from "@shared/schema/knowledge-config";
import type { Job, PipelineExecution, PipelineStepExecution } from "@shared/schema/index.js";
import { query, queryOne } from "../../../../utils/json-path.js";
import { db } from "../../../../database_service.js";
import { graphSchemaDefs } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { KnowledgeExtractor } from "./knowledge-extractor.js";
import type { OrgContext } from "../../../../../utils/auth-context.js";

interface ApprovalContext {
  jobOutput: any;
  job: Job;
  pipelineExecution: PipelineExecution;
  stepExecution: PipelineStepExecution;
  formResponses: Record<string, any>;
  approvalValue?: boolean;
  ratingValue?: number;
  submitterEmail: string;
  organizationId: number | null;
}

interface ExtractedEntity {
  type: string;
  name: string;
  externalId?: string;
  data: Record<string, any>;
}

export interface ExplicitRuleContext {
  jobOutput: any;
  organizationId: number | null;
  pipelineExecutionId: number;
  knowledgeDocumentId?: number;
  creatorEmail?: string;
}

/**
 * Create knowledge graph nodes from form approval/rating
 */
export async function createKnowledgeGraphFromApproval(
  context: ApprovalContext
): Promise<KnowledgeNode[]> {
  const nodes: KnowledgeNode[] = [];
  const orgContext: OrgContext = {
    organizationId: context.organizationId,
    userId: context.submitterEmail // Use email as user ID proxy for these system actions if actual ID not available
  };

  // Extract entities from job output
  const extractedEntities = extractEntitiesFromJobOutput(
    context.jobOutput,
    context.job.type
  );

  // Create nodes for extracted entities
  const { knowledgeService } = (await import("../../knowledge.service.js")) as any;

  for (const entity of extractedEntities) {
    const nodeData: Record<string, any> = {
      ...entity.data,
      // Add approval/rating metadata
      approvalStatus: context.approvalValue,
      rating: context.ratingValue,
      approvedBy: context.submitterEmail,
      approvedAt: new Date().toISOString(),
      source: "hil_form_approval",
      jobId: context.job.id,
      jobName: context.job.name,
      pipelineExecutionId: context.pipelineExecution.id,
      stepExecutionId: context.stepExecution.id,
      formResponses: context.formResponses,
    };

    const [node] = await knowledgeService.createNodesBatch([{
      label: entity.type,
      name: entity.name,
      externalId: entity.externalId,
      properties: nodeData,
      organizationId: context.organizationId,
    } as any], orgContext);

    if (node) nodes.push(node);
  }

  // Create relationship: Submitter -> Approved Entity
  if (nodes.length > 0 && context.approvalValue === true) {
    // Get or create submitter node
    const submitterNode = await getOrCreateUserNode(
      context.submitterEmail,
      orgContext
    );

    // Create approval relationship
    const edgesToCreate = nodes.map(approvedNode => ({
      sourceNodeId: submitterNode.id,
      targetNodeId: approvedNode.id,
      relation: "APPROVED",
      weight: context.ratingValue ? Math.min(10, Math.max(1, context.ratingValue)) : 5,
    }));

    await knowledgeService.createEdgesBatch(edgesToCreate, orgContext);
  }

  return nodes;
}

/**
 * Process Explicit Knowledge Graph Rules defined in Pipeline Step
 */
export async function processExplicitKnowledgeGraphRules(
  config: KnowledgeGraphConfig,
  context: ExplicitRuleContext
): Promise<Map<string, number>> {
  const nodeMap = new Map<string, number>();
  const orgContext: OrgContext = {
    organizationId: context.organizationId,
    userId: context.creatorEmail || "system"
  };

  // ADAPTER: Ensure we are using the unified format
  ensureUnifiedConfig(config);

  if (!config.entityRules || config.entityRules.length === 0) {
    return nodeMap;
  }

  const ruleToNodes = new Map<string, Array<{ nodeId: number; data: any }>>();

  // 1. Process Entity Rules (Nodes)
  const { knowledgeService } = (await import("../../knowledge.service.js")) as any;

  for (const rule of config.entityRules) {
    try {
      const createdNodes = await processEntityRule(rule, context, orgContext, knowledgeService);
      if (createdNodes.length > 0) {
        // Link by ID first, fallback to entityType for broader matching
        const key = rule.id || rule.entityType;
        ruleToNodes.set(key, createdNodes);
        
        // Populate nodeMap for linkage
        createdNodes.forEach(cn => {
          if (cn.data?.externalId) {
            nodeMap.set(String(cn.data.externalId), cn.nodeId);
          }
        });
      }
    } catch (ruleError: any) {
      console.error(`[Knowledge Graph] Error processing rule ${rule.name || rule.entityType}:`, ruleError);
    }
  }

  // 2. Process Relationship Rules (Edges)
  if (config.relationshipRules && config.relationshipRules.length > 0) {
    await processRelationshipRules(config.relationshipRules, ruleToNodes, context, orgContext, knowledgeService);
  }

  return nodeMap;
}

/**
 * Process Semantic Enrichment (Knowledge Engine 2.0)
 * Uses configured Schema Profiles (Regex/AI) to extract entities from unstructured text context.
 */
export async function processSemanticEnrichment(
  context: ExplicitRuleContext
): Promise<Map<string, number>> {
  const nodeMap = new Map<string, number>();
  const orgContext: OrgContext = {
    organizationId: context.organizationId,
    userId: context.creatorEmail || "system"
  };

  // 1. Get Active Schemas
  const { knowledgeService } = (await import("../../knowledge.service.js")) as any;
  const schemas = await knowledgeService.getSchemaDefs(orgContext);
  const activeSchemas = schemas.filter((s: any) => s.isActive);

  if (activeSchemas.length === 0) return nodeMap;

  // 2. Identify Anchors from Job Output
  const anchors = extractEntitiesFromJobOutput(context.jobOutput, "auto");

  if (anchors.length === 0) return nodeMap;

  const extractor = new KnowledgeExtractor();

  for (const anchor of anchors) {
    // Find text content in the anchor entity - Look in common locations
    const candidates = [
      anchor.data,
      anchor.data?.data,
      anchor.data?.fields,
      anchor.data?.payload
    ];

    const collectedText: string[] = [];
    for (const obj of candidates) {
      if (obj && typeof obj === 'object') {
        const fieldsToCheck = ['description', 'summary', 'message', 'text', 'body', 'content'];
        for (const field of fieldsToCheck) {
          const val = (obj as any)[field];
          if (val) {
            if (typeof val === 'string') collectedText.push(val);
            else if (typeof val === 'object') collectedText.push(JSON.stringify(val));
          }
        }
      }
    }

    if (anchor.name && anchor.name.length > 20) {
      collectedText.push(anchor.name);
    }

    const textContent = collectedText
      .filter(t => t.length > 5)
      .join("\n\n");

    if (!textContent) continue;
    if (!anchor.externalId) continue;

    // Ensure Anchor Node Exists in Graph
    let anchorNode = await knowledgeService.getNodeByExternalId(
      anchor.type,
      anchor.externalId,
      orgContext
    );

    if (!anchorNode) {
      const [newNode] = await knowledgeService.createNodesBatch([{
        organizationId: context.organizationId,
        label: anchor.type,
        name: anchor.name,
        externalId: anchor.externalId,
        properties: anchor.data,
        pipelineExecutionId: context.pipelineExecutionId,
      } as any], orgContext);
      anchorNode = newNode;
    }

    if (anchorNode && anchor.externalId) {
      nodeMap.set(anchor.externalId, anchorNode.id);
    }

    // 3. Run Extraction against all active schemas
    const { enrichmentService } = (await import("./enrichment-service.js"));

    // Enrich Anchor Node
    if (anchorNode) {
      enrichmentService.enrichNode(anchorNode.id, context.organizationId).catch(err => 
        console.error(`[Enrichment] Failed to enrich anchor node ${anchorNode.id}:`, err)
      );
    }

    for (const schema of activeSchemas) {
      const entities = await extractor.extract(textContent, schema);

      for (const entity of entities) {
        // Create Target Node
        const targetExternalId = `sem:${entity.nodeLabel}:${entity.value}`.replace(/\s+/g, '_').toLowerCase();

        let targetNode = await knowledgeService.getNodeByExternalId(
          entity.nodeLabel,
          targetExternalId,
          orgContext
        );

        if (!targetNode) {
          const [newNode] = await knowledgeService.createNodesBatch([{
            organizationId: context.organizationId,
            label: entity.nodeLabel,
            name: entity.value,
            externalId: targetExternalId,
            properties: {
              source: entity.source,
              confidence: entity.confidence,
              schemaRule: schema.name
            },
            verificationStatus: "staging",
            pipelineExecutionId: context.pipelineExecutionId,
          } as any], orgContext);
          targetNode = newNode;

          // Enrich New Target Node
          if (targetNode) {
            enrichmentService.enrichNode(targetNode.id, context.organizationId).catch(err => 
              console.error(`[Enrichment] Failed to enrich target node ${targetNode.id}:`, err)
            );
          }
        }

        // Create Edge: Anchor -> Target
        try {
          await knowledgeService.createEdgesBatch([{
            sourceNodeId: anchorNode.id,
            targetNodeId: targetNode.id,
            relation: entity.relationship,
            weight: Math.floor(entity.confidence * 10),
            lastUpdatedByRunId: context.pipelineExecutionId,
          }], orgContext);
        } catch (edgeErr) {
          // Ignore duplicate edge errors
        }
      }
    }
  }
  return nodeMap;
}


// ==========================================
// HELPERS
// ==========================================

/**
 * Ensures the configuration follows the unified entityRules/relationshipRules structure.
 * Handles backward compatibility for legacy formats.
 */
function ensureUnifiedConfig(config: any) {
  // If we have 'rules' (legacy Explicit Rule format), move to 'entityRules'
  if (config.rules && !config.entityRules) {
    config.entityRules = config.rules.map((r: any) => ({
      id: r.ruleId,
      name: r.name,
      entityType: r.entityType,
      label: r.entityType, // Map entityType to label by default
      rootPath: r.sourceRootPath,
      mappings: {
        name: r.entityNamePath,
        externalId: r.externalIdPath,
        data: r.dataMapping
      },
      includeFullSourceData: r.includeFullSourceData
    }));
  }

  // If we have 'internalEdges' (legacy), move to 'relationshipRules'
  if (config.internalEdges && !config.relationshipRules) {
    config.relationshipRules = config.internalEdges.map((e: any) => ({
      sourceEntity: e.sourceRuleId,
      targetEntity: e.targetRuleId,
      relation: e.relationType,
      sourcePath: e.sourcePath,
      targetPath: e.targetPath,
      weight: e.weight
    }));
  }

  // Legacy frontend 'entityTypes' adapter
  if ((!config.entityRules || config.entityRules.length === 0) && config.entityTypes && Array.isArray(config.entityTypes)) {
    config.entityRules = config.entityTypes.map((et: any) => {
      const nameRule = et.extractRules?.find((r: any) => r.targetProperty === 'name' || r.targetProperty === 'label');
      const idRule = et.extractRules?.find((r: any) => r.targetProperty === 'id' || r.targetProperty === 'externalId');

      return {
        id: `gen-${et.name}`,
        name: et.name,
        entityType: et.name,
        label: et.name,
        rootPath: et.rootPath || "$",
        mappings: {
          name: nameRule?.sourceField || "$.name",
          externalId: idRule?.sourceField || "$.id",
        },
        includeFullSourceData: true
      };
    });
  }
}

async function processEntityRule(
  rule: EntityRule,
  context: ExplicitRuleContext,
  orgContext: OrgContext,
  knowledgeService: any
): Promise<Array<{ nodeId: number; data: any }>> {
  let items: any[] = [];

  const rootPath = rule.rootPath || "$";
  if (rootPath.startsWith("$")) {
    items = query(context.jobOutput, rootPath);
  } else {
    items = [context.jobOutput];
  }

  if (!items || items.length === 0) {
    console.log(`[KG Debug] No items found for path ${rootPath} in jobOutput`, JSON.stringify(context.jobOutput).substring(0, 100));
    return [];
  }

  const nodesToCreate: any[] = [];
  const createdNodes: Array<{ nodeId: number; data: any }> = [];

  for (const item of items) {
    if (!item) continue;

    const name = resolvePath(item, rule.mappings.name);
    if (!name) continue;

    const externalId = rule.mappings.externalId ? resolvePath(item, rule.mappings.externalId) : null;

    let dataPayload: Record<string, any> = {};
    if (rule.includeFullSourceData) {
      dataPayload = { ...item };
    }
    if (rule.mappings.data) {
      for (const [key, path] of Object.entries(rule.mappings.data)) {
        dataPayload[key] = resolvePath(item, path);
      }
    }
    dataPayload._source_rule = rule.name || rule.entityType;

    nodesToCreate.push({
      name: String(name),
      label: rule.label,
      externalId: externalId ? String(externalId) : undefined,
      properties: dataPayload,
      pipelineExecutionId: context.pipelineExecutionId,
      knowledgeDocumentId: context.knowledgeDocumentId,
      organizationId: orgContext.organizationId,
      extractionSources: [{ type: "pipeline_rule", ruleId: rule.id || rule.entityType }]
    });
  }

  if (nodesToCreate.length > 0) {
    const nodes = await knowledgeService.createNodesBatch(nodesToCreate as any, orgContext);

    nodes.forEach((node, idx) => {
      createdNodes.push({ nodeId: node.id, data: nodesToCreate[idx].properties });
    });
  }

  return createdNodes;
}

async function processRelationshipRules(
  relationshipRules: RelationshipRule[],
  ruleToNodes: Map<string, Array<{ nodeId: number; data: any }>>,
  context: ExplicitRuleContext,
  orgContext: OrgContext,
  knowledgeService: any
) {
  const edgesToCreate: any[] = [];

  for (const edgeConfig of relationshipRules) {
    const sourceNodes = ruleToNodes.get(edgeConfig.sourceEntity) || [];
    const targetNodes = ruleToNodes.get(edgeConfig.targetEntity) || [];

    if (sourceNodes.length === 0 || targetNodes.length === 0) continue;

    for (const source of sourceNodes) {
      for (const target of targetNodes) {
        if (edgeConfig.sourcePath && edgeConfig.targetPath) {
          const sourceVal = resolvePath(source.data, edgeConfig.sourcePath);
          const targetVal = resolvePath(target.data, edgeConfig.targetPath);
          if (sourceVal != targetVal) continue;
          if (sourceVal == null || targetVal == null) continue;
        }

        edgesToCreate.push({
          sourceNodeId: source.nodeId,
          targetNodeId: target.nodeId,
          relation: edgeConfig.relation,
          weight: edgeConfig.weight || 1,
          lastUpdatedByRunId: context.pipelineExecutionId,
        });
      }
    }
  }

  if (edgesToCreate.length > 0) {
    await knowledgeService.createEdgesBatch(edgesToCreate, orgContext);
  }
}

function resolvePath(item: any, path: string): string | number | null {
  if (!path) return null;
  if (!path.startsWith("$")) {
    if (item && typeof item === 'object' && path in item) {
      return item[path];
    }
    return path;
  }
  return queryOne(item, path);
}

function extractEntitiesFromJobOutput(
  output: any,
  jobType: string
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // Manual checking for AI/API structures
  if (typeof output === "object" && output !== null) {
    if (Array.isArray(output.data)) {
      output.data.forEach((item: any) => {
        if (item.id && (item.name || item.title)) entities.push(createEntityFromItem(item));
      });
    } else if (Array.isArray(output)) {
      output.forEach((item: any) => {
        if (item.id && (item.name || item.title)) entities.push(createEntityFromItem(item));
      });
    } else if (output.id && (output.name || output.title)) {
      entities.push(createEntityFromItem(output));
    }

    // Known keys
    ['users', 'tickets', 'incidents'].forEach(key => {
      if (Array.isArray(output[key])) {
        output[key].forEach((item: any) => entities.push(createEntityFromItem(item, key)));
      }
    });
  }

  return entities;
}

function createEntityFromItem(item: any, typeHint?: string): ExtractedEntity {
  return {
    type: typeHint ? typeHint.slice(0, -1) : inferEntityType(item), // remove 's' for simple singular? Rough heuristic
    name: item.name || item.title || "Unknown",
    externalId: String(item.id),
    data: item
  };
}

function inferEntityType(item: any): string {
  if (item.type) return String(item.type);
  if (item.incidentId) return "Incident";
  if (item.ticketId) return "Ticket";
  if (item.userId || item.email) return "User";
  return "KnowledgeDocument";
}

async function getOrCreateUserNode(
  email: string,
  orgContext: OrgContext
): Promise<KnowledgeNode> {
  const { knowledgeService } = (await import("../../knowledge.service.js")) as any;
  const { nodes } = await knowledgeService.searchNodes(orgContext, {
    query: email,
    limit: 1
  });

  const existingNode = nodes.find(
    (node: any) =>
      node.label === "User" &&
      (node.externalId === email || node.name === email)
  );

  if (existingNode) {
    return existingNode;
  }

  // Create new user node
  const [newNode] = await knowledgeService.createNodesBatch([{
    label: "User",
    name: email,
    externalId: email,
    properties: {
      email: email,
      source: "hil_form_approval",
    },
    organizationId: orgContext.organizationId,
  } as any], orgContext);

  return newNode;
}


