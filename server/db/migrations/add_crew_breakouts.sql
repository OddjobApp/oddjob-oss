-- Migration: Add CREW Breakout Room support
-- Apply with: npm run db:push (drizzle-kit push handles this automatically from the schema)
-- This file is for reference / manual rollback only.

-- 1. Add parent_session_id to crew_sessions
ALTER TABLE crew_sessions
    ADD COLUMN IF NOT EXISTS parent_session_id INTEGER
        REFERENCES crew_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crew_sessions_parent ON crew_sessions(parent_session_id);

-- 2. Create crew_breakouts join table
CREATE TABLE IF NOT EXISTS crew_breakouts (
    id                SERIAL PRIMARY KEY,
    parent_session_id INTEGER NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
    child_session_id  INTEGER NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
    sub_topic         TEXT    NOT NULL,
    suggested_by      TEXT    NOT NULL DEFAULT 'Supervisor',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_breakouts_parent ON crew_breakouts(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_crew_breakouts_child  ON crew_breakouts(child_session_id);
