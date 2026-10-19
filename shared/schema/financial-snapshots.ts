import {pgTable,uuid,integer,text,jsonb,timestamp,uniqueIndex,index} from 'drizzle-orm/pg-core';
import type {FinancialSnapshotView} from '../financial-snapshots.js';
export const financialSnapshots=pgTable('financial_snapshots',{
 id:uuid('id').primaryKey(), organizationId:integer('organization_id').notNull(), projectId:integer('project_id'), sessionId:integer('session_id').notNull(),
 name:text('name').notNull(), status:text('status').$type<'draft'|'saved'>().notNull().default('draft'),
 sourceTurnId:integer('source_turn_id').notNull(), sourceArtifactIndex:integer('source_artifact_index').notNull(),
 dedupeKey:text('dedupe_key').notNull(), payload:jsonb('payload').$type<FinancialSnapshotView>().notNull(),
 sourcePayload:jsonb('source_payload').notNull(), createdBy:text('created_by').notNull(),
 createdAt:timestamp('created_at').notNull().defaultNow(), savedAt:timestamp('saved_at'),
},t=>[uniqueIndex('financial_snapshots_dedupe_idx').on(t.dedupeKey),index('financial_snapshots_scope_idx').on(t.organizationId,t.projectId,t.status)]);
