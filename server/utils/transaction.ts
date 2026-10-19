/**
 * Database Transaction Helper
 * 
 * Provides utilities for wrapping multi-step database operations in transactions.
 * Ensures atomicity - either all operations succeed or all are rolled back.
 */

import { db, pool } from "../database_service.js";
import { sql } from "drizzle-orm";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("Transaction");

export interface TransactionContext {
    client: any;
    query: (text: string, params?: any[]) => Promise<any>;
}

/**
 * Execute a function within a database transaction
 * 
 * Usage:
 * ```typescript
 * await withTransaction(async (tx) => {
 *     await tx.client.query('INSERT INTO users...', [...]);
 *     await tx.client.query('INSERT INTO profiles...', [...]);
 *     // If any query fails, all are rolled back
 * });
 * ```
 */
export async function withTransaction<T>(
    fn: (tx: TransactionContext) => Promise<T>
): Promise<T> {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const tx: TransactionContext = {
            client,
            query: (text: string, params?: any[]) => client.query(text, params),
        };

        const result = await fn(tx);

        await client.query("COMMIT");
        logger.debug("Transaction committed");

        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        logger.warn("Transaction rolled back", { error: (error as Error).message });
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Execute Drizzle operations within a transaction
 * 
 * Usage:
 * ```typescript
 * await withDrizzleTransaction(async () => {
 *     await db.insert(users).values({...});
 *     await db.insert(profiles).values({...});
 * });
 * ```
 * 
 * Note: This uses advisory locks for simple transaction-like behavior.
 * For true ACID transactions, use withTransaction with raw SQL.
 */
export async function withDrizzleTransaction<T>(
    fn: () => Promise<T>,
    lockId?: number
): Promise<T> {
    const advisoryLockId = lockId ?? Math.floor(Math.random() * 1000000);

    try {
        // Acquire advisory lock
        await db.execute(sql`SELECT pg_advisory_lock(${advisoryLockId})`);

        const result = await fn();

        return result;
    } finally {
        // Release advisory lock
        await db.execute(sql`SELECT pg_advisory_unlock(${advisoryLockId})`);
    }
}

/**
 * Retry a transaction on serialization failure
 * 
 * Useful for high-concurrency scenarios where transactions may conflict.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; backoffMs?: number } = {}
): Promise<T> {
    const { maxRetries = 3, backoffMs = 100 } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Check if it's a serialization failure (can retry)
            const isRetryable =
                error.code === "40001" || // Serialization failure
                error.code === "40P01" || // Deadlock detected
                error.message?.includes("could not serialize");

            if (!isRetryable || attempt >= maxRetries - 1) {
                throw error;
            }

            logger.debug(`Transaction retry ${attempt + 1}/${maxRetries}`, {
                error: error.message,
            });

            // Exponential backoff
            await new Promise(resolve =>
                setTimeout(resolve, backoffMs * Math.pow(2, attempt))
            );
        }
    }

    throw lastError;
}

/**
 * Execute multiple operations atomically using a savepoint
 * 
 * Allows partial rollback within a larger transaction.
 */
export async function withSavepoint<T>(
    tx: TransactionContext,
    name: string,
    fn: (tx: TransactionContext) => Promise<T>
): Promise<T> {
    const savepointName = `sp_${name}_${Date.now()}`;

    try {
        await tx.query(`SAVEPOINT ${savepointName}`);
        const result = await fn(tx);
        await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
        return result;
    } catch (error) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        throw error;
    }
}

