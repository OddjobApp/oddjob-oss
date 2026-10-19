import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const kafkaOutboxEvents = pgTable('kafka_outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Publish order. The primary key is a RANDOM uuid, so it says nothing about
   * insertion order and `created_at` ties for everything written in one
   * transaction — without this column the relay had no column to sort on and
   * published in whatever order the planner happened to return, which silently
   * defeats Kafka's per-partition ordering guarantee.
   *
   * Caveat: values are assigned at INSERT, so a transaction that starts earlier
   * but commits later can still be relayed after a higher sequence. That window
   * is bounded by transaction duration and is far narrower than unordered
   * reads; closing it entirely needs commit-order tracking.
   */
  sequence: bigserial('sequence', { mode: 'number' }).notNull(),
  organizationId: integer('organization_id').notNull(),
  eventId: uuid('event_id').notNull(),
  topic: text('topic').notNull(),
  partitionKey: text('partition_key').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  eventIdUnique: uniqueIndex('kafka_outbox_event_id_unique').on(table.eventId),
  // Trailing `sequence` lets the relay's ordered scan come straight off the index.
  relayIndex: index('kafka_outbox_relay_idx').on(table.status, table.availableAt, table.sequence),
  tenantIndex: index('kafka_outbox_tenant_idx').on(table.organizationId, table.status, table.createdAt),
}));

export const kafkaConsumedEvents = pgTable('kafka_consumed_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: integer('organization_id').notNull(),
  eventId: uuid('event_id').notNull(),
  consumerGroup: text('consumer_group').notNull(),
  topic: text('topic').notNull(),
  partition: integer('partition').notNull(),
  offset: text('offset').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('processing'),
  attempts: integer('attempts').notNull().default(1),
  lastError: text('last_error'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  idempotencyUnique: uniqueIndex('kafka_consumed_idempotency_unique').on(table.consumerGroup, table.eventId),
  statusIndex: index('kafka_consumed_status_idx').on(table.consumerGroup, table.status),
  tenantIndex: index('kafka_consumed_tenant_idx').on(table.organizationId, table.status, table.createdAt),
}));

export type KafkaOutboxEvent = typeof kafkaOutboxEvents.$inferSelect;
export type KafkaConsumedEvent = typeof kafkaConsumedEvents.$inferSelect;
