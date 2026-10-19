-- The component index the SDLC assembly engine and the style gallery both read.
--
-- `shared/schema/learning/component-index.ts` has declared this table for a long
-- time, but no migration ever created it — so it exists in NO environment.
-- `GET /api/capabilities/component-index/search` therefore threw on every
-- request, and `/platform-maintenance/components` rendered an empty gallery.
--
-- Worth being precise about the symptom, because it reads as a permissions
-- problem and is not one: that route is gated by `requireAuth` alone, with no
-- role check anywhere. Admins and super admins saw nothing for exactly the same
-- reason every other user did — the query failed before any authorisation
-- question arose.
--
-- Same class of drift as 0049 (`apps.project_id`): a schema declaration with no
-- corresponding migration, invisible to tsc and to any test that mocks the
-- database.

CREATE TABLE IF NOT EXISTS component_index (
  id SERIAL PRIMARY KEY,
  -- Nullable: null means a system-wide global component, not an orphan.
  organization_id INTEGER REFERENCES orgs(org_id),

  component_name TEXT NOT NULL UNIQUE,
  component_category TEXT NOT NULL,
  export_type TEXT NOT NULL DEFAULT 'named',
  package_source TEXT NOT NULL,
  import_path TEXT NOT NULL,

  prop_schema JSONB DEFAULT '{}'::jsonb,
  dependencies JSONB DEFAULT '[]'::jsonb,
  code_snippet TEXT NOT NULL,
  blueprint_template TEXT,

  effectiveness_score NUMERIC(3,2) DEFAULT 5.00,
  verification_success_rate NUMERIC(5,2) DEFAULT 100.00,
  total_assemble_count INTEGER DEFAULT 0,
  is_approved_for_assembly BOOLEAN DEFAULT true,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index names match the drizzle declarations exactly, so a later
-- `drizzle-kit push` sees no drift and does not try to recreate them.
CREATE INDEX IF NOT EXISTS comp_idx_name_idx ON component_index (component_name);
CREATE INDEX IF NOT EXISTS comp_idx_category_idx ON component_index (component_category);
CREATE INDEX IF NOT EXISTS comp_idx_org_idx ON component_index (organization_id);
CREATE INDEX IF NOT EXISTS comp_idx_effectiveness_idx ON component_index (effectiveness_score);
