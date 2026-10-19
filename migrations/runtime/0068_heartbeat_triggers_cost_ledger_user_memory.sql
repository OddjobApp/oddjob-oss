-- heartbeat_triggers, cost_ledger, user_memory.
--
-- All three come from the legacy root chain's 0065_slow_stephen_strange.sql,
-- which this database never reached — its applied chain stops earlier, and most
-- root-chain .sql files are no longer in the repository, so replaying 0065 is
-- not an option. They ARE in migrations/runtime/20260717213750_baseline.sql,
-- but the baseline only ever builds a fresh database; it is skipped on any
-- existing one. Hence a targeted forward migration.
--
-- DDL below is taken from the baseline, which drizzle generated from
-- shared/schema — heartbeat-triggers.ts, cost-ledger.ts and user-memory.ts —
-- and re-checked against those files column by column.
--
-- What was dark while these were missing:
--   * HeartbeatWorker could not schedule any polling trigger at startup
--     ("Failed to schedule heartbeat triggers on startup").
--   * costLedgerService.record() is called from trackSpend() on every LLM call
--     and swallows its own errors so cost recording cannot block an agent — so
--     every per-call cost row was silently dropped, and the org cost views in
--     routes/org-hierarchy.ts had nothing to read. (Org-level month spend on
--     org_settings is a separate column and was unaffected.)
--   * userMemoryService backs both a registered agent tool and the assistant's
--     system-prompt injection, so durable per-user memory never stored or
--     recalled anything.
--
-- Written idempotently throughout.

CREATE TABLE IF NOT EXISTS "heartbeat_triggers" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" integer NOT NULL,
    "agent_deployment_id" integer,
    "name" varchar(120) NOT NULL,
    "description" text,
    "source_type" varchar(50) NOT NULL,
    "source_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "polling_interval_ms" integer DEFAULT 60000 NOT NULL,
    "last_item_id" text,
    "last_polled_at" timestamp,
    "mission_title_template" text,
    "mission_priority" varchar(20) DEFAULT 'normal',
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" text DEFAULT 'system' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cost_ledger" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" integer NOT NULL,
    "agent_deployment_id" integer,
    "mission_id" integer,
    "session_id" text,
    "model" text NOT NULL,
    "provider" text DEFAULT 'openai' NOT NULL,
    "tokens_prompt" integer DEFAULT 0 NOT NULL,
    "tokens_completion" integer DEFAULT 0 NOT NULL,
    "tokens_total" integer DEFAULT 0 NOT NULL,
    "cost_usd" numeric(14, 6) DEFAULT '0.000000' NOT NULL,
    "recorded_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_memory" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "organization_id" integer,
    "content" text NOT NULL,
    "kind" text DEFAULT 'fact' NOT NULL,
    "source" text DEFAULT 'assistant' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Foreign keys. `orgs` is keyed on org_id, not id — the schema's
-- references(() => orgs.id) maps to that column.
-- cost_ledger.mission_id deliberately carries NO foreign key: the schema
-- declares it as a plain integer.
DO $$ BEGIN
    ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_org_id_orgs_org_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_agent_deployment_id_agent_deployments_id_fk"
        FOREIGN KEY ("agent_deployment_id") REFERENCES "agent_deployments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_org_id_orgs_org_id_fk"
        FOREIGN KEY ("org_id") REFERENCES "orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_agent_deployment_id_agent_deployments_id_fk"
        FOREIGN KEY ("agent_deployment_id") REFERENCES "agent_deployments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "user_memory" ADD CONSTRAINT "user_memory_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_heartbeat_triggers_org"
    ON "heartbeat_triggers" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_heartbeat_triggers_active"
    ON "heartbeat_triggers" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_heartbeat_triggers_agent"
    ON "heartbeat_triggers" ("agent_deployment_id");
CREATE INDEX IF NOT EXISTS "idx_cost_ledger_org_recorded"
    ON "cost_ledger" ("org_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_cost_ledger_agent"
    ON "cost_ledger" ("agent_deployment_id");
CREATE INDEX IF NOT EXISTS "idx_cost_ledger_mission"
    ON "cost_ledger" ("mission_id");
CREATE INDEX IF NOT EXISTS "user_memory_user_idx"
    ON "user_memory" ("user_id");
CREATE INDEX IF NOT EXISTS "user_memory_user_org_idx"
    ON "user_memory" ("user_id", "organization_id");
