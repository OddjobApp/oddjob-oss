import { db } from "@server/database_service.js";
import { eq, like, desc, asc, sql, and, inArray, or, ilike, aliasedTable, isNotNull } from "drizzle-orm";
import {
  type User,
  type InsertUser,
  type UpdateUser,
  type Credential,
  type InsertCredential,
  type UpdateCredential,
  type Job,
  type InsertJob,
  type UpdateJob,
  type Pipeline,
  type InsertPipeline,
  type UpdatePipeline,
  type PipelineStep,
  type InsertPipelineStep,
  type UpdatePipelineStep,
  type PipelineExecution,
  type PipelineStepExecution,
  type KnowledgeNode,
  type InsertKnowledgeNode,
  type KnowledgeEdge,
  type InsertKnowledgeEdge,
  type OrgSettings,
  type InsertOrgSettings,
  users,
  credentials,
  jobs,
  pipelines,
  pipelineSteps,
  pipelineExecutions,
  pipelineStepExecutions,
  knowledgeNodes,
  knowledgeEdges,
  orgSettings,
  pipelineVersions, // Added
  type PipelineVersion,
  type InsertPipelineVersion,
} from "@shared/schema/index.js";

export const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
export const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "oddjob_rag_assets";
import { datasets, datasetItems, type Dataset, type InsertDatasetItem, type DatasetItem } from "@shared/schema/index.js";

export interface IStorage {






  // Pipeline methods




  // Knowledge Graph Node methods
  listKnowledgeNodes(organizationId: number | null, filters?: { label?: string; search?: string; page?: number; limit?: number; offset?: number }): Promise<{ nodes: KnowledgeNode[]; total: number; page: number; limit: number }>;
  getKnowledgeNode(id: number, organizationId: number | null): Promise<KnowledgeNode | undefined>;
  getKnowledgeNodeByExternalId(organizationId: number | null, label: string, externalId: string): Promise<KnowledgeNode | undefined>;
  getKnowledgeGraphLabels(organizationId: number | null): Promise<string[]>;
  createKnowledgeNode(node: InsertKnowledgeNode): Promise<KnowledgeNode>;
  createKnowledgeNodesBatch(nodes: InsertKnowledgeNode[]): Promise<KnowledgeNode[]>;
  updateKnowledgeNode(id: number, organizationId: number | null, update: Partial<InsertKnowledgeNode>): Promise<KnowledgeNode | undefined>;
  deleteKnowledgeNode(id: number, organizationId: number | null): Promise<boolean>;

  // Knowledge Graph Edge methods
  listKnowledgeEdges(organizationId: number | null, filters?: { sourceId?: number; targetId?: number; page?: number; limit?: number; offset?: number }): Promise<{ edges: KnowledgeEdge[]; total: number; page: number; limit: number }>;
  getKnowledgeEdge(id: number, organizationId: number | null): Promise<KnowledgeEdge | undefined>;
  getKnowledgeEdgeByNodes(sourceId: number, targetId: number, relation: string, organizationId: number | null): Promise<KnowledgeEdge | undefined>;
  createKnowledgeEdge(edge: InsertKnowledgeEdge): Promise<KnowledgeEdge>;
  createKnowledgeEdgesBatch(edges: InsertKnowledgeEdge[]): Promise<KnowledgeEdge[]>;
  updateKnowledgeEdge(id: number, organizationId: number | null, update: Partial<InsertKnowledgeEdge>): Promise<KnowledgeEdge | undefined>;
  deleteKnowledgeEdge(id: number, organizationId: number | null): Promise<boolean>;

  // Structural Search - Find edges based on source/target properties
  searchKnowledgeGraph(
    organizationId: number | null,
    query: {
      sourceLabel?: string;
      sourceFilter?: string;
      relation?: string;
      targetLabel?: string;
      targetFilter?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Array<{ source: KnowledgeNode; edge: KnowledgeEdge; target: KnowledgeNode }>>;

  // Graph expansion
  expandKnowledgeNode(id: number, organizationId: number | null): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>;

  // Organization Settings methods
  getOrgSettings(organizationId: number): Promise<OrgSettings | undefined>;
  updateOrgSettings(organizationId: number, settings: Partial<InsertOrgSettings>): Promise<OrgSettings>;
  getKnowledgeNodeValues(organizationId: number, field: string): Promise<Array<{ value: string; count: number }>>;

  // Forensic Analysis methods
  getPipelineExecutionsByTimeRange(pipelineIds: number[], startTime: Date, endTime: Date): Promise<PipelineExecution[]>;
  getKnowledgeNodesByExecutionIds(executionIds: number[]): Promise<KnowledgeNode[]>;

  // Analytics
  getSankeyChartData(
    organizationId: number | null,
    runId: number | null,
    dimensions: string[],
    datasetId?: number | null
  ): Promise<{ nodes: any[]; links: any[] }>;


  // Dataset methods
  listDatasets(organizationId: number | null): Promise<Dataset[]>;
  getDataset(id: number): Promise<Dataset | undefined>;
  createDatasetItem(item: InsertDatasetItem): Promise<DatasetItem>;
  getDatasetItems(datasetId: number, options?: { limit?: number; offset?: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; filter?: { field: string; value: any } }): Promise<{ items: DatasetItem[], total: number }>;
  getDatasetKeys(datasetId: number): Promise<{ key: string; type: string; nullCount: number }[]>;
}

export class DbStorage implements IStorage {


  // Credential methods








  // Knowledge Graph Node methods
  async listKnowledgeNodes(organizationId: number | null, filters?: { label?: string; search?: string; page?: number; limit?: number; offset?: number; datasetIds?: number[] }): Promise<{ nodes: KnowledgeNode[]; total: number; page: number; limit: number }> {
    try {
      const conditions = [organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId)];

      if (filters?.label) {
        conditions.push(eq(knowledgeNodes.label, filters.label));
      }

      if (filters?.search) {
        const searchPattern = `%${filters.search}%`;
        conditions.push(
          or(
            ilike(knowledgeNodes.name, searchPattern),
            ilike(knowledgeNodes.externalId, searchPattern)
          )!
        );
      }

      if (filters?.datasetIds && filters.datasetIds.length > 0) {
        // Resolve execution IDs from datasets (Items Lineage)
        const items = await db.select({ id: datasetItems.pipelineExecutionId })
          .from(datasetItems)
          .where(and(
            inArray(datasetItems.datasetId, filters.datasetIds),
            isNotNull(datasetItems.pipelineExecutionId)
          ));

        const executionIds = [...new Set(items.map(i => i.id!))];

        if (executionIds.length > 0) {
          conditions.push(inArray(knowledgeNodes.pipelineExecutionId, executionIds));
        } else {
          conditions.push(sql`1=0`);
        }
      }

      const page = filters?.page || 1;
      const limit = filters?.limit || 50;
      const offset = filters?.offset ?? (page - 1) * limit;

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeNodes)
        .where(and(...conditions));
      const total = Number(countResult[0]?.count || 0);

      // Get paginated results
      const nodes = await db
        .select()
        .from(knowledgeNodes)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(knowledgeNodes.createdAt));

      return { nodes, total, page, limit };
    } catch (error: any) {
      console.error("[Storage] Error listing knowledge nodes:", error);
      throw new Error(`Failed to list knowledge nodes: ${error.message}`);
    }
  }

  async getKnowledgeNode(id: number, organizationId: number | null): Promise<KnowledgeNode | undefined> {
    const orgCondition = organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId);
    const result = await db
      .select()
      .from(knowledgeNodes)
      .where(and(eq(knowledgeNodes.id, id), orgCondition))
      .limit(1);
    return result[0];
  }

  async getKnowledgeNodeByExternalId(organizationId: number | null, label: string, externalId: string): Promise<KnowledgeNode | undefined> {
    const orgCondition = organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId);
    const result = await db
      .select()
      .from(knowledgeNodes)
      .where(and(
        orgCondition,
        eq(knowledgeNodes.label, label),
        eq(knowledgeNodes.externalId, externalId)
      ))
      .limit(1);
    return result[0];
  }

  async getKnowledgeGraphLabels(organizationId: number | null): Promise<string[]> {
    try {
      const orgCondition = organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId);
      const result = await db
        .selectDistinct({ label: knowledgeNodes.label })
        .from(knowledgeNodes)
        .where(orgCondition);
      return result.map(r => r.label).filter((label): label is string => label !== null);
    } catch (error: any) {
      console.error("[Storage] Error getting knowledge graph labels:", error);
      throw new Error(`Failed to get knowledge graph labels: ${error.message}`);
    }
  }

  async createKnowledgeNode(node: InsertKnowledgeNode): Promise<KnowledgeNode> {
    try {
      const result = await db.insert(knowledgeNodes).values(node).returning();
      if (!result[0]) {
        throw new Error("Failed to create knowledge node");
      }
      return result[0];
    } catch (error: any) {
      console.error("[Storage] Error creating knowledge node:", error);
      if (error.code === '23505') { // Unique constraint violation
        throw new Error(`Node with this external ID already exists: ${node.externalId}`);
      }
      throw new Error(`Failed to create knowledge node: ${error.message}`);
    }
  }

  async createKnowledgeNodesBatch(nodes: InsertKnowledgeNode[]): Promise<KnowledgeNode[]> {
    if (nodes.length === 0) return [];

    try {
      return await db.transaction(async (tx) => {
        const results: KnowledgeNode[] = [];
        for (const node of nodes) {
          try {
            const [result] = await tx.insert(knowledgeNodes).values(node).returning();
            if (result) results.push(result);
          } catch (error: any) {
            // Log but continue with other nodes
            console.warn(`[Storage] Failed to create node ${node.externalId}:`, error.message);
          }
        }
        return results;
      });
    } catch (error: any) {
      console.error("[Storage] Error in batch create knowledge nodes:", error);
      throw new Error(`Failed to create knowledge nodes batch: ${error.message}`);
    }
  }

  async updateKnowledgeNode(id: number, organizationId: number | null, update: Partial<InsertKnowledgeNode>): Promise<KnowledgeNode | undefined> {
    const orgCondition = organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId);
    const result = await db
      .update(knowledgeNodes)
      .set({ ...update, updatedAt: new Date() })
      .where(and(eq(knowledgeNodes.id, id), orgCondition))
      .returning();
    return result[0];
  }

  async deleteKnowledgeNode(id: number, organizationId: number | null): Promise<boolean> {
    const orgCondition = organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId);
    const result = await db
      .delete(knowledgeNodes)
      .where(and(eq(knowledgeNodes.id, id), orgCondition))
      .returning();
    return result.length > 0;
  }

  // Knowledge Graph Edge methods
  async listKnowledgeEdges(organizationId: number | null, filters?: { sourceId?: number; targetId?: number; page?: number; limit?: number; offset?: number }): Promise<{ edges: KnowledgeEdge[]; total: number; page: number; limit: number }> {
    try {
      let conditions = [organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId)];

      if (filters?.sourceId) {
        conditions.push(eq(knowledgeEdges.sourceId, filters.sourceId));
      }

      if (filters?.targetId) {
        conditions.push(eq(knowledgeEdges.targetId, filters.targetId));
      }

      const page = filters?.page || 1;
      const limit = filters?.limit || 50;
      const offset = filters?.offset ?? (page - 1) * limit;

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeEdges)
        .where(and(...conditions));
      const total = Number(countResult[0]?.count || 0);

      // Get paginated results
      const edges = await db
        .select()
        .from(knowledgeEdges)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(knowledgeEdges.createdAt));

      return { edges, total, page, limit };
    } catch (error: any) {
      console.error("[Storage] Error listing knowledge edges:", error);
      throw new Error(`Failed to list knowledge edges: ${error.message}`);
    }
  }

  async getKnowledgeEdgeByNodes(sourceId: number, targetId: number, relation: string, organizationId: number | null): Promise<KnowledgeEdge | undefined> {
    try {
      const orgCondition = organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId);
      const result = await db
        .select()
        .from(knowledgeEdges)
        .where(and(
          orgCondition,
          eq(knowledgeEdges.sourceId, sourceId),
          eq(knowledgeEdges.targetId, targetId),
          eq(knowledgeEdges.relation, relation)
        ))
        .limit(1);
      return result[0];
    } catch (error: any) {
      console.error("[Storage] Error getting knowledge edge by nodes:", error);
      throw new Error(`Failed to get knowledge edge: ${error.message}`);
    }
  }

  async getKnowledgeEdge(id: number, organizationId: number | null): Promise<KnowledgeEdge | undefined> {
    const orgCondition = organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId);
    const result = await db
      .select()
      .from(knowledgeEdges)
      .where(and(eq(knowledgeEdges.id, id), orgCondition))
      .limit(1);
    return result[0];
  }

  async createKnowledgeEdge(edge: InsertKnowledgeEdge): Promise<KnowledgeEdge> {
    try {
      // Validate self-loop
      if (edge.sourceId === edge.targetId) {
        throw new Error("Cannot create edge: source and target nodes cannot be the same");
      }

      // Check for duplicate edge
      const existing = await this.getKnowledgeEdgeByNodes(
        edge.sourceId,
        edge.targetId,
        edge.relation,
        edge.organizationId ?? null
      );
      if (existing) {
        throw new Error(`Edge already exists between source ${edge.sourceId} and target ${edge.targetId} with relation ${edge.relation}`);
      }

      // Validate nodes exist and belong to same organization
      const sourceNode = await this.getKnowledgeNode(edge.sourceId, edge.organizationId ?? null);
      const targetNode = await this.getKnowledgeNode(edge.targetId, edge.organizationId ?? null);

      if (!sourceNode) {
        throw new Error(`Source node ${edge.sourceId} not found`);
      }
      if (!targetNode) {
        throw new Error(`Target node ${edge.targetId} not found`);
      }
      if (sourceNode.organizationId !== targetNode.organizationId) {
        throw new Error("Source and target nodes must belong to the same organization");
      }

      const result = await db.insert(knowledgeEdges).values(edge).returning();
      if (!result[0]) {
        throw new Error("Failed to create knowledge edge");
      }
      return result[0];
    } catch (error: any) {
      console.error("[Storage] Error creating knowledge edge:", error);
      if (error.message.includes("already exists") || error.message.includes("Cannot create edge")) {
        throw error; // Re-throw validation errors
      }
      if (error.code === '23505') { // Unique constraint violation
        throw new Error(`Edge already exists between these nodes with this relation`);
      }
      throw new Error(`Failed to create knowledge edge: ${error.message}`);
    }
  }

  async createKnowledgeEdgesBatch(edges: InsertKnowledgeEdge[]): Promise<KnowledgeEdge[]> {
    if (edges.length === 0) return [];

    try {
      return await db.transaction(async (tx) => {
        const results: KnowledgeEdge[] = [];
        for (const edge of edges) {
          try {
            // Validate self-loop
            if (edge.sourceId === edge.targetId) {
              console.warn(`[Storage] Skipping self-loop edge: ${edge.sourceId} -> ${edge.targetId}`);
              continue;
            }

            // Check for duplicate
            const existing = await this.getKnowledgeEdgeByNodes(
              edge.sourceId,
              edge.targetId,
              edge.relation,
              edge.organizationId ?? null
            );
            if (existing) {
              console.warn(`[Storage] Skipping duplicate edge: ${edge.sourceId} -> ${edge.targetId} (${edge.relation})`);
              continue;
            }

            const [result] = await tx.insert(knowledgeEdges).values(edge).returning();
            if (result) results.push(result);
          } catch (error: any) {
            // Log but continue with other edges
            console.warn(`[Storage] Failed to create edge ${edge.sourceId}->${edge.targetId}:`, error.message);
          }
        }
        return results;
      });
    } catch (error: any) {
      console.error("[Storage] Error in batch create knowledge edges:", error);
      throw new Error(`Failed to create knowledge edges batch: ${error.message}`);
    }
  }

  async updateKnowledgeEdge(id: number, organizationId: number | null, update: Partial<InsertKnowledgeEdge>): Promise<KnowledgeEdge | undefined> {
    const orgCondition = organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId);
    const result = await db
      .update(knowledgeEdges)
      .set(update)
      .where(and(eq(knowledgeEdges.id, id), orgCondition))
      .returning();
    return result[0];
  }

  async deleteKnowledgeEdge(id: number, organizationId: number | null): Promise<boolean> {
    const orgCondition = organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId);
    const result = await db
      .delete(knowledgeEdges)
      .where(and(eq(knowledgeEdges.id, id), orgCondition))
      .returning();
    return result.length > 0;
  }

  async searchKnowledgeGraph(
    organizationId: number | null,
    query: {
      sourceLabel?: string;
      sourceFilter?: string;
      relation?: string;
      targetLabel?: string;
      targetFilter?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Array<{ source: KnowledgeNode; edge: KnowledgeEdge; target: KnowledgeNode }>> {
    try {
      const sourceNodes = aliasedTable(knowledgeNodes, "source_nodes");
      const targetNodes = aliasedTable(knowledgeNodes, "target_nodes");

      const conditions = [organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId)];

      if (query.relation) {
        conditions.push(eq(knowledgeEdges.relation, query.relation));
      }

      if (query.sourceLabel) {
        conditions.push(eq(sourceNodes.label, query.sourceLabel));
      }

      if (query.sourceFilter) {
        const pattern = `%${query.sourceFilter}%`;
        conditions.push(or(
          ilike(sourceNodes.name, pattern),
          ilike(sourceNodes.externalId, pattern)
        )!);
      }

      if (query.targetLabel) {
        conditions.push(eq(targetNodes.label, query.targetLabel));
      }

      if (query.targetFilter) {
        const pattern = `%${query.targetFilter}%`;
        conditions.push(or(
          ilike(targetNodes.name, pattern),
          ilike(targetNodes.externalId, pattern)
        )!);
      }

      const limit = query.limit || 50;
      const offset = query.offset || 0;

      return await db
        .select({
          edge: knowledgeEdges,
          source: sourceNodes,
          target: targetNodes,
        })
        .from(knowledgeEdges)
        .innerJoin(sourceNodes, eq(knowledgeEdges.sourceId, sourceNodes.id))
        .innerJoin(targetNodes, eq(knowledgeEdges.targetId, targetNodes.id))
        .where(and(...conditions))
        .limit(limit)
        .offset(offset);
    } catch (error: any) {
      console.error("[Storage] Error searching knowledge graph:", error);
      throw new Error(`Failed to search knowledge graph: ${error.message}`);
    }
  }

  // Graph expansion - returns target node + all 1st-degree connections
  async expandKnowledgeNode(id: number, organizationId: number | null): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
    // Get the target node
    const targetNode = await this.getKnowledgeNode(id, organizationId);
    if (!targetNode) {
      return { nodes: [], edges: [] };
    }

    // Get all edges where this node is source or target
    const orgCondition = organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId);
    const edges = await db
      .select()
      .from(knowledgeEdges)
      .where(and(
        orgCondition,
        or(
          eq(knowledgeEdges.sourceId, id),
          eq(knowledgeEdges.targetId, id)
        )
      ));

    // Get all connected node IDs
    const connectedNodeIds = new Set<number>();
    edges.forEach(edge => {
      if (edge.sourceId !== id) connectedNodeIds.add(edge.sourceId);
      if (edge.targetId !== id) connectedNodeIds.add(edge.targetId);
    });

    // Get all connected nodes
    const connectedNodes = connectedNodeIds.size > 0
      ? await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId),
          inArray(knowledgeNodes.id, Array.from(connectedNodeIds))
        ))
      : [];

    // Return target node + connected nodes, and all edges
    return {
      nodes: [targetNode, ...connectedNodes],
      edges,
    };
  }

  // Organization Settings methods
  async getOrgSettings(organizationId: number): Promise<OrgSettings | undefined> {
    const result = await db
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.organizationId, organizationId))
      .limit(1);
    return result[0];
  }

  async updateOrgSettings(organizationId: number, settings: Partial<InsertOrgSettings>): Promise<OrgSettings> {
    const existing = await this.getOrgSettings(organizationId);

    if (existing) {
      const result = await db
        .update(orgSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(orgSettings.organizationId, organizationId))
        .returning();
      return result[0];
    } else {
      const result = await db
        .insert(orgSettings)
        .values({
          organizationId,
          knowledgeStoreEnabled: settings.knowledgeStoreEnabled ?? true,
          knowledgeGraphEnabled: settings.knowledgeGraphEnabled ?? true,
          psychologistEnabled: settings.psychologistEnabled ?? true,
          allowedAgentTools: settings.allowedAgentTools,
          allowedJobTypes: settings.allowedJobTypes,
        })
        .returning();
      return result[0];
    }
  }

  async getKnowledgeNodeValues(organizationId: number, field: string): Promise<Array<{ value: string; count: number }>> {
    // Note: This assumes 'field' is a top-level key in the data JSONB column.
    // We use sql projection to extract and group.

    // Safety check for field name to prevent injection (though Drizzle handles params, just to be safe on logic)
    if (!/^[a-zA-Z0-9_.]+$/.test(field)) {
      return [];
    }

    let columnExpr;
    let whereExpr;

    // Handle top-level columns
    if (field === 'label') {
      columnExpr = sql`label`;
      whereExpr = sql`label IS NOT NULL`;
    } else if (field === 'name') {
      columnExpr = sql`name`;
      whereExpr = sql`name IS NOT NULL`;
    } else {
      // Assume data property
      columnExpr = sql`data->>${sql.raw(`'${field}'`)}`;
      whereExpr = sql`data->>${sql.raw(`'${field}'`)} IS NOT NULL`;
    }

    const result = await db.execute(sql`
        SELECT ${columnExpr} as value, COUNT(*)::int as count 
        FROM knowledge_nodes 
        WHERE organization_id = ${organizationId} 
          AND ${whereExpr}
        GROUP BY value 
        ORDER BY count DESC
        LIMIT 100
    `);

    return result.rows.map((row: any) => ({
      value: row.value,
      count: row.count
    }));
  }

  // Forensic Analysis methods
  async getPipelineExecutionsByTimeRange(pipelineIds: number[], startTime: Date, endTime: Date): Promise<PipelineExecution[]> {
    if (pipelineIds.length === 0) return [];

    return await db
      .select()
      .from(pipelineExecutions)
      .where(and(
        inArray(pipelineExecutions.pipelineId, pipelineIds),
        sql`${pipelineExecutions.startedAt} >= ${startTime}`,
        sql`${pipelineExecutions.startedAt} <= ${endTime}`,
        eq(pipelineExecutions.status, "completed") // Only count completed executions
      ))
      .orderBy(pipelineExecutions.startedAt);
  }

  async getKnowledgeNodesByExecutionIds(executionIds: number[]): Promise<KnowledgeNode[]> {
    if (executionIds.length === 0) return [];

    return await db
      .select()
      .from(knowledgeNodes)
      .where(inArray(knowledgeNodes.pipelineExecutionId, executionIds));
  }

  async getSankeyChartData(
    organizationId: number | null,
    runId: number | null,
    dimensions: string[] = ['User', 'Component', 'Infrastructure'],
    datasetId: number | null = null
  ): Promise<{ nodes: any[]; links: any[] }> {
    if (runId) {
      return this.getPipelineRunSankey([runId], dimensions);
    }

    if (datasetId) {
      const items = await db
        .select({ runId: datasetItems.pipelineExecutionId })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));

      const runIds = items
        .map(i => i.runId)
        .filter((id): id is number => id !== null);

      if (runIds.length === 0) return { nodes: [], links: [] };
      return this.getPipelineRunSankey(runIds, dimensions);
    }

    // --- Legacy "Hub" Mode for Global View (optimized for sparse graphs centered on Tickets) ---
    const conditions = [];
    if (organizationId === null) {
      conditions.push(sql`${knowledgeNodes.organizationId} IS NULL`);
    } else {
      conditions.push(eq(knowledgeNodes.organizationId, organizationId));
    }

    conditions.push(or(
      eq(knowledgeNodes.label, 'Ticket'),
      eq(knowledgeNodes.label, 'Incident'),
      eq(knowledgeNodes.label, 'Issue')
    )!);

    const hubs = await db
      .select({
        id: knowledgeNodes.id,
        name: knowledgeNodes.name,
        label: knowledgeNodes.label,
        externalId: knowledgeNodes.externalId
      })
      .from(knowledgeNodes)
      .where(and(...conditions))
      .limit(2000);

    if (hubs.length === 0) {
      return { nodes: [], links: [] };
    }

    const hubIds = hubs.map(h => h.id);
    const orgCondition = organizationId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, organizationId);

    const relevantEdges = await db
      .select({
        sourceId: knowledgeEdges.sourceId,
        targetId: knowledgeEdges.targetId,
      })
      .from(knowledgeEdges)
      .where(and(
        orgCondition,
        or(
          inArray(knowledgeEdges.sourceId, hubIds),
          inArray(knowledgeEdges.targetId, hubIds)
        )
      ));

    // Collect all neighbor IDs
    const neighborIds = new Set<number>(hubIds);
    relevantEdges.forEach(e => {
      neighborIds.add(e.sourceId);
      neighborIds.add(e.targetId);
    });

    const nodesOrgCondition = organizationId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, organizationId);
    const allNodes = await db
      .select({
        id: knowledgeNodes.id,
        label: knowledgeNodes.label,
        name: knowledgeNodes.name
      })
      .from(knowledgeNodes)
      .where(and(
        nodesOrgCondition,
        inArray(knowledgeNodes.id, Array.from(neighborIds))
      ));

    const nodeMap = new Map<number, { label: string; name: string }>();
    allNodes.forEach(n => nodeMap.set(n.id, n));

    // Build Adjacency
    const adj: Record<number, number[]> = {};
    relevantEdges.forEach(e => {
      if (!adj[e.sourceId]) adj[e.sourceId] = [];
      if (!adj[e.targetId]) adj[e.targetId] = [];

      // Undirected connection for discovery
      adj[e.sourceId].push(e.targetId);
      adj[e.targetId].push(e.sourceId);
    });

    // Traverse Dimensions
    // For each Hub, we try to fill the dimension slots by walking the graph
    // (Simplified Star Schema approach: Center is Hub, leaves are attributes)

    const links: Record<string, { count: number; ticketIds: number[] }> = {};
    const sankeyNodes: Map<string, { id: string; layer: number; name: string }> = new Map();

    for (const hub of hubs) {
      // Find connected nodes for this hub matching requested dimensions
      // Strategy: Since it's a star, neighbors are usually the attributes
      const neighbors = adj[hub.id] || [];
      const attributes: Record<string, string> = {};

      attributes[hub.label] = hub.name; // Hub provides its own dimension

      neighbors.forEach(nid => {
        const n = nodeMap.get(nid);
        if (n) attributes[n.label] = n.name;
      });

      // Chain dimensions
      for (let i = 0; i < dimensions.length - 1; i++) {
        const sourceLabel = dimensions[i];
        const targetLabel = dimensions[i + 1];

        if (attributes[sourceLabel] && attributes[targetLabel]) {
          const sourceName = attributes[sourceLabel];
          const targetName = attributes[targetLabel];

          // Prevent self-loop if labels are same and values are same (unlikely unless data error)
          if (sourceName === targetName && sourceLabel === targetLabel) continue;

          const sourceId = `${sourceLabel}::${sourceName}`;
          const targetId = `${targetLabel}::${targetName}`;

          if (!sankeyNodes.has(sourceId)) sankeyNodes.set(sourceId, { id: sourceId, layer: i, name: sourceName });
          if (!sankeyNodes.has(targetId)) sankeyNodes.set(targetId, { id: targetId, layer: i + 1, name: targetName });

          const key = `${sourceId}|${targetId}`;
          if (!links[key]) links[key] = { count: 0, ticketIds: [] };

          // Deduplication: Since we iterate Hubs, and Hub is usually central, we count once per Hub
          links[key].count++;
          links[key].ticketIds.push(hub.id);
        }
      }
    }

    return {
      nodes: Array.from(sankeyNodes.values()),
      links: Object.entries(links).map(([key, data]) => {
        const [source, target] = key.split('|');
        return { source, target, value: data.count, ticketIds: data.ticketIds };
      })
    };
  }

  // === NEW METHOD: Robust Sankey for Pipeline Runs (Architected for Star Topology) ===
  async getPipelineRunSankey(
    runIds: number[],
    dimensions: string[]
  ): Promise<{ nodes: any[]; links: any[] }> {
    // 1. Fetch Core Run Nodes
    const coreNodes = await db
      .select({
        id: knowledgeNodes.id,
        label: knowledgeNodes.label,
        name: knowledgeNodes.name
      })
      .from(knowledgeNodes)
      .where(inArray(knowledgeNodes.pipelineExecutionId, runIds));

    // If no nodes in run, return empty
    if (coreNodes.length === 0) return { nodes: [], links: [] };

    const coreNodeIds = coreNodes.map(n => n.id);
    const nodeMap = new Map(coreNodes.map(n => [n.id, n]));

    // 2. Fetch Edges (Both internal to run AND boundary edges to existing nodes)
    // - Edges tagged with runId
    // - Edges connecting a Core Node to ANY other node
    const edges = await db
      .select({
        sourceId: knowledgeEdges.sourceId,
        targetId: knowledgeEdges.targetId,
      })
      .from(knowledgeEdges)
      .where(or(
        inArray(knowledgeEdges.lastUpdatedByRunId, runIds),
        inArray(knowledgeEdges.sourceId, coreNodeIds),
        inArray(knowledgeEdges.targetId, coreNodeIds)
      ));

    // 3. Fetch Boundary Nodes (Neighbors that weren't in the core set)
    const neighborIds = new Set<number>();
    edges.forEach(e => {
      if (!nodeMap.has(e.sourceId)) neighborIds.add(e.sourceId);
      if (!nodeMap.has(e.targetId)) neighborIds.add(e.targetId);
    });

    if (neighborIds.size > 0) {
      const neighbors = await db
        .select({
          id: knowledgeNodes.id,
          label: knowledgeNodes.label,
          name: knowledgeNodes.name
        })
        .from(knowledgeNodes)
        .where(inArray(knowledgeNodes.id, Array.from(neighborIds)));

      neighbors.forEach(n => nodeMap.set(n.id, n));
    }

    // 4. Trace Flows based on Dimensions
    // We treat the graph as a set of (Source, Target) links.
    // We only care about links that cross from Dim[i] -> Dim[i+1].
    const linksMap: Record<string, number> = {};
    const sankeyNodeMap: Map<string, any> = new Map();

    const addSankeyNode = (n: { label: string; name: string }, layer: number) => {
      const id = `${n.label}::${n.name}`;
      if (!sankeyNodeMap.has(id)) {
        sankeyNodeMap.set(id, { id, name: n.name, layer });
      }
      return id;
    };

    // For every pair of dimensions, find all matching edges
    for (let i = 0; i < dimensions.length - 1; i++) {
      const srcLabel = dimensions[i];
      const tgtLabel = dimensions[i + 1];

      for (const edge of edges) {
        const nodeA = nodeMap.get(edge.sourceId);
        const nodeB = nodeMap.get(edge.targetId);

        if (!nodeA || !nodeB) continue;

        let source = null;
        let target = null;

        // Direct Match: Source(Label=Src) -> Target(Label=Tgt)
        if (nodeA.label === srcLabel && nodeB.label === tgtLabel) {
          source = nodeA;
          target = nodeB;
        }
        // Inverse Match: Target(Label=Src) <- Source(Label=Tgt) (Undirected View)
        else if (nodeB.label === srcLabel && nodeA.label === tgtLabel) {
          source = nodeB;
          target = nodeA;
        }

        if (source && target) {
          // Prevent self-loops in visualization if names are identical
          if (source.name === target.name) continue;

          const sId = addSankeyNode(source, i);
          const tId = addSankeyNode(target, i + 1);

          const key = `${sId}|${tId}`;
          linksMap[key] = (linksMap[key] || 0) + 1;
        }
      }
    }

    const finalLinks = Object.entries(linksMap).map(([key, count]) => {
      const [source, target] = key.split('|');
      return { source, target, value: count };
    });

    return {
      nodes: Array.from(sankeyNodeMap.values()),
      links: finalLinks
    };
  }


  // Dataset methods
  async listDatasets(organizationId: number | null): Promise<Dataset[]> {
    const conditions = [organizationId === null ? sql`${datasets.organizationId} IS NULL` : eq(datasets.organizationId, organizationId)];
    return await db.select().from(datasets).where(and(...conditions)).orderBy(desc(datasets.updatedAt));
  }

  async getDataset(id: number): Promise<Dataset | undefined> {
    const [result] = await db.select().from(datasets).where(eq(datasets.id, id)).limit(1);
    return result;
  }

  async createDatasetItem(item: InsertDatasetItem): Promise<DatasetItem> {
    const [result] = await db.insert(datasetItems).values(item).returning();
    return result;
  }

  async getDatasetItems(
    datasetId: number,
    options: {
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      filter?: { field: string; value: any }
    } = {}
  ): Promise<{ items: DatasetItem[], total: number }> {
    const limit = options.limit || 1000;
    const offset = options.offset || 0;

    // Build conditions
    const conditions = [eq(datasetItems.datasetId, datasetId)];

    if (options.filter && options.filter.field && options.filter.value) {
      // Filter JSONB data. Note: Drizzle specific syntax for JSONB path access
      // This assumes standard Postgres JSONB operator support via sql template
      // We use sql to perform JSON path query
      // Cast to string for simple comparison for now
      conditions.push(sql`${datasetItems.data}->>${options.filter.field} LIKE ${'%' + options.filter.value + '%'}`);
    }

    // Get Total Count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(datasetItems)
      .where(and(...conditions));

    // Sort logic
    let orderByClause = desc(datasetItems.createdAt);
    if (options.sortBy) {
      // If sorting by a root column
      if (options.sortBy === 'createdAt') {
        orderByClause = options.sortOrder === 'asc' ? asc(datasetItems.createdAt) : desc(datasetItems.createdAt);
      } else if (options.sortBy === 'id') {
        orderByClause = options.sortOrder === 'asc' ? asc(datasetItems.id) : desc(datasetItems.id);
      } else {
        // Sort by JSON field
        // Note: casting to Text is safest for generic sort
        const jsonField = sql`${datasetItems.data}->>${options.sortBy}`;
        orderByClause = options.sortOrder === 'asc' ? asc(jsonField) : desc(jsonField);
      }
    }

    const items = await db.select()
      .from(datasetItems)
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    return { items, total: Number(countResult.count) };
  }

  async getDatasetKeys(datasetId: number): Promise<{ key: string; type: string; nullCount: number }[]> {
    // Sample 50 items to find available keys and infer types
    const result = await this.getDatasetItems(datasetId, { limit: 50 });
    const items = result.items;
    if (items.length === 0) return [];

    const stats = new Map<string, { total: number; nulls: number; types: Map<string, number> }>();

    items.forEach(item => {
      if (item.data && typeof item.data === 'object') {
        Object.entries(item.data).forEach(([key, value]) => {
          if (!stats.has(key)) {
            stats.set(key, { total: 0, nulls: 0, types: new Map() });
          }
          const stat = stats.get(key)!;
          stat.total++;

          if (value === null || value === undefined) {
            stat.nulls++;
          } else {
            let type: string = typeof value;
            if (type === 'string') {
              // Check if it's a date
              // Simple ISO date regex or check if Date.parse works and looks like a date
              if (/^\d{4}-\d{2}-\d{2}T/.test(value as string)) {
                type = 'date';
              }
            }
            stat.types.set(type, (stat.types.get(type) || 0) + 1);
          }
        });
      }
    });

    return Array.from(stats.entries()).map(([key, stat]) => {
      // Determine dominant type
      let dominantType = 'string';
      let maxCount = 0;
      stat.types.forEach((count, type) => {
        if (count > maxCount) {
          maxCount = count;
          dominantType = type;
        }
      });

      return {
        key,
        type: dominantType,
        nullCount: stat.nulls
      };
    }).sort((a, b) => a.key.localeCompare(b.key));
  }
}

export const storage = new DbStorage();


