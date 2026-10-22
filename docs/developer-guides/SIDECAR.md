# Python sidecar

`backend/` is a FastAPI service beside the Node API. In production it runs as
the internal `sidecar` container; only the API and worker reach it.

## What production runs

`backend/service_main.py` (image `Dockerfile.sidecar`, `requirements-service.txt`):

| Mounted | Path | Notes |
|---|---|---|
| SaaS connectors | `/api/saas/*` | Jira, Slack, Teams, Confluence: connect, test, discover, sync, Jira actions. Scoped to the caller's organization. |
| Predictive analytics | `/api/predictive/*` | In-process state across organizations: Node exposes it to platform super administrators only. |
| Scoring | `/api/scoring/*` | Same. |
| Liveness | `/health` | The only path without the token. |

Development (`backend/main.py`, `npm run backend`) also mounts the sidecar's own
login/registration, orchestration, memory, alerts, documentation, form agents,
notifications, embeddings, scraping and graph routes. None of those run in
production, and none are called by Node in production.

## The service boundary

- **Token.** Every request carries `X-Service-Token`, equal to
  `SIDECAR_SERVICE_TOKEN` (32+ characters; production refuses to start without
  it). The deploy derives it from the runtime seed like the other secrets.
- **Organization.** Tenant routes read the organization only from
  `X-Organization-Id`, which Node sets from the verified caller
  (`caller_org`, `backend/core/service_auth.py`). A query or body
  `organization_id` is ignored; a request without the header gets 400. Nothing
  defaults to organization 1.
- **One client.** Node calls the sidecar only through
  `server/integrations/sidecar-client.ts` (`sidecarFetch`, or `pythonGateway`,
  which uses the same headers). One address: `PYTHON_SERVICE_URL`, default
  `http://localhost:8002`.
- **No shared AI keys.** Production refuses to start with `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY` set.

## Outbound requests

A connector's base URL is typed by a user. Every connector request goes through
`backend/core/egress.py` (Node: `server/utils/egress-firewall.ts`): http(s)
only, every resolved address public, no redirects followed. Inside the
deployment network this is what keeps a connector from reading Postgres, Redis
or Qdrant. `SIDECAR_ALLOW_PRIVATE_EGRESS=true` lifts it for local development
only.

## Credentials

`saas_connectors.credentials` is encrypted at rest as `{"__sealed": "<v3…>"}`,
in the Node API's format (`server/utils/encryption.ts`), which
`backend/core/sealed.py` reads and writes with the same `ENCRYPTION_KEY` ring.
Node seals through the column type (`shared/schema/sealed-json.ts`); a boot
sweep re-seals rows written before. Anything that must be queried (a Slack
team id) belongs in `config`.

## Running it

```bash
npm run backend                          # development app, backend/.venv
cd backend && uvicorn service_main:app --port 8002   # the production app locally
cd backend && python -m pytest -o addopts="" --noconftest tests/test_service_boundary.py tests/test_sealed.py tests/test_egress.py
```
