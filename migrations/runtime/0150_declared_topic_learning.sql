ALTER TABLE crew_turn_topics ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'applied';
ALTER TABLE agent_cards ADD COLUMN IF NOT EXISTS topic_label_affinities jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS learned_topic_keywords (
 id serial PRIMARY KEY,
 organization_id integer NOT NULL,
 label text NOT NULL,
 topic varchar(64) NOT NULL,
 weight integer NOT NULL DEFAULT 1,
 created_at timestamp NOT NULL DEFAULT now(),
 updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ltk_org_label_unique ON learned_topic_keywords(organization_id, label);
CREATE INDEX IF NOT EXISTS idx_ltk_org ON learned_topic_keywords(organization_id);
