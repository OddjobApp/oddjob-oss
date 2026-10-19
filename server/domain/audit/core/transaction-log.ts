import { db } from "@server/database_service.js";
import { transactionLogs, type TransactionOperation } from "@shared/schema/index.js";
import { v4 as uuidv4 } from "uuid";
import { sql, eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("TransactionLogService");

/**
 * Transaction Log Class
 * Manages a set of reversible operations for a specific task or agent execution.
 */
export class TransactionLog {
    public readonly transactionId: string;
    private executionId?: number;
    private operations: TransactionOperation[] = [];
    private committed: boolean = false;
    private rolledBack: boolean = false;

    constructor(executionId?: number) {
        this.transactionId = uuidv4();
        this.executionId = executionId;
    }

    /**
     * Log an operation that can be reversed.
     */
    async logOperation(operation: TransactionOperation): Promise<void> {
        if (this.committed || this.rolledBack) {
            throw new Error("Cannot add operations to a completed transaction.");
        }

        try {
            await db.insert(transactionLogs).values({
                transactionId: this.transactionId,
                executionId: this.executionId,
                operationType: operation.type,
                operationParams: operation.params,
                rollbackData: operation.rollbackData,
                status: "pending"
            });

            this.operations.push(operation);
            logger.info(`Logged reversible operation: ${operation.type} in transaction ${this.transactionId}`);
        } catch (error) {
            logger.error(`Failed to log transaction operation: ${error}`);
            throw error;
        }
    }

    /**
     * Commit the transaction (mark all operations as success).
     */
    async commit(): Promise<void> {
        if (this.rolledBack) throw new Error("Cannot commit a rolled-back transaction.");

        await db.update(transactionLogs)
            .set({ status: "committed" })
            .where(eq(transactionLogs.transactionId, this.transactionId));

        this.committed = true;
        logger.info(`Transaction ${this.transactionId} committed.`);
    }

    /**
     * Rollback all operations in REVERSE order.
     */
    async rollback(): Promise<void> {
        if (this.committed) {
            logger.warn(`Attempting to rollback a committed transaction ${this.transactionId}. Proceeding anyway for safety.`);
        }

        if (this.rolledBack) return;

        logger.info(`Starting rollback for transaction ${this.transactionId}...`);

        // Reverse operations list to undo last-to-first
        const opsToUndo = [...this.operations].reverse();

        for (const op of opsToUndo) {
            try {
                await this.executeRollback(op);
            } catch (error) {
                logger.error(`Failed to undo operation ${op.type}: ${error}`);
                // We continue rolling back other operations even if one fails
            }
        }

        await db.update(transactionLogs)
            .set({
                status: "rolled_back",
                rolledBackAt: new Date()
            })
            .where(eq(transactionLogs.transactionId, this.transactionId));

        this.rolledBack = true;
        logger.info(`Transaction ${this.transactionId} rolled back.`);
    }

    /**
     * Dispatch to the correct rollback handler
     */
    private async executeRollback(op: TransactionOperation): Promise<void> {
        switch (op.type) {
            case "file_create":
                await this.rollbackFileCreate(op);
                break;
            case "db_insert":
                await this.rollbackDbInsert(op);
                break;
            case "db_update":
                await this.rollbackDbUpdate(op);
                break;
            case "api_call":
                await this.rollbackApiCall(op);
                break;
            default:
                logger.warn(`No rollback handler for operation type: ${op.type}`);
        }
    }

    /**
     * Rollback Handlers
     */

    private async rollbackFileCreate(op: TransactionOperation): Promise<void> {
        const { organizationId, relativePath } = op.params;
        const { fileStorage } = await import("@domain/knowledge/index.js");
        logger.info(`Undoing file creation: ${relativePath}`);
        await fileStorage.deleteFile(organizationId, relativePath);
    }

    private async rollbackDbInsert(op: TransactionOperation): Promise<void> {
        const { table, id, ids } = op.params;

        if (ids && Array.isArray(ids) && ids.length > 0) {
            logger.info(`Undoing batch DB insert in ${table} (${ids.length} items)`);
            const idList = ids.map(Number).join(',');
            await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE id = ANY(ARRAY[${sql.raw(idList)}]::int[])`);
        } else if (id) {
            logger.info(`Undoing DB insert in ${table} (ID: ${id})`);
            await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE id = ${id}`);
        }
    }

    private async rollbackDbUpdate(op: TransactionOperation): Promise<void> {
        const { table, id } = op.params;
        const oldValues = op.rollbackData;
        if (!oldValues) return;

        logger.info(`Undoing DB update in ${table} (ID: ${id})`);

        // Construct dynamic update
        const columns = Object.keys(oldValues);
        const setClause = columns.map(col => `${col} = ${JSON.stringify(oldValues[col])}`).join(", ");

        await db.execute(sql`
      UPDATE ${sql.raw(table)} 
      SET ${sql.raw(setClause)} 
      WHERE id = ${id}
    `);
    }

    private async rollbackApiCall(op: TransactionOperation): Promise<void> {
        logger.warn(`Rollback for API call (${op.params.url}) is best-effort and currently only logs a warning.`);
        // Implement compensation logic if possible (e.g. DELETE after POST)
    }
}

/**
 * Global Transaction Logger Service
 */
export const transactionLogService = {
    /**
     * Create a new transaction context
     */
    startTransaction(executionId?: number): TransactionLog {
        return new TransactionLog(executionId);
    }
};


