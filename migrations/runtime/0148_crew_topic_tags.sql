CREATE TABLE IF NOT EXISTS crew_turn_topics (
 id serial PRIMARY KEY,
 session_id integer NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
 turn_id integer NOT NULL REFERENCES crew_turns(id) ON DELETE CASCADE,
 organization_id integer NOT NULL,
 round integer NOT NULL DEFAULT 0,
 topic_id integer REFERENCES knowledge_topics(id) ON DELETE SET NULL,
 label text NOT NULL,
 raw_label text NOT NULL,
 source text NOT NULL,
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crew_turn_topics_turn_label_unique ON crew_turn_topics(turn_id, label);
CREATE INDEX IF NOT EXISTS idx_ctt_session ON crew_turn_topics(session_id);
CREATE INDEX IF NOT EXISTS idx_ctt_topic ON crew_turn_topics(topic_id);
CREATE INDEX IF NOT EXISTS idx_ctt_org ON crew_turn_topics(organization_id);

ALTER TABLE crew_breakouts ADD COLUMN IF NOT EXISTS topic_id integer REFERENCES knowledge_topics(id) ON DELETE SET NULL;
ALTER TABLE crew_sessions ADD COLUMN IF NOT EXISTS active_topic_id integer REFERENCES knowledge_topics(id) ON DELETE SET NULL;
ALTER TABLE crew_intent_observations ADD COLUMN IF NOT EXISTS declared_topics jsonb NOT NULL DEFAULT '[]'::jsonb;
