
import { pool } from "../db/index.js";
import { createLogger } from "./logger.js";

const logger = createLogger("SchemaCheck");

export async function verifyCriticalSchema() {
    logger.info("Verifying critical database schema...");
    const criticalColumns = [
        { table: 'pipeline_step_executions', column: 'sleep_until' },
        { table: 'mission_runs', column: 'dynamic_trace' },
        { table: 'missions', column: 'execution_strategy' }
    ];

    for (const item of criticalColumns) {
        try {
            const res = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = $1 AND column_name = $2
            `, [item.table, item.column]);

            if (res.rows.length === 0) {
                logger.error(`CRITICAL SCHEMA MISMATCH: Column "${item.column}" is missing from table "${item.table}".`);
                // Auto-fix: Try to add the column if missing (Optional, but safer to just log and alert for now)
                // For sleep_until specifically, we can try to add it as it's a common point of failure
                if (item.column === 'sleep_until' && item.table === 'pipeline_step_executions') {
                    logger.warn(`Attempting to auto-fix missing column "${item.column}"...`);
                    await pool.query(`ALTER TABLE pipeline_step_executions ADD COLUMN IF NOT EXISTS sleep_until timestamp without time zone`);
                    logger.info(`Column "${item.column}" added successfully.`);
                }
            } else {
                logger.info(`Schema check passed for ${item.table}.${item.column}`);
            }
        } catch (err: any) {
            logger.error(`Failed to verify schema for ${item.table}.${item.column}: ${err.message}`);
        }
    }
}

