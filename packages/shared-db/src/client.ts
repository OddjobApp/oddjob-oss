/**
 * Database Client Factory
 * 
 * Creates and exports the Drizzle database client.
 * Supports environment-based configuration for different services.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

// Environment variables
const DATABASE_URL = process.env.DATABASE_URL;

// Singleton pool instance
let pool: pg.Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

/**
 * Get or create the database pool
 */
function getPool(): pg.Pool {
    if (!pool) {
        if (!DATABASE_URL) {
            throw new Error("DATABASE_URL environment variable is required");
        }

        pool = new Pool({
            connectionString: DATABASE_URL,
            max: 20, // Maximum connections
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });

        // Handle pool errors
        pool.on("error", (err) => {
            console.error("[shared-db] Pool error:", err);
        });
    }
    return pool;
}

/**
 * Get the Drizzle database instance
 */
export function getDb(): NodePgDatabase<typeof schema> {
    if (!dbInstance) {
        dbInstance = drizzle(getPool(), { schema });
    }
    return dbInstance;
}

/**
 * Singleton database instance
 * Use this for most cases where you need database access
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
    get: (_, prop) => {
        const instance = getDb();
        return (instance as any)[prop];
    },
});

/**
 * Check database connectivity
 */
export async function checkConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
        const client = await getPool().connect();
        await client.query("SELECT 1");
        client.release();
        return { connected: true };
    } catch (error: any) {
        return { connected: false, error: error.message };
    }
}

/**
 * Gracefully close database connections
 */
export async function closeDatabase(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
        dbInstance = null;
    }
}

// Type export for use in other modules
export type Database = NodePgDatabase<typeof schema>;

