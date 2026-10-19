import { db } from "../../../../database_service.js";
import { sql } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("SearchAnalyticsService");

export interface SearchQuery {
    id?: number;
    organizationId?: number | null;
    userId?: string;
    query: string;
    searchMode: 'keyword' | 'semantic' | 'hybrid' | 'graph';
    similarityThreshold?: number;
    maxResults?: number;
    resultsCount?: number;
    executionTimeMs?: number;
    createdAt?: Date;
}

export interface SearchInteraction {
    searchQueryId: number;
    resultId: string;
    resultType: string;
    resultPosition?: number;
    interactionType: 'click' | 'view' | 'copy' | 'export';
}

export interface PopularQuery {
    query: string;
    searchMode: string;
    searchCount: number;
    avgResults: number;
    avgExecutionTimeMs: number;
    lastSearchedAt: Date;
}

export interface SearchAnalytics {
    totalSearches: number;
    avgExecutionTime: number;
    avgResultsPerSearch: number;
    searchesByMode: Record<string, number>;
    popularQueries: PopularQuery[];
    avgCtr: number;
}

export const searchAnalyticsService = {
    /**
     * Track a search query
     */
    async trackSearch(searchQuery: SearchQuery): Promise<number> {
        try {
            const result = await db.execute(sql`
                INSERT INTO search_queries (
                    organization_id,
                    user_id,
                    query,
                    search_mode,
                    similarity_threshold,
                    max_results,
                    results_count,
                    execution_time_ms
                ) VALUES (
                    ${searchQuery.organizationId || null},
                    ${searchQuery.userId || null},
                    ${searchQuery.query},
                    ${searchQuery.searchMode},
                    ${searchQuery.similarityThreshold || null},
                    ${searchQuery.maxResults || null},
                    ${searchQuery.resultsCount || 0},
                    ${searchQuery.executionTimeMs || null}
                )
                RETURNING id
            `);

            const queryId = Number(result.rows[0]?.id);
            logger.info(`Tracked search query ${queryId}`);
            return queryId;
        } catch (error) {
            logger.error("Failed to track search query", error);
            throw error;
        }
    },

    /**
     * Track a search interaction (click, view, etc.)
     */
    async trackInteraction(interaction: SearchInteraction): Promise<void> {
        try {
            await db.execute(sql`
                INSERT INTO search_interactions (
                    search_query_id,
                    result_id,
                    result_type,
                    result_position,
                    interaction_type
                ) VALUES (
                    ${interaction.searchQueryId},
                    ${interaction.resultId},
                    ${interaction.resultType},
                    ${interaction.resultPosition || null},
                    ${interaction.interactionType}
                )
            `);

            logger.info(`Tracked ${interaction.interactionType} interaction for query ${interaction.searchQueryId}`);
        } catch (error) {
            logger.error("Failed to track interaction", error);
            throw error;
        }
    },

    /**
     * Get popular queries
     */
    async getPopularQueries(limit: number = 10): Promise<PopularQuery[]> {
        try {
            const result = await db.execute(sql`
                SELECT 
                    query,
                    search_mode,
                    search_count,
                    avg_results,
                    avg_execution_time_ms,
                    last_searched_at
                FROM popular_search_queries
                ORDER BY search_count DESC
                LIMIT ${limit}
            `);

            return result.rows as unknown as PopularQuery[];
        } catch (error) {
            logger.error("Failed to get popular queries", error);
            return [];
        }
    },

    /**
     * Get search analytics for a time period
     */
    async getAnalytics(
        organizationId: number | null,
        days: number = 30
    ): Promise<SearchAnalytics> {
        try {
            // Total searches and averages
            const statsResult = await db.execute(sql`
                SELECT 
                    COUNT(*) as total_searches,
                    AVG(execution_time_ms) as avg_execution_time,
                    AVG(results_count) as avg_results_per_search
                FROM search_queries
                WHERE created_at >= CURRENT_DATE - INTERVAL '${sql.raw(days.toString())} days'
                    ${organizationId !== null ? sql`AND organization_id = ${organizationId}` : sql``}
            `);

            const stats = statsResult.rows[0] || {
                total_searches: 0,
                avg_execution_time: 0,
                avg_results_per_search: 0
            };

            // Searches by mode
            const modeResult = await db.execute(sql`
                SELECT 
                    search_mode,
                    COUNT(*) as count
                FROM search_queries
                WHERE created_at >= CURRENT_DATE - INTERVAL '${sql.raw(days.toString())} days'
                    ${organizationId !== null ? sql`AND organization_id = ${organizationId}` : sql``}
                GROUP BY search_mode
            `);

            const searchesByMode: Record<string, number> = {};
            modeResult.rows.forEach((row: any) => {
                searchesByMode[row.search_mode] = Number(row.count);
            });

            // Popular queries
            const popularQueries = await this.getPopularQueries(10);

            // Average CTR
            const ctrResult = await db.execute(sql`
                SELECT AVG(ctr) as avg_ctr
                FROM (
                    SELECT 
                        sq.id,
                        CASE 
                            WHEN sq.results_count > 0 
                            THEN COUNT(DISTINCT si.result_id)::DECIMAL / sq.results_count::DECIMAL
                            ELSE 0
                        END as ctr
                    FROM search_queries sq
                    LEFT JOIN search_interactions si ON sq.id = si.search_query_id AND si.interaction_type = 'click'
                    WHERE sq.created_at >= CURRENT_DATE - INTERVAL '${sql.raw(days.toString())} days'
                        ${organizationId !== null ? sql`AND sq.organization_id = ${organizationId}` : sql``}
                    GROUP BY sq.id, sq.results_count
                ) ctr_data
            `);

            const avgCtr = Number(ctrResult.rows[0]?.avg_ctr || 0);

            return {
                totalSearches: Number(stats.total_searches),
                avgExecutionTime: Number(stats.avg_execution_time || 0),
                avgResultsPerSearch: Number(stats.avg_results_per_search || 0),
                searchesByMode,
                popularQueries,
                avgCtr
            };
        } catch (error) {
            logger.error("Failed to get search analytics", error);
            return {
                totalSearches: 0,
                avgExecutionTime: 0,
                avgResultsPerSearch: 0,
                searchesByMode: {},
                popularQueries: [],
                avgCtr: 0
            };
        }
    },

    /**
     * Refresh popular queries materialized view
     */
    async refreshPopularQueries(): Promise<void> {
        try {
            await db.execute(sql`SELECT refresh_popular_queries()`);
            logger.info("Refreshed popular queries view");
        } catch (error) {
            logger.error("Failed to refresh popular queries", error);
        }
    }
};


