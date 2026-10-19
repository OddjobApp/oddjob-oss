-- The eval measurement spine: per-subject pass rates and the regression gate.
--
-- `shared/schema/evals.ts` declares both tables and `eval-store.service.ts`
-- writes to them from `tests/evals/eval_runner.ts` — which is what
-- `npm run test:evals` and the nightly Agentic Evals workflow execute. No
-- migration ever created either, so every run failed at the point it tried to
-- record its results.
--
-- The consequence is quieter than a 500 and worse: the capability regression
-- gate could never gate anything. A nightly job whose whole purpose is to fail
-- when a subject regresses cannot fail on a regression if it cannot write a
-- baseline to compare against.
--
-- Sixth instance of a schema declaration with no migration behind it, and the
-- second found by `npm run check:schema-drift`.
--
-- No organization_id on either table: evals measure the platform's capabilities,
-- not a tenant's data, matching the declarations.

CREATE TABLE IF NOT EXISTS eval_runs (
  id SERIAL PRIMARY KEY,
  -- Null for ad-hoc local runs; set in CI so a result is attributable to code.
  commit_sha TEXT,
  suite TEXT NOT NULL DEFAULT 'scenarios',
  -- Recorded for reproducibility: an LLM-judged criterion is only comparable
  -- against another run judged by the same model.
  model TEXT,

  total_scenarios INTEGER NOT NULL DEFAULT 0,
  passed_scenarios INTEGER NOT NULL DEFAULT 0,

  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Null while in flight, so an abandoned run is distinguishable from a
  -- completed one rather than silently counting as a pass.
  finished_at TIMESTAMP,

  meta JSONB
);

CREATE TABLE IF NOT EXISTS eval_results (
  id SERIAL PRIMARY KEY,
  -- CASCADE: results have no meaning apart from the run that produced them.
  run_id INTEGER NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,

  -- capability | skill | mission-type
  subject_kind TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  -- `${kind}:${ref}`, denormalised because every history query groups on it.
  subject_key TEXT NOT NULL,

  scenario_id TEXT NOT NULL,

  -- Weighted pass-rate across repeats, in [0,1]. NUMERIC rather than float so a
  -- gate comparison against a threshold is exact — a regression decision must
  -- not turn on binary rounding.
  pass_rate NUMERIC(5,4) NOT NULL,
  threshold NUMERIC(5,4) NOT NULL,
  passed BOOLEAN NOT NULL,
  repeats INTEGER NOT NULL DEFAULT 1,
  -- Variance across repeats: a flaky subject and a genuinely regressed one can
  -- share a pass rate, and only this separates them.
  variance NUMERIC(6,5) NOT NULL DEFAULT 0,

  -- Per-criterion breakdown, for debugging which part of a scenario regressed.
  criteria JSONB,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index names match the drizzle declarations, so a later `drizzle-kit push`
-- sees no drift.
--
-- History lookups are always "this subject over time", which is exactly what
-- the gate does: compare the latest pass rate for a subject against its
-- baseline. The composite ordering serves that directly.
CREATE INDEX IF NOT EXISTS eval_results_subject_idx ON eval_results (subject_key, created_at);
CREATE INDEX IF NOT EXISTS eval_results_run_idx ON eval_results (run_id);
