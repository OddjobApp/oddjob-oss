/**
 * Policy Violations Schema
 *
 * Persists every capability policy check that resulted in a violation
 * (blocked in strict mode OR warned in warn/log mode).
 *
 * Used by:
 *  - PolicyViolationService (write path — called from CapabilityPolicyLoader)
 *  - Governor API (read path — list, filter, resolve endpoints)
 */

import {
    pgTable,
    bigserial,
    integer,
    text,
    boolean,
    timestamp,
    index,
} from 'drizzle-orm/pg-core';
import { orgs } from './auth.js';

export const policyViolations = pgTable('policy_violations', {
    id:             bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: integer('organization_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),

    // Actor
    userId:  integer('user_id'),
    agentId: text('agent_id'),
    role:    text('role').notNull(),

    // Capability that was denied
    checkType:  text('check_type').notNull(),   // 'tool' | 'filePath' | 'network' | 'model'
    checkValue: text('check_value').notNull(),   // the tool name, path, hostname, model name

    // Policy context
    enforcement: text('enforcement').notNull(),  // 'strict' | 'warn' | 'log'

    // Execution context (at least one should be set)
    missionId:  integer('mission_id'),
    pipelineId: integer('pipeline_id'),
    jobId:      integer('job_id'),

    // Outcome
    blocked:  boolean('blocked').notNull().default(false),  // true = request blocked
    resolved: boolean('resolved').notNull().default(false), // true = admin acknowledged

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    index('idx_policy_violations_org').on(table.organizationId),
    index('idx_policy_violations_occurred_at').on(table.occurredAt),
    index('idx_policy_violations_check_type').on(table.checkType),
]);

export type PolicyViolationRecord = typeof policyViolations.$inferSelect;
export type NewPolicyViolation    = typeof policyViolations.$inferInsert;
