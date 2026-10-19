-- The four drift-baseline entries that have live consumers.
--
-- Reviewing the remaining backlog from `npm run check:schema-drift` split it
-- cleanly: four objects are read or written by mounted routes and services, and
-- three are declarations nothing references. This migration creates the four.
-- The other three are left in the baseline deliberately — creating tables no
-- code reads would satisfy the checker while adding dead schema, which is the
-- opposite of the point.
--
--   assembly_manifests            <- sdlc-pipeline/dehydration.service.ts inserts
--   evaluation_promotions         <- routes/evaluation-studio.ts selects + inserts
--   xray_node_documentation       <- xray/xray-node-detail.service.ts + seed script
--   ml_model_versions.default_tags <- knowledge/calculations.route.ts selects the table
--
-- The last is a column, not a table, and is the subtler failure: the table
-- exists, so nothing looks wrong, but drizzle selects every declared column —
-- so `GET /api/.../models` has been failing on a table that is right there.

-- ---------------------------------------------------------------------------
-- assembly_manifests — frozen build manifests from the SDLC dehydration step
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assembly_manifests (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id),

  -- e.g. "asm_984f2a10_prod". Unique because it is the external handle a build
  -- is referred to by.
  assembly_id TEXT NOT NULL UNIQUE,
  intent TEXT NOT NULL,
  author_agent TEXT NOT NULL DEFAULT 'antigravity-supervisor-v1',

  manifest_yaml TEXT NOT NULL,
  spec_payload JSONB NOT NULL,
  artifact_hashes JSONB DEFAULT '{}'::jsonb,

  build_status TEXT NOT NULL DEFAULT 'pending',
  docker_image_tag TEXT,
  endpoint_url TEXT,
  latency_p95_ms NUMERIC(7,2),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asm_manifest_org_idx ON assembly_manifests (organization_id);
CREATE INDEX IF NOT EXISTS asm_manifest_id_idx ON assembly_manifests (assembly_id);
CREATE INDEX IF NOT EXISTS asm_manifest_status_idx ON assembly_manifests (build_status);

-- ---------------------------------------------------------------------------
-- evaluation_promotions — which candidate run was promoted over which baseline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evaluation_promotions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  test_set_id INTEGER NOT NULL REFERENCES evaluation_test_sets(id) ON DELETE CASCADE,
  candidate_run_id INTEGER NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  -- SET NULL rather than CASCADE: losing the baseline run must not erase the
  -- record that a promotion happened.
  baseline_run_id INTEGER REFERENCES evaluation_runs(id) ON DELETE SET NULL,

  assessment JSONB NOT NULL,
  reason TEXT,
  promoted_by TEXT NOT NULL,
  promoted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evaluation_promotions_org_set_idx
  ON evaluation_promotions (organization_id, test_set_id);
CREATE INDEX IF NOT EXISTS evaluation_promotions_candidate_idx
  ON evaluation_promotions (candidate_run_id);

-- ---------------------------------------------------------------------------
-- xray_node_documentation — per-node docs, with the fingerprint the sync uses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xray_node_documentation (
  id SERIAL PRIMARY KEY,
  -- Nullable: platform-level node docs belong to no organisation.
  organization_id INTEGER REFERENCES orgs(org_id),
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  -- What docs:sync compares to decide a spec needs regenerating.
  content_fingerprint TEXT,
  documentation_status TEXT NOT NULL DEFAULT 'up-to-date',
  tags JSONB DEFAULT '[]'::jsonb,
  author_id INTEGER,
  is_ai_generated BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  knowledge_topic_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS xray_node_doc_node_id_idx ON xray_node_documentation (node_id);
CREATE INDEX IF NOT EXISTS xray_node_doc_org_node_idx
  ON xray_node_documentation (organization_id, node_id);

-- ---------------------------------------------------------------------------
-- ml_model_versions.default_tags
-- ---------------------------------------------------------------------------
-- Declared as `tags: jsonb("default_tags")`, so the property and the column
-- differ — which is why a search for "default_tags" in the schema finds only
-- one line and it is easy to miss.
--
-- Guarded on the table existing. In the chain 0039_ml_inference creates it long
-- before this runs, but a database that has not reached 0039 would otherwise
-- fail here — and because postgres treats a multi-statement migration as one
-- implicit transaction, that single ALTER would roll back the three tables
-- above with it. A missing table is not silently ignored either way: the drift
-- check reports ml_model_versions itself as absent, which is the more accurate
-- complaint.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'ml_model_versions') THEN
    ALTER TABLE ml_model_versions ADD COLUMN IF NOT EXISTS default_tags JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;
