CREATE TABLE IF NOT EXISTS "cycle_signal_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "operational_cycles"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "delivery_mode" text DEFAULT 'context_only' NOT NULL,
  "state_projection" jsonb DEFAULT '{"namespace":"external_environment","reducer":"latest"}'::jsonb NOT NULL,
  "cooldown_minutes" integer DEFAULT 0 NOT NULL,
  "last_delivered_at" timestamp,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "cycle_signal_subscriptions_delivery_mode_check"
    CHECK ("delivery_mode" IN ('context_only', 'replan', 'trigger', 'gate', 'notify'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cycle_signal_subscriptions_org" ON "cycle_signal_subscriptions" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cycle_signal_subscriptions_cycle" ON "cycle_signal_subscriptions" ("cycle_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_world_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "operational_cycles"("id") ON DELETE cascade,
  "version" integer DEFAULT 0 NOT NULL,
  "variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "material_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_event_primitive_id" uuid REFERENCES "event_primitives"("id") ON DELETE set null,
  "last_state_transition_id" uuid REFERENCES "state_transition_events"("id") ON DELETE set null,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_world_states_cycle_unique" ON "cycle_world_states" ("cycle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cycle_world_states_org" ON "cycle_world_states" ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_signal_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "subscription_id" integer NOT NULL REFERENCES "cycle_signal_subscriptions"("id") ON DELETE cascade,
  "cycle_id" integer NOT NULL REFERENCES "operational_cycles"("id") ON DELETE cascade,
  "event_primitive_id" uuid NOT NULL REFERENCES "event_primitives"("id") ON DELETE cascade,
  "state_transition_id" uuid REFERENCES "state_transition_events"("id") ON DELETE set null,
  "status" text DEFAULT 'delivered' NOT NULL,
  "disposition" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "delivered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_signal_deliveries_subscription_event_unique" ON "cycle_signal_deliveries" ("subscription_id", "event_primitive_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cycle_signal_deliveries_cycle" ON "cycle_signal_deliveries" ("cycle_id", "delivered_at");
