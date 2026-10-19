import { db } from "@server/database_service.js";
import { forensicEventLog } from "@shared/schema/index.js";
import { sql, gte, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BenchmarkService");

export class BenchmarkService {
    /**
     * Calculates the 'Collective Efficiency' benchmark for the global registry.
     * This is the engine behind Phase 9: Benchmark Leagues.
     */
    async calculateGlobalMetrics() {
        logger.info("[BenchmarkService] Calculating global ecosystem metrics...");

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        try {
            const result = await db.execute(sql`
                SELECT 
                    AVG(reliability) as avg_reliability,
                    AVG(latency) as avg_latency,
                    COUNT(DISTINCT organization_id) as total_orgs
                FROM (
                    SELECT 
                        organization_id,
                        AVG(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100 as reliability,
                        AVG((attributes->>'durationMs')::numeric) as latency
                    FROM forensic_event_log
                    WHERE created_at > ${thirtyDaysAgo.toISOString()}
                    GROUP BY organization_id
                ) as org_stats
            `);

            const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
            const stats = rows[0];

            return {
                globalReliability: Math.round(Number(stats?.avg_reliability || 0)),
                globalLatency: Math.round(Number(stats?.avg_latency || 0)),
                connectedNodes: Number(stats?.total_orgs || 0),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error("[BenchmarkService] Failed to calculate metrics", error);
            throw error;
        }
    }

    /**
     * Generates a league ranking for anonymized organizations.
     */
    async getLeagueTable() {
        logger.info("[BenchmarkService] Generating league rankings...");
        
        try {
            // Aggregate performance across all organizations
            const result = await db.execute(sql`
                SELECT 
                    organization_id,
                    AVG(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100 as reliability,
                    COUNT(*) as total_events
                FROM forensic_event_log
                WHERE job_type = 'uci_skill_execution'
                GROUP BY organization_id
                ORDER BY reliability DESC
                LIMIT 5
            `);

            const rows = Array.isArray(result) ? result : ((result as any).rows ?? []);
            
            // Anonymize the organization names for Goal 9
            const anonymousNodes = ["Alpha-Centauri", "Neural-Node-7", "Ecosystem-0x", "Deep-Structure", "Vortex-Core"];
            
            return (rows as any[]).map((row, i) => ({
                rank: i + 1,
                node: anonymousNodes[i] || `Node-${row.organization_id}`,
                reliability: Math.round(Number(row.reliability || 0)),
                score: row.reliability >= 95 ? "S-Tier" : row.reliability >= 85 ? "A-Tier" : "B-Tier"
            }));
        } catch (error) {
            logger.error("[BenchmarkService] League calculation failed", error);
            return []; // Fallback to mock if db is empty/fails
        }
    }

    /**
     * Exports anonymized metrics as a JSON payload for the federated network.
     */
    async exportAnonymizedTelemetry() {
        logger.info("[BenchmarkService] Packaging anonymized telemetry for export...");
        const league = await this.getLeagueTable();
        const globalMetrics = await this.calculateGlobalMetrics();
        
        return {
            source: "Oddjob-Ecosystem-Sentinel",
            version: "1.2.0-federated",
            timestamp: new Date().toISOString(),
            metrics: globalMetrics,
            ranking: league.map(r => ({
                nodeAlias: r.node,
                tier: r.score,
                efficiency: r.reliability
            }))
        };
    }

    /**
     * Pushes anonymized telemetry to the federated network sink.
     */
    async pushToFederatedNetwork() {
        const payload = await this.exportAnonymizedTelemetry();
        const federatedUrl = process.env.FEDERATED_TELEMETRY_URL;
        
        if (!federatedUrl) {
            logger.info("[BenchmarkService] No federated sink configured. Skipping push.");
            return { success: true, localOnly: true };
        }

        try {
            logger.info(`[BenchmarkService] Pushing telemetry to ${federatedUrl}...`);
            const response = await fetch(federatedUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`Network sink responded with ${response.status}`);
            
            logger.info("[BenchmarkService] Telemetry successfully synchronized with federated network.");
            return { success: true, pushed: true };
        } catch (error: any) {
            logger.error(`[BenchmarkService] Federated sync failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

export const benchmarkService = new BenchmarkService();
