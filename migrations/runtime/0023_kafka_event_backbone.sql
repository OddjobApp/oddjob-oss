CREATE TABLE IF NOT EXISTS "kafka_outbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "topic" text NOT NULL,
  "partition_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "kafka_outbox_event_id_unique" ON "kafka_outbox_events" ("event_id");
CREATE INDEX IF NOT EXISTS "kafka_outbox_relay_idx" ON "kafka_outbox_events" ("status", "available_at");

CREATE TABLE IF NOT EXISTS "kafka_consumed_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "consumer_group" text NOT NULL,
  "topic" text NOT NULL,
  "partition" integer NOT NULL,
  "offset" text NOT NULL,
  "status" text DEFAULT 'processing' NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  "last_error" text,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "kafka_consumed_idempotency_unique" ON "kafka_consumed_events" ("consumer_group", "event_id");
CREATE INDEX IF NOT EXISTS "kafka_consumed_status_idx" ON "kafka_consumed_events" ("consumer_group", "status");
