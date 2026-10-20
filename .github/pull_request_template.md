## What changed

<!-- What this does, and why. Link the issue it closes, if any. -->

## How you checked it

<!-- The tests you ran or added, and anything you tried by hand. -->

- [ ] `npm run verify` passes (run `npm run playwright:install` once first)
- [ ] Integration tests pass, if this touches the database, Redis or Qdrant (`npm run test:integration`; see the README)
- [ ] New migrations have a journal entry (`npm run check:migration-journal`)
- [ ] Queries are org-scoped with `getOrgConditions` — see AGENTS.md
- [ ] No API keys, credentials or personal data in the diff
