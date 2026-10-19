CREATE TABLE IF NOT EXISTS financial_snapshots (
 id uuid PRIMARY KEY, organization_id integer NOT NULL, project_id integer, session_id integer NOT NULL,
 name text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','saved')),
 source_turn_id integer NOT NULL, source_artifact_index integer NOT NULL, dedupe_key text NOT NULL,
 payload jsonb NOT NULL, source_payload jsonb NOT NULL, created_by text NOT NULL,
 created_at timestamp NOT NULL DEFAULT now(), saved_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_snapshots_dedupe_idx ON financial_snapshots(dedupe_key);
CREATE INDEX IF NOT EXISTS financial_snapshots_scope_idx ON financial_snapshots(organization_id,project_id,status);
CREATE OR REPLACE FUNCTION protect_financial_snapshot() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'saved' AND NEW.saved_at IS NOT NULL
 AND (to_jsonb(NEW) - 'status' - 'saved_at') = (to_jsonb(OLD) - 'status' - 'saved_at') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Financial snapshot content is immutable';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS financial_snapshots_immutable ON financial_snapshots;
CREATE TRIGGER financial_snapshots_immutable BEFORE UPDATE OR DELETE ON financial_snapshots FOR EACH ROW EXECUTE FUNCTION protect_financial_snapshot();
