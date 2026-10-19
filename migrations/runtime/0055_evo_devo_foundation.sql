CREATE TABLE IF NOT EXISTS evo_devo_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  environment_key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, document JSONB NOT NULL,
  content_hash TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT evo_devo_environment_key_version_unique UNIQUE (organization_id, environment_key, version)
);

CREATE TABLE IF NOT EXISTS evo_devo_genomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  genome_key TEXT NOT NULL, species_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK (generation >= 0),
  document JSONB NOT NULL, content_hash TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT evo_devo_genome_key_unique UNIQUE (organization_id, genome_key)
);
CREATE INDEX IF NOT EXISTS evo_devo_species_generation_idx ON evo_devo_genomes (organization_id, species_id, generation);

CREATE TABLE IF NOT EXISTS evo_devo_genome_parents (
  child_genome_id UUID NOT NULL REFERENCES evo_devo_genomes(id) ON DELETE CASCADE,
  parent_genome_id UUID NOT NULL REFERENCES evo_devo_genomes(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal IN (0, 1)),
  CONSTRAINT evo_devo_child_parent_ordinal_unique UNIQUE (child_genome_id, ordinal),
  CONSTRAINT evo_devo_lineage_unique UNIQUE (child_genome_id, parent_genome_id),
  CONSTRAINT evo_devo_no_self_parent CHECK (child_genome_id <> parent_genome_id)
);

CREATE TABLE IF NOT EXISTS evo_devo_phenotypes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  genome_id UUID NOT NULL REFERENCES evo_devo_genomes(id) ON DELETE RESTRICT,
  environment_id UUID NOT NULL REFERENCES evo_devo_environments(id) ON DELETE RESTRICT,
  seed INTEGER NOT NULL, compiler_version TEXT NOT NULL, document JSONB NOT NULL,
  content_hash TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT evo_devo_phenotype_replay_unique UNIQUE (genome_id, environment_id, compiler_version, seed)
);
CREATE INDEX IF NOT EXISTS evo_devo_phenotype_content_hash_idx ON evo_devo_phenotypes (content_hash);

CREATE OR REPLACE FUNCTION reject_evo_devo_record_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'evo-devo records are immutable; create a new version or descendant';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evo_devo_environments_immutable ON evo_devo_environments;
CREATE TRIGGER evo_devo_environments_immutable BEFORE UPDATE ON evo_devo_environments
FOR EACH ROW EXECUTE FUNCTION reject_evo_devo_record_update();

DROP TRIGGER IF EXISTS evo_devo_genomes_immutable ON evo_devo_genomes;
CREATE TRIGGER evo_devo_genomes_immutable BEFORE UPDATE ON evo_devo_genomes
FOR EACH ROW EXECUTE FUNCTION reject_evo_devo_record_update();

DROP TRIGGER IF EXISTS evo_devo_phenotypes_immutable ON evo_devo_phenotypes;
CREATE TRIGGER evo_devo_phenotypes_immutable BEFORE UPDATE ON evo_devo_phenotypes
FOR EACH ROW EXECUTE FUNCTION reject_evo_devo_record_update();

CREATE TABLE IF NOT EXISTS evo_devo_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  phenotype_id UUID NOT NULL REFERENCES evo_devo_phenotypes(id) ON DELETE RESTRICT,
  evaluator_key TEXT NOT NULL, evaluator_version TEXT NOT NULL, fitness JSONB NOT NULL,
  eligible BOOLEAN NOT NULL, ineligibility_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB, created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evo_devo_evaluation_phenotype_idx ON evo_devo_evaluations (phenotype_id, evaluator_key, created_at);

CREATE TABLE IF NOT EXISTS evo_devo_populations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  population_key TEXT NOT NULL, species_id TEXT NOT NULL, constraints JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT evo_devo_population_key_unique UNIQUE (organization_id, population_key)
);
CREATE TABLE IF NOT EXISTS evo_devo_population_members (
  population_id UUID NOT NULL REFERENCES evo_devo_populations(id) ON DELETE CASCADE,
  phenotype_id UUID NOT NULL REFERENCES evo_devo_phenotypes(id) ON DELETE RESTRICT,
  cohort INTEGER NOT NULL CHECK (cohort >= 0), admitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT evo_devo_population_member_unique UNIQUE (population_id, phenotype_id)
);
CREATE TABLE IF NOT EXISTS evo_devo_selection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  population_id UUID NOT NULL REFERENCES evo_devo_populations(id) ON DELETE RESTRICT,
  candidates JSONB NOT NULL, selected_genome_ids TEXT[] NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS evo_devo_evaluations_immutable ON evo_devo_evaluations;
CREATE TRIGGER evo_devo_evaluations_immutable BEFORE UPDATE ON evo_devo_evaluations
FOR EACH ROW EXECUTE FUNCTION reject_evo_devo_record_update();
DROP TRIGGER IF EXISTS evo_devo_selection_runs_immutable ON evo_devo_selection_runs;
CREATE TRIGGER evo_devo_selection_runs_immutable BEFORE UPDATE ON evo_devo_selection_runs
FOR EACH ROW EXECUTE FUNCTION reject_evo_devo_record_update();
