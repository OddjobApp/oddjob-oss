import { pgTable, serial, text, varchar, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { pipelineExecutions } from '../pipelines/pipeline-execution.js';

export const transactionLogs = pgTable("transaction_logs", {
    id: serial("id").primaryKey(),
    transactionId: uuid("transaction_id").notNull(),
    executionId: integer("execution_id").references(() => pipelineExecutions.id, { onDelete: 'cascade' }),
    operationType: varchar("operation_type", { length: 100 }).notNull(), // 'file_create', 'db_insert', 'db_update', 'api_call'
    operationParams: jsonb("operation_params").notNull(),
    rollbackData: jsonb("rollback_data"), // Data needed to undo the operation
    status: varchar("status", { length: 50 }).default("pending"), // 'pending', 'committed', 'rolled_back', 'failed'
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow(),
    rolledBackAt: timestamp("rolled_back_at"),
});

export const insertTransactionLogSchema = createInsertSchema(transactionLogs);
export const selectTransactionLogSchema = createSelectSchema(transactionLogs);

export type TransactionLogEntry = typeof transactionLogs.$inferSelect;
export type NewTransactionLogEntry = typeof transactionLogs.$inferInsert;

export interface TransactionOperation {
    type: 'file_create' | 'db_insert' | 'db_update' | 'api_call';
    params: any;
    rollbackData?: any;
}



