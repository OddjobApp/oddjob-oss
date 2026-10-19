-- Publish ordering for the Kafka outbox relay.
--
-- The relay read its pending batch with no ORDER BY, and had nothing to order
-- on even if it had tried: the primary key is a random uuid, so it carries no
-- insertion order, and created_at ties for every row written in one
-- transaction. Postgres was therefore free to hand back events in any order,
-- which put same-key events on the topic reversed and made Kafka's
-- per-partition ordering guarantee useless.
--
-- bigserial gives the relay a monotonic column to sort on. Existing rows are
-- numbered in whatever order the backfill visits them, which is the best that
-- can be reconstructed after the fact.

ALTER TABLE "kafka_outbox_events" ADD COLUMN IF NOT EXISTS "sequence" bigserial;
--> statement-breakpoint
-- Replaces the (status, available_at) relay index: the trailing sequence lets
-- the ordered scan be served straight from the index.
DROP INDEX IF EXISTS "kafka_outbox_relay_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kafka_outbox_relay_idx"
  ON "kafka_outbox_events" ("status", "available_at", "sequence");
