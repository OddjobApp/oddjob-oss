# Runtime migrations

This directory is the maintained Drizzle migration chain.

- New database: run `npm run db:migrate`.
- Existing database created before this baseline: run `npm run db:baseline` once, then `npm run db:migrate`.

`db:baseline` verifies current-schema sentinel tables and columns before recording
the baseline. It does not apply schema changes. The SQL files in the parent
`migrations/` directory are retained as legacy/manual migration history and are
not read by the runtime migrator.
