# Changelog

Oddjob follows [Semantic Versioning](https://semver.org/). While the version is
0.x, a minor release may change the HTTP API, the cycle YAML format or the SDK
packages; the entry says so when it does. 1.0 will be the point at which those
are held stable.

## 0.1.0 — 2026-10-20

The first public release.

### What is in it

- Teams of AI agents that plan and run work as missions, cycles and pipelines,
  with approval gates, governance policies and an audit trail.
- CREW rooms, where people and agents work together, with studios for apps
  (App Forge), forms, media, documents and research.
- Org Forge, which installs a cycle — its agents, missions, pipelines, forms and
  apps — from a YAML manifest. Every cycle in `server/cycles/` installs.
- Knowledge grounding: retrieval over your documents, a knowledge graph, and
  vector search on Qdrant.
- Bring-your-own-key AI: each organization stores its own provider key,
  encrypted. Production refuses to run AI on a shared platform key.

### Maturity

- App Forge blueprints are labelled stable, beta or experimental, from evidence
  in the repository: see [Blueprint app maturity](docs/guides/blueprint-maturity.md).
  Three are stable today (rescue-dispatch, sdlc-workbench, wayfare).

### Requirements

- Node.js 22.12 or later, and Docker for Postgres and Redis. Qdrant 1.18 for
  vector search. The README quickstart takes a fresh clone to a signed-in admin.

### Known limitations

- `npm ci` downloads an FFmpeg binary from GitHub releases; on a network that
  blocks that, use `npm ci --ignore-scripts` (see the README).
- The Python sidecar in `backend/` is optional and needs its own virtual
  environment; `npm run dev:no-sidecar` runs everything else.
- Deployments that ran Qdrant 1.8 hold data written by that version. Read
  Qdrant's upgrade notes before moving them to 1.18, or re-index into a fresh
  volume.
