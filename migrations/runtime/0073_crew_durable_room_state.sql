ALTER TABLE crew_sessions
    ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'explore',
    ADD COLUMN IF NOT EXISTS memory jsonb NOT NULL DEFAULT '{"facts":[],"hypotheses":[],"openQuestions":[],"constraints":[],"ontologyRefs":[],"updatedRound":0}'::jsonb;

CREATE TABLE IF NOT EXISTS crew_decisions (
    id serial PRIMARY KEY, session_id integer NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
    organization_id integer NOT NULL, statement text NOT NULL, rationale text,
    alternatives jsonb NOT NULL DEFAULT '[]'::jsonb, evidence_turn_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    ontology_refs jsonb NOT NULL DEFAULT '[]'::jsonb, confidence integer, status text NOT NULL DEFAULT 'proposed',
    supersedes_decision_id integer REFERENCES crew_decisions(id) ON DELETE SET NULL,
    created_by text, round integer NOT NULL DEFAULT 0, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_decisions_session ON crew_decisions(session_id, id);

CREATE TABLE IF NOT EXISTS crew_claims (
    id serial PRIMARY KEY, session_id integer NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
    organization_id integer NOT NULL, claim text NOT NULL, status text NOT NULL DEFAULT 'unverified', confidence integer,
    source_turn_id integer REFERENCES crew_turns(id) ON DELETE SET NULL, evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_claims_session ON crew_claims(session_id, id);

CREATE TABLE IF NOT EXISTS crew_commitments (
    id serial PRIMARY KEY, session_id integer NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
    organization_id integer NOT NULL, title text NOT NULL, detail text, owner_type text NOT NULL DEFAULT 'user', owner_id text,
    due_at timestamp, status text NOT NULL DEFAULT 'open', ontology_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    completion_evidence jsonb NOT NULL DEFAULT '[]'::jsonb, created_by text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_commitments_session ON crew_commitments(session_id, id);
