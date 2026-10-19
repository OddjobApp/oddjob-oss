
import { db, pool } from "../database_service.js";
import { createLogger } from "../utils/logger.js";
import { sql } from "drizzle-orm";

const logger = createLogger("InfrastructureProtocol");

export interface HealthCheckResult {
    healthy: boolean;
    issues: string[];
    details?: any;
}

export const infrastructureProtocol = {
    /**
     * Verify that the database schema matches the expected state for critical mission features.
     */
    async verifySchemaHealth(): Promise<HealthCheckResult> {
        const issues: string[] = [];

        try {
            // 1. Check for critical scheduling columns in 'missions'
            const missionColumns = await this.getTableColumns('missions');
            const requiredMissionCols = ['is_scheduled', 'schedule_id', 'organization_id'];

            for (const col of requiredMissionCols) {
                if (!missionColumns.includes(col)) {
                    issues.push(`Missing critical column 'missions.${col}'`);
                }
            }

            // 2. Check for critical job columns
            const jobColumns = await this.getTableColumns('jobs');
            if (!jobColumns.includes('type')) {
                issues.push("Missing critical column 'jobs.type'");
            }

            return {
                healthy: issues.length === 0,
                issues
            };
        } catch (err: any) {
            logger.error("Schema health check failed", err);
            return {
                healthy: false,
                issues: [`Database connection or query error: ${err.message}`]
            };
        }
    },

    /**
     * Get list of column names for a table via information_schema
     */
    async getTableColumns(tableName: string): Promise<string[]> {
        const result = await db.execute(sql`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = ${tableName}
        `);

        return result.rows.map((row: any) => row.column_name);
    },

    /**
     * Perform full pre-flight check for a mission run
     */
    async performPreFlightCheck(): Promise<HealthCheckResult> {
        logger.info("Performing infrastructure pre-flight check...");

        const schemaResult = await this.verifySchemaHealth();
        if (!schemaResult.healthy) {
            logger.error("Infrastructure pre-flight FAILED", { issues: schemaResult.issues });
        } else {
            logger.info("Infrastructure pre-flight PASSED");
        }

        return schemaResult;
    }
};



