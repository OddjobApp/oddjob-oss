-- Mission patterns learned from outcomes.
--
-- Previously these lived only on a module-level array that addPattern() pushed
-- to, so anything learned was discarded on restart. Organization-scoped so a
-- pattern inferred from one tenant's missions cannot steer another's planning.

CREATE TABLE IF NOT EXISTS "mission_learned_patterns" (
    "id" serial PRIMARY KEY NOT NULL,
    "pattern_key" varchar(120) NOT NULL,
    "organization_id" integer NOT NULL,
    "name" varchar(200) NOT NULL,
    "objective_pattern" varchar(500) NOT NULL,
    "pipeline_sequence" jsonb NOT NULL,
    "common_tools" jsonb NOT NULL,
    "risk_factors" jsonb NOT NULL,
    "estimated_duration" real NOT NULL,
    "success_rate" real NOT NULL,
    "avg_tool_calls" real NOT NULL,
    "sample_size" integer DEFAULT 0 NOT NULL,
    "confidence" real DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mission_learned_patterns_org_idx"
    ON "mission_learned_patterns" ("organization_id");

CREATE INDEX IF NOT EXISTS "mission_learned_patterns_key_idx"
    ON "mission_learned_patterns" ("pattern_key");

-- One pattern key per organization: re-learning a pattern updates it in place
-- rather than accumulating near-duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "mission_learned_patterns_org_key_uniq"
    ON "mission_learned_patterns" ("organization_id", "pattern_key");
