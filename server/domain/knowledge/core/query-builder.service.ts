import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { sql } from "drizzle-orm";
import { graphService } from "@domain/knowledge/core/graph-service.js";
import { type OrgContext } from "@server/utils/auth-context.js";

const logger = createLogger("QueryBuilderService");

// ========================================================================
// TYPES
// ========================================================================

export interface VisualQueryNode {
    id: string;
    label: string;
    alias?: string;
    filters?: Array<{
        property: string;
        operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'starts_with' | 'ends_with' | 'before' | 'after';
        value: any;
        logicalOperator?: 'AND' | 'OR';
    }>;
}

export interface VisualQueryRelationship {
    id: string;
    type: string;
    sourceNodeId: string;
    targetNodeId: string;
    direction: 'outgoing' | 'incoming' | 'both';
    minHops?: number;
    maxHops?: number;
    filters?: Array<{
        property: string;
        operator: string;
        value: any;
    }>;
}

export interface VisualQuery {
    nodes: VisualQueryNode[];
    relationships: VisualQueryRelationship[];
    returnClause: {
        items: Array<{
            type: 'node' | 'relationship' | 'property' | 'path';
            id?: string;
            property?: string;
        }>;
    };
    limit?: number;
    orderBy?: Array<{
        property: string;
        direction: 'ASC' | 'DESC';
    }>;
}

export interface QueryTemplate {
    id?: number;
    name: string;
    description?: string;
    category?: 'common' | 'advanced' | 'custom';
    queryStructure: VisualQuery;
    cypherTemplate?: string;
    parameters?: any[];
    isPublic?: boolean;
    organizationId?: number;
    createdBy?: string;
}

export interface SavedQuery {
    id?: number;
    name: string;
    description?: string;
    queryStructure: VisualQuery;
    cypherQuery?: string;
    organizationId?: number;
    createdBy?: string;
    lastRunAt?: Date;
    runCount?: number;
}

// ========================================================================
// QUERY BUILDER SERVICE
// ========================================================================

export const queryBuilderService = {
    /**
     * Build Cypher query from visual query structure
     */
    buildCypherQuery(visualQuery: VisualQuery): string {
        const { nodes, relationships, returnClause, limit, orderBy } = visualQuery;

        // Build MATCH clause
        const matchParts: string[] = [];
        const whereParts: string[] = [];

        // Handle nodes
        nodes.forEach(node => {
            const alias = node.alias || node.id;
            const label = node.label === '*' ? '' : `:${node.label}`;

            // Add filters to WHERE clause
            if (node.filters && node.filters.length > 0) {
                node.filters.forEach((filter, idx) => {
                    const operator = this.getOperatorSymbol(filter.operator);
                    let condition = '';

                    if (filter.operator === 'contains') {
                        condition = `${alias}.${filter.property} CONTAINS '${filter.value}'`;
                    } else if (filter.operator === 'starts_with') {
                        condition = `${alias}.${filter.property} STARTS WITH '${filter.value}'`;
                    } else if (filter.operator === 'ends_with') {
                        condition = `${alias}.${filter.property} ENDS WITH '${filter.value}'`;
                    } else if (filter.operator === 'before') {
                        condition = `${alias}.${filter.property} < '${filter.value}'`;
                    } else if (filter.operator === 'after') {
                        condition = `${alias}.${filter.property} > '${filter.value}'`;
                    } else {
                        const value = typeof filter.value === 'string' ? `'${filter.value}'` : filter.value;
                        condition = `${alias}.${filter.property} ${operator} ${value}`;
                    }

                    if (idx > 0 && filter.logicalOperator) {
                        whereParts.push(`${filter.logicalOperator} ${condition}`);
                    } else {
                        whereParts.push(condition);
                    }
                });
            }
        });

        // Handle relationships
        if (relationships.length > 0) {
            relationships.forEach(rel => {
                const sourceNode = nodes.find(n => n.id === rel.sourceNodeId);
                const targetNode = nodes.find(n => n.id === rel.targetNodeId);

                if (!sourceNode || !targetNode) {
                    throw new Error(`Invalid relationship: source or target node not found`);
                }

                const sourceAlias = sourceNode.alias || sourceNode.id;
                const targetAlias = targetNode.alias || targetNode.id;
                const sourceLabel = sourceNode.label === '*' ? '' : `:${sourceNode.label}`;
                const targetLabel = targetNode.label === '*' ? '' : `:${targetNode.label}`;
                const relType = rel.type === '*' ? '' : `:${rel.type}`;
                const relAlias = rel.id;

                // Build relationship pattern
                let relPattern = '';
                const hops = rel.minHops || rel.maxHops ? `*${rel.minHops || 1}..${rel.maxHops || 5}` : '';

                if (rel.direction === 'outgoing') {
                    relPattern = `(${sourceAlias}${sourceLabel})-[${relAlias}${relType}${hops}]->(${targetAlias}${targetLabel})`;
                } else if (rel.direction === 'incoming') {
                    relPattern = `(${sourceAlias}${sourceLabel})<-[${relAlias}${relType}${hops}]-(${targetAlias}${targetLabel})`;
                } else {
                    relPattern = `(${sourceAlias}${sourceLabel})-[${relAlias}${relType}${hops}]-(${targetAlias}${targetLabel})`;
                }

                matchParts.push(relPattern);
            });
        } else {
            // No relationships, just match individual nodes
            nodes.forEach(node => {
                const alias = node.alias || node.id;
                const label = node.label === '*' ? '' : `:${node.label}`;
                matchParts.push(`(${alias}${label})`);
            });
        }

        // Build RETURN clause
        const returnItems = returnClause.items.map(item => {
            if (item.type === 'node' || item.type === 'relationship') {
                const node = nodes.find(n => n.id === item.id);
                const rel = relationships.find(r => r.id === item.id);
                return node ? (node.alias || node.id) : (rel ? rel.id : item.id);
            } else if (item.type === 'property' && item.id) {
                return `${item.id}.${item.property}`;
            } else if (item.type === 'path') {
                return 'path';
            }
            return item.id || '';
        }).filter(Boolean);

        // Assemble query
        let query = `MATCH ${matchParts.join(', ')}`;

        if (whereParts.length > 0) {
            query += `\nWHERE ${whereParts.join(' ')}`;
        }

        query += `\nRETURN ${returnItems.join(', ')}`;

        if (orderBy && orderBy.length > 0) {
            const orderClauses = orderBy.map(o => `${o.property} ${o.direction}`);
            query += `\nORDER BY ${orderClauses.join(', ')}`;
        }

        if (limit) {
            query += `\nLIMIT ${limit}`;
        }

        return query;
    },

    /**
     * Get operator symbol for Cypher
     */
    getOperatorSymbol(operator: string): string {
        const operators: Record<string, string> = {
            '=': '=',
            '!=': '<>',
            '>': '>',
            '<': '<',
            '>=': '>=',
            '<=': '<=',
            'contains': 'CONTAINS',
            'starts_with': 'STARTS WITH',
            'ends_with': 'ENDS WITH',
            'before': '<',
            'after': '>'
        };
        return operators[operator] || '=';
    },

    /**
     * Validate visual query structure
     */
    validateQuery(visualQuery: VisualQuery): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Check if nodes exist
        if (!visualQuery.nodes || visualQuery.nodes.length === 0) {
            errors.push('Query must have at least one node');
        }

        // Check node IDs are unique
        const nodeIds = visualQuery.nodes.map(n => n.id);
        const uniqueNodeIds = new Set(nodeIds);
        if (nodeIds.length !== uniqueNodeIds.size) {
            errors.push('Node IDs must be unique');
        }

        // Check relationships reference valid nodes
        visualQuery.relationships?.forEach(rel => {
            const sourceExists = visualQuery.nodes.some(n => n.id === rel.sourceNodeId);
            const targetExists = visualQuery.nodes.some(n => n.id === rel.targetNodeId);

            if (!sourceExists) {
                errors.push(`Relationship ${rel.id} references non-existent source node ${rel.sourceNodeId}`);
            }
            if (!targetExists) {
                errors.push(`Relationship ${rel.id} references non-existent target node ${rel.targetNodeId}`);
            }
        });

        // Check return clause references valid items
        visualQuery.returnClause?.items.forEach(item => {
            if (item.type === 'node') {
                const nodeExists = visualQuery.nodes.some(n => n.id === item.id);
                if (!nodeExists) {
                    errors.push(`Return clause references non-existent node ${item.id}`);
                }
            } else if (item.type === 'relationship') {
                const relExists = visualQuery.relationships?.some(r => r.id === item.id);
                if (!relExists) {
                    errors.push(`Return clause references non-existent relationship ${item.id}`);
                }
            }
        });

        return {
            valid: errors.length === 0,
            errors
        };
    },

    /**
     * Execute visual query and return results
     */
    async executeQuery(
        visualQuery: VisualQuery,
        orgContext: OrgContext
    ): Promise<{ nodes: any[]; edges: any[]; totalNodes: number; truncated: boolean; executionTimeMs: number }> {
        const startTime = Date.now();

        try {
            // Validate query
            const validation = this.validateQuery(visualQuery);
            if (!validation.valid) {
                throw new Error(`Invalid query: ${validation.errors.join(', ')}`);
            }

            // Implementation note: This is a simulated graph query engine for Postgres.
            // It searches for nodes matching labels/filters and then finds edges connecting them.

            // 1. Find potential nodes for each VisualQueryNode
            const nodeResultsMap = new Map<string, any[]>();

            for (const vNode of visualQuery.nodes) {
                const searchFilters: any = {
                    label: vNode.label !== '*' ? vNode.label : undefined,
                    limit: 100 // Fetch a reasonable candidate pool
                };

                // Add text filter if present
                if (vNode.filters && vNode.filters.length > 0) {
                    searchFilters.query = vNode.filters[0].value;
                }

                const { nodes } = await graphService.searchNodes(orgContext, searchFilters);
                nodeResultsMap.set(vNode.id, nodes);
            }

            // 2. Resolve relationships if any
            let finalNodes = new Set<any>();
            let finalEdges = new Set<any>();

            if (visualQuery.relationships && visualQuery.relationships.length > 0) {
                // Find edges that connect the candidate nodes
                for (const rel of visualQuery.relationships) {
                    const sourceCandidates = nodeResultsMap.get(rel.sourceNodeId);
                    const targetCandidates = nodeResultsMap.get(rel.targetNodeId);

                    if (!Array.isArray(sourceCandidates) || !Array.isArray(targetCandidates)) continue;
                    if (sourceCandidates.length === 0 || targetCandidates.length === 0) continue;

                    const sourceIds = sourceCandidates.map(n => n.id);
                    const targetIds = targetCandidates.map(n => n.id);

                    // Search for edges between these nodes
                    // We can use listEdges but it doesn't support sourceId AND targetId simultaneously for a set
                    // So we fetch edges for sourceIds and filter
                    const { edges } = await graphService.listEdges(orgContext, {
                        nodeIds: [...sourceIds, ...targetIds],
                        limit: 500
                    });

                    // Filter edges that actually connect our specific source and target candidates
                    // and match the relationship type if specified
                    const matchingEdges = edges.filter(e => {
                        const matchesType = rel.type === '*' || e.relation === rel.type;
                        const connectsSourceToTarget = sourceIds.includes(e.sourceId) && targetIds.includes(e.targetId);
                        const connectsTargetToSource = targetIds.includes(e.sourceId) && sourceIds.includes(e.targetId);

                        if (rel.direction === 'outgoing') return matchesType && connectsSourceToTarget;
                        if (rel.direction === 'incoming') return matchesType && connectsTargetToSource;
                        return matchesType && (connectsSourceToTarget || connectsTargetToSource);
                    });

                    matchingEdges.forEach(e => finalEdges.add(e));

                    // Add only nodes that are actually connected by matching edges
                    matchingEdges.forEach(e => {
                        const sNode = sourceCandidates.find(n => n.id === e.sourceId);
                        const tNode = targetCandidates.find(n => n.id === e.targetId);
                        if (sNode) finalNodes.add(sNode);
                        if (tNode) finalNodes.add(tNode);
                    });
                }
            } else {
                // No relationships, just combine all candidate nodes
                nodeResultsMap.forEach(nodes => nodes.forEach(n => finalNodes.add(n)));
            }

            // Honour the LIMIT shown in the Cypher preview, so what the user sees
            // in the results view matches the query they built.
            const allNodes = Array.from(finalNodes);
            const limit = typeof visualQuery.limit === 'number' && visualQuery.limit > 0
                ? visualQuery.limit
                : undefined;
            const nodes = limit ? allNodes.slice(0, limit) : allNodes;
            const keptNodeIds = new Set(nodes.map((n: any) => n.id));
            const edges = Array.from(finalEdges).filter(
                (e: any) => keptNodeIds.has(e.sourceId) && keptNodeIds.has(e.targetId)
            );

            const executionTimeMs = Date.now() - startTime;

            return {
                nodes,
                edges,
                totalNodes: allNodes.length,
                truncated: allNodes.length > nodes.length,
                executionTimeMs
            };
        } catch (error: any) {
            logger.error('Query execution failed', error);
            throw error;
        }
    },

    /**
     * Get query templates
     */
    async getQueryTemplates(
        orgContext: OrgContext,
        category?: string
    ): Promise<QueryTemplate[]> {
        try {
            let query = sql`
                SELECT * FROM query_templates
                WHERE (organization_id IS NOT DISTINCT FROM ${orgContext.organizationId} OR is_public = true)
            `;

            if (category) {
                query = sql`${query} AND category = ${category}`;
            }

            query = sql`${query} ORDER BY created_at DESC`;

            const result = await db.execute(query);
            return result.rows.map((row: any) => ({
                id: row.id as number,
                name: row.name as string,
                description: row.description as string | undefined,
                category: row.category as 'common' | 'advanced' | 'custom',
                queryStructure: row.query_structure as VisualQuery,
                cypherTemplate: row.cypher_template as string | undefined,
                parameters: row.parameters as any[],
                isPublic: row.is_public as boolean,
                organizationId: row.organization_id as number | undefined,
                createdBy: row.created_by as string | undefined
            }));
        } catch (error: any) {
            logger.error('Failed to get query templates', error);
            throw error;
        }
    },

    /**
     * Create query template
     */
    async createQueryTemplate(
        template: QueryTemplate,
        orgContext: OrgContext
    ): Promise<QueryTemplate> {
        try {
            const result = await db.execute(sql`
                INSERT INTO query_templates (
                    name, description, category, query_structure, cypher_template,
                    parameters, is_public, organization_id, created_by
                ) VALUES (
                    ${template.name},
                    ${template.description || null},
                    ${template.category || 'custom'},
                    ${JSON.stringify(template.queryStructure)},
                    ${template.cypherTemplate || null},
                    ${JSON.stringify(template.parameters || [])},
                    ${template.isPublic || false},
                    ${orgContext.organizationId},
                    ${orgContext.userId}
                )
                RETURNING *
            `);

            const row: any = result.rows[0];
            return {
                id: row.id as number,
                name: row.name as string,
                description: row.description as string | undefined,
                category: row.category as 'common' | 'advanced' | 'custom',
                queryStructure: row.query_structure as VisualQuery,
                cypherTemplate: row.cypher_template as string | undefined,
                parameters: row.parameters as any[],
                isPublic: row.is_public as boolean,
                organizationId: row.organization_id as number | undefined,
                createdBy: row.created_by as string | undefined
            };
        } catch (error: any) {
            logger.error('Failed to create query template', error);
            throw error;
        }
    },

    /**
     * Get saved queries
     */
    async getSavedQueries(orgContext: OrgContext): Promise<SavedQuery[]> {
        try {
            // IS NOT DISTINCT FROM, not "=": a null organizationId (super admin with no
            // org selected) writes rows with a null organization_id, and "= NULL" would
            // never match them again — the query would save and then vanish from the list.
            const result = await db.execute(sql`
                SELECT * FROM saved_queries
                WHERE organization_id IS NOT DISTINCT FROM ${orgContext.organizationId}
                ORDER BY last_run_at DESC NULLS LAST, created_at DESC
            `);

            return result.rows.map((row: any) => ({
                id: row.id as number,
                name: row.name as string,
                description: row.description as string | undefined,
                queryStructure: row.query_structure as VisualQuery,
                cypherQuery: row.cypher_query as string | undefined,
                organizationId: row.organization_id as number | undefined,
                createdBy: row.created_by as string | undefined,
                lastRunAt: row.last_run_at as Date | undefined,
                runCount: row.run_count as number
            }));
        } catch (error: any) {
            logger.error('Failed to get saved queries', error);
            throw error;
        }
    },

    /**
     * Save query
     */
    async saveQuery(
        query: SavedQuery,
        orgContext: OrgContext
    ): Promise<SavedQuery> {
        try {
            const cypherQuery = this.buildCypherQuery(query.queryStructure);

            const result = await db.execute(sql`
                INSERT INTO saved_queries (
                    name, description, query_structure, cypher_query,
                    organization_id, created_by
                ) VALUES (
                    ${query.name},
                    ${query.description || null},
                    ${JSON.stringify(query.queryStructure)},
                    ${cypherQuery},
                    ${orgContext.organizationId},
                    ${orgContext.userId}
                )
                RETURNING *
            `);

            const row: any = result.rows[0];
            return {
                id: row.id as number,
                name: row.name as string,
                description: row.description as string | undefined,
                queryStructure: row.query_structure as VisualQuery,
                cypherQuery: row.cypher_query as string | undefined,
                organizationId: row.organization_id as number | undefined,
                createdBy: row.created_by as string | undefined,
                lastRunAt: row.last_run_at as Date | undefined,
                runCount: row.run_count as number
            };
        } catch (error: any) {
            logger.error('Failed to save query', error);
            throw error;
        }
    },

    /**
     * Update saved query
     */
    async updateSavedQuery(
        queryId: number,
        updates: Partial<SavedQuery>,
        orgContext: OrgContext
    ): Promise<SavedQuery> {
        try {
            const cypherQuery = updates.queryStructure
                ? this.buildCypherQuery(updates.queryStructure)
                : undefined;

            const result = await db.execute(sql`
                UPDATE saved_queries
                SET 
                    name = COALESCE(${updates.name || null}, name),
                    description = COALESCE(${updates.description || null}, description),
                    query_structure = COALESCE(${updates.queryStructure ? JSON.stringify(updates.queryStructure) : null}, query_structure),
                    cypher_query = COALESCE(${cypherQuery || null}, cypher_query),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ${queryId} AND organization_id IS NOT DISTINCT FROM ${orgContext.organizationId}
                RETURNING *
            `);

            if (result.rows.length === 0) {
                throw new Error('Query not found or access denied');
            }

            const row: any = result.rows[0];
            return {
                id: row.id as number,
                name: row.name as string,
                description: row.description as string | undefined,
                queryStructure: row.query_structure as VisualQuery,
                cypherQuery: row.cypher_query as string | undefined,
                organizationId: row.organization_id as number | undefined,
                createdBy: row.created_by as string | undefined,
                lastRunAt: row.last_run_at as Date | undefined,
                runCount: row.run_count as number
            };
        } catch (error: any) {
            logger.error('Failed to update saved query', error);
            throw error;
        }
    },

    /**
     * Delete saved query
     */
    async deleteSavedQuery(queryId: number, orgContext: OrgContext): Promise<boolean> {
        try {
            const result = await db.execute(sql`
                DELETE FROM saved_queries
                WHERE id = ${queryId} AND organization_id IS NOT DISTINCT FROM ${orgContext.organizationId}
            `);

            return (result.rowCount || 0) > 0;
        } catch (error: any) {
            logger.error('Failed to delete saved query', error);
            throw error;
        }
    },

    /**
     * Track query execution
     */
    async trackQueryExecution(
        queryId: number,
        queryText: string,
        executionTimeMs: number,
        resultCount: number,
        status: 'success' | 'error',
        errorMessage: string | null,
        orgContext: OrgContext
    ): Promise<void> {
        try {
            // queryId arrives from the client, so confirm it belongs to this org before
            // writing history against it or bumping its counters.
            const owned = await db.execute(sql`
                SELECT id FROM saved_queries
                WHERE id = ${queryId}
                  AND organization_id IS NOT DISTINCT FROM ${orgContext.organizationId}
            `);
            if (owned.rows.length === 0) {
                logger.warn('Skipping execution tracking for unknown or foreign saved query', { queryId });
                return;
            }

            // Insert execution history
            await db.execute(sql`
                INSERT INTO query_execution_history (
                    query_id, query_text, execution_time_ms, result_count,
                    status, error_message, executed_by
                ) VALUES (
                    ${queryId},
                    ${queryText},
                    ${executionTimeMs},
                    ${resultCount},
                    ${status},
                    ${errorMessage},
                    ${orgContext.userId}
                )
            `);

            // Update saved query stats
            if (status === 'success') {
                await db.execute(sql`
                    UPDATE saved_queries
                    SET 
                        last_run_at = CURRENT_TIMESTAMP,
                        run_count = run_count + 1
                    WHERE id = ${queryId}
                `);
            }
        } catch (error: any) {
            logger.error('Failed to track query execution', error);
            // Don't throw, just log
        }
    },

    /**
     * Get query execution history
     */
    async getQueryHistory(
        queryId: number,
        orgContext: OrgContext,
        limit: number = 10
    ): Promise<any[]> {
        try {
            // Scope through the owning saved query: query_execution_history has no
            // organization_id of its own, so without this join any org could read
            // another org's history by guessing an id.
            const result = await db.execute(sql`
                SELECT h.* FROM query_execution_history h
                JOIN saved_queries q ON q.id = h.query_id
                WHERE h.query_id = ${queryId}
                  AND q.organization_id IS NOT DISTINCT FROM ${orgContext.organizationId}
                ORDER BY h.executed_at DESC
                LIMIT ${limit}
            `);

            return result.rows;
        } catch (error: any) {
            logger.error('Failed to get query history', error);
            throw error;
        }
    }
};


