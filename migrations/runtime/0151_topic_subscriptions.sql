CREATE TABLE IF NOT EXISTS topic_subscriptions (
 id serial PRIMARY KEY,
 topic_id integer NOT NULL REFERENCES knowledge_topics(id) ON DELETE CASCADE,
 organization_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
 user_id text NOT NULL,
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS topic_subscriptions_user_topic_unique ON topic_subscriptions(organization_id, user_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_subscriptions_topic ON topic_subscriptions(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_subscriptions_user ON topic_subscriptions(organization_id, user_id);

