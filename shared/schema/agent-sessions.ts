
import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const agentSessions = pgTable('agent_sessions', {
    id: serial('id').primaryKey(),
    sessionId: text('session_id').notNull().unique(),
    goal: text('goal').notNull(),
    progress: jsonb('progress').$type<any[]>(),
    status: text('status', { enum: ['running', 'hibernating', 'completed', 'failed'] }).notNull(),
    nextWakeUp: timestamp('next_wake_up'),
    organizationId: integer('organization_id'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});


