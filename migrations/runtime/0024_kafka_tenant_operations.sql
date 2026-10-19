ALTER TABLE "kafka_outbox_events" ADD COLUMN IF NOT EXISTS "organization_id" integer;
UPDATE "kafka_outbox_events"
SET "organization_id" = ("payload"->>'organizationId')::integer
WHERE "organization_id" IS NULL;
ALTER TABLE "kafka_outbox_events" ALTER COLUMN "organization_id" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "kafka_outbox_tenant_idx"
  ON "kafka_outbox_events" ("organization_id", "status", "created_at");

ALTER TABLE "kafka_consumed_events" ADD COLUMN IF NOT EXISTS "organization_id" integer;
ALTER TABLE "kafka_consumed_events" ADD COLUMN IF NOT EXISTS "payload" jsonb;
UPDATE "kafka_consumed_events" SET "organization_id" = 0 WHERE "organization_id" IS NULL;
UPDATE "kafka_consumed_events" SET "payload" = '{}'::jsonb WHERE "payload" IS NULL;
ALTER TABLE "kafka_consumed_events" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "kafka_consumed_events" ALTER COLUMN "payload" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "kafka_consumed_tenant_idx"
  ON "kafka_consumed_events" ("organization_id", "status", "created_at");
