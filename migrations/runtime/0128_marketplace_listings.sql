-- Migration: 0128_marketplace_listings
-- Adds marketplace_listings table for the Consumer Marketplace / Bot Exchange feature.
-- Published bot packages (agent card snapshots) that can be installed into any org.

CREATE TABLE IF NOT EXISTS "marketplace_listings" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "published_by_user_id" varchar(255) NOT NULL,
    "name" varchar(120) NOT NULL,
    "description" text,
    "category" varchar(60),
    "tags" jsonb DEFAULT '[]'::jsonb,
    "agent_card_snapshot" jsonb NOT NULL,
    "mission_template_snapshot" jsonb,
    "schedule_snapshot" varchar(100),
    "icon_emoji" varchar(8),
    "is_public" boolean NOT NULL DEFAULT true,
    "install_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_marketplace_listings_org"
    ON "marketplace_listings" ("organization_id");

CREATE INDEX IF NOT EXISTS "idx_marketplace_listings_public"
    ON "marketplace_listings" ("is_public", "install_count");
