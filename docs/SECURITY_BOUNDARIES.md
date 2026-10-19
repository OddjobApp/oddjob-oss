# Security Boundaries & Protections

A catalogue of every trust boundary in Oddjob and the mechanism that enforces
it, organized from the outside in: edge → identity → tenant → capability →
data → agent → audit. File references point at the enforcement code, not just
the feature.

## 1. Edge & transport boundary

- **Helmet + explicit security headers** — `auth/core/security.service.ts`
  applies helmet; `middleware/security-headers.ts` adds CSP, HSTS
  (production), `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`,
  XSS protection, Referrer-Policy, and Permissions-Policy.
- **Rate limiting** (`auth/core/security.service.ts`):
  - `authRateLimiter` — 15-min window, 1000 req, skips successful requests
    (brute-force oriented).
  - `apiRateLimiter` — 15-min window, 5000 req in production / 100k in dev.
  - `seleniumRateLimiter` — 5 req/min on browser-automation endpoints.
- **Per-org rate limiting** — `middleware/org-rate-limit.ts` puts a Redis
  counter on expensive launch endpoints (missions, cycles) so one tenant
  cannot saturate the shared BullMQ worker pool.
- **AI call limiting** — `utils/ai-rate-limiter.ts` bounds LLM spend.
- **Request sanitization** — `middleware/sanitize.ts`: HTML entity encoding
  (XSS), SQL-injection pattern detection, path-traversal and null-byte
  rejection.
- **Request validation** — `middleware/validation.ts` wraps every mutation in
  a Zod schema (`validateBody`/`validateQuery`), returning structured 400s.
- **Idempotency** — `middleware/idempotency.ts` honors `Idempotency-Key`
  headers with a 24h Redis response cache scoped per user, preventing
  duplicate writes from retries/double-clicks.
- **CSRF** — `/api/csrf-token` issues per-session tokens; the session cookie
  is `sameSite: 'lax'`, which blocks cross-site POSTs carrying the cookie in
  the common case.
- **CORS** (`auth/core/security.service.ts`) — origin allowlist: localhost
  dev ports, `*.trycloudflare.com` (tunnel regex), plus `ALLOWED_ORIGINS`
  env. Production rejects unlisted origins; development permits them with a
  warning. Origin-less requests (server-to-server, curl) pass.

## 1b. Inbound webhook boundary

- **Generic verifier** — `utils/webhook-verifier.ts`
  (`verifyWebhookSignature`) supports `none` / `header_token` / `hmac`
  modes with `timingSafeEqual` comparison; used by
  `integrations/core/webhook.service.ts` to gate pipeline triggers. The code
  itself flags that signature verification is only reliable when the raw
  request body is preserved.
- **Provider verifiers** — Stripe webhooks via
  `stripe.webhooks.constructEvent` (`billing/stripe.service.ts`); Slack via
  HMAC-SHA256 `v0` signature + timestamp (`integrations/core/slack.adapter.ts`);
  Discord, Teams, and AgentMail adapters have their own verification paths.
- **Upload boundary** — `multer.memoryStorage` capped at 50 MB
  (`knowledge-graph.route.ts` OKF import), a 10 MB document limit on
  ingestion endpoints, a 25 MB cap on agent URL fetches
  (`attachment-tools.ts`), and MIME-type checks — only text-like types are
  parsed as text.

## 2. Identity boundary (authentication)

Enforced by `auth/core/security.service.ts` (`populateUserContext`,
`requireAuth`) with a small explicit `PUBLIC_ROUTES` allowlist (login,
register, csrf-token, forgot/reset password, and `GET /api/user`, which answers
`{ authenticated: false }` itself). Entries match **whole path segments**:
`/api/auth/reset-password` covers `/api/auth/reset-password/<token>`, and
`GET /api/user` is public as an exact path only. Until 3 Oct 2026 this was a bare
`startsWith`, so every GET under `/api/users*`, `/api/user/*` and `/api/user-*`
skipped authentication. `GET /api/users` used that gap to serve every user on the
platform, with emails, to anonymous callers
(`require-auth-public-routes.test.ts`). That route now requires a session and lists
only the caller's organization (super admins keep the platform-wide view). Everything else requires one
of four principals:

| Principal | Mechanism | Resulting privilege |
|---|---|---|
| Session user | Postgres-backed `express-session`, signed cookie `oddjob.sid` | Roles from `adminRoles` + `userOrgs` membership |
| API key | `x-api-key` → `apiKeyService.verifyKey` (SHA-256 hash lookup, non-revoked) | Org-admin **of that key's org only** — never super-admin |
| Internal service | `x-internal-token` === `INTERNAL_API_SECRET` | **Super-admin with caller-chosen `organizationId`** — see caveats |
| External JWT | `token-service` (`validateExternalToken`/`generateExternalToken`) | Gateway-facing integrations |

Session specifics (`middleware/index.ts`):
- Postgres session store with 60s prune interval.
- `SESSION_SECRET` has **no literal fallback** — `env.ts` refuses to boot in
  production without ≥32 chars, and development generates a per-process
  secret (sessions don't survive dev restart, deliberately).
- Cookie: `secure` in production, `sameSite: 'lax'`, 30-day maxAge.

**Server-enforced idle timeout** — `middleware/session-idle-timeout.ts`
stamps `lastSeenAt` per request and *clears* (not destroys) authentication
after 20 min of inactivity. Clearing rather than destroying is deliberate:
`req.session.destroy()` 500s the CSRF endpoint, whereas a cleared session
degrades to anonymous → 401, which the client already handles.

**Credential handling**:
- Passwords: scrypt + per-user salt (`password-service.ts`), strength rules,
  reset tokens via `passwordResetTokens`.
- PINs (`pin-service.ts`): scrypt + `timingSafeEqual`, and a **per-account
  failed-attempt lockout** (5 attempts → 15 min) kept *in-process* on
  purpose — the Redis limiter fails open on outage, which is wrong for a
  credential gate. The attempt map is bounded (10k accounts) against
  userId-spraying memory growth.
- API keys: `rk_<type>_<48 hex>` shown once, stored as SHA-256 hash with a
  display prefix; `lastUsedAt` tracked; revocation supported.
- **Session fixation**: sessions are anonymous until login; privilege is
  materialized per-request by `populateUserContext`, not cached on the
  session object beyond `userId`.
- **No credential material leaves the server**: user payloads
  (`getUserWithRoles`, which feeds `/api/login`, `/api/user` and
  `/api/users/current`, and the org `user.service` reads) strip both `password`
  and `pin`. The PIN hash used to be returned; a 6-digit PIN's hash falls to
  offline brute force. PIN checks read it through their own query.

**User record updates are allow-listed** (`org/core/self-profile.service.ts`).
`PUT /api/admin/users/:id` used to write the request body straight into
`users`, so a user editing themselves could set `password` (without the old
one), a raw `pin`, `username`, `defaultOrgId` or the legal-acceptance flags. Now:
- A non-admin, through either `PATCH /api/users/:id` (self or `me` only) or the
  admin route, may change only name, Slack handle and quiet hours. `email` is
  accepted unchanged only, because login resolves by email.
- An admin may change exactly what the admin user page edits: email, names,
  Slack handle, quiet hours and `alertFilters`.
- Any other field is rejected with a 400 that names it. Credentials and identity
  have their own flows.

## 3. Tenant boundary (organization isolation)

The central security boundary. Resolution lives in
`utils/auth-context.ts` (`getUserOrgContext` → `_computeOrgContext`):

1. `x-internal-token` → super-admin context with caller-supplied org.
2. `apiKeyAuth` → org-admin of the key's org.
3. Session user → validate any *requested* org (`?orgId`,
   `x-organization-id`, session current org, body): must be a safe positive
   integer, and non-super-admins must hold a `userOrgs` membership row for
   it — otherwise `cross_org_access_denied` is logged to the security log
   and a 403 `ForbiddenError` is thrown. **Org context is always derived
   from verified identity + membership, never trusted from the caller.**
4. Falls back to the user's `defaultOrgId`, then their first `userOrgs`
   membership.

Enforcement in queries — `utils/org-conditions.ts` (`getOrgConditions`) is
the **canonical** tenant filter:
- Scoped org → `organization_id = :org` (optionally `OR IS NULL` for shared
  global rows via `allowGlobal`).
- **Null org → `organization_id IS NULL`** — this matters because Drizzle
  treats `.where(undefined)` as *no filter*; a null org must never produce
  an empty condition. `requireOrgId()`/`assertOrgId()` turn the ambiguity
  into a 403 at the boundary instead of a cross-tenant read.
- Super-admin sees everything only when no org context is selected.

Supporting middleware: `requireOrganization`/`resolveOrganization`
(`tenant.ts`), `projectScope` (`project-scope.ts` — param → header →
session → org-default precedence), `requireSuperAdmin` /
`requireOrgAdminOrSuper`, `canManageOrganization`, `validateOrgAccess`,
`requireAgentDeploymentAccess` (per-deployment access check), and
`requireProspectingApp` (per-app installation check).

**Encryption-per-tenant** — `tenant-isolation.service.ts` provisions a
per-tenant KMS key context with a data-residency region check (currently
in-memory; see caveats).

## 4. Secrets & data-at-rest boundary

- **AES-256-GCM** (`utils/encryption.ts`): `iv.tag.ciphertext` hex format,
  32-byte key from `ENCRYPTION_KEY` (or `APP_TOKEN_ENCRYPTION_KEY`), accepts
  hex or base64, fails loudly if the key is missing/malformed.
  `secureCompare` uses `timingSafeEqual`; `generateToken` uses CSPRNG.
- **Encrypted credential store** — `auth/core/encrypted-credentials.service.ts`
  persists integration tokens (Slack, SaaS connectors) encrypted at rest,
  scoped `(organizationId, entityType, entityId, credentialType)`.
- **Boot-time secret hygiene** — `config/env.ts` validates in three tiers:
  - `required`: `DATABASE_URL` (always).
  - `requiredInProduction`: `SESSION_SECRET` ≥32 chars, `ENCRYPTION_KEY`.
  - `degradations`: an explicit list of optional vars whose absence silently
    disables a capability (AI inference, audit-report signing, queues,
    vector search, web push, ComfyUI) — each is **logged by name at boot**
    so a degraded deployment is visible rather than silent.
- `middleware/index.ts` additionally refuses to boot in production if
  `SESSION_SECRET` equals the historical committed default
  (`oddjob-secret-v3`) — that constant was doubly dangerous because
  `auth-context.ts` accepts it as `INTERNAL_API_SECRET`.
- **Audit-report attestation** — procurement exports are signed with
  `AUDIT_REPORT_SIGNING_SECRET`; its absence renders "Unsigned" but is
  listed as a named degradation at boot.
- **Credential vault routes** — `auth/credentials.route.ts` exposes
  org-scoped credential CRUD + `testConnection` behind `requireAuth`;
  listing leaks metadata only (`isSuperAdmin` gates visibility, not just
  writes).

## 5. Egress boundary (SSRF / outbound)

`utils/egress-firewall.ts` is the **only** egress check, and it is canonical.
It covers agent-initiated fetches (`tools/v1/capabilities/web.ts`
`browse_web` and `http_query`, `attachment-tools.ts` `attach_url`) and the
governed HTTP connector that Form Studio `query` fields and Flow Studio
`http_connector` steps call (`integrations/http-connector.service.ts`).

`EgressFirewall.validateUrl` — one URL, no redirect knowledge:
- Rejects every scheme but HTTP and HTTPS.
- Blocks `localhost`, `metadata`, `metadata.google.internal`,
  `instance-data`, and `.local`/`.internal`/`.localhost`/`.home.arpa` names.
- Blocks reserved IPv4 by parsed octet, not string prefix: `0.0.0.0/8`,
  `10/8`, `127/8`, `100.64/10` (CGNAT), `169.254/16` (link-local and the
  cloud metadata IP), `172.16/12`, `192.0.0/24`, `192.168/16`,
  `198.18/15`, and everything from `224/4` up.
- Blocks IPv6 `::/96` (loopback, unspecified, IPv4-compatible),
  `fe80::/10` and `fc00::/7`, matched as ranges. Brackets are stripped
  first: `URL.hostname` keeps them, so a `startsWith("fd00:")` test can
  never fire — a prior rival copy of this check had every IPv6 branch dead
  for exactly that reason, and its tests only covered IPv4 literals.
- Unwraps IPv4-mapped IPv6 and judges it by the IPv4 rules, so
  `[::ffff:127.0.0.1]` is loopback. A mapped public address still passes.
- Optional `AGENT_EGRESS_WHITELIST` domain allowlist (suffix-matched).

`EgressFirewall.validateResolvedHost` resolves a hostname and applies the
same address rules to every record, which is what catches a public name
pointed at private space (`localtest.me` → `127.0.0.1`). A name that does
not resolve is allowed through: `fetch` uses the same resolver and fails on
its own.

`EgressFirewall.fetch` is how callers must fetch a caller-supplied URL. It
uses `redirect: "manual"` and re-runs both checks on **every hop** (max 5).
`redirect: "follow"` validates only the URL the caller passed, so an allowed
public host answering `302 Location: http://169.254.169.254/...` returns
cloud credentials with the guard never seeing that address. Method semantics
match `follow`: 301/302/303 become a bodyless GET, 307/308 keep method and
body.

Known gaps, in the order they are worth closing:
- **DNS rebinding.** Resolution and connection are separate steps, so an
  address that changes between them is not caught. Closing it needs the
  socket pinned to the checked address via a custom undici dispatcher.
- **`browse_web`'s Selenium path.** Only its entry URL is checked; the
  browser follows redirects itself. The fetch fallback is fully guarded.
- **No response size ceiling in the HTTP connector.** Its 10-second abort
  budget is the only bound on body size. `attach_url` caps at 25 MB.

Do not add a second host check. A rival copy in the HTTP connector silently
dropped `AGENT_EGRESS_WHITELIST` for every caller that reached it, which is
the same failure as the rival `getOrgConditions` copies in §3.

## 6. Agent governance boundary (capability & approval gates)

Oddjob's most distinctive boundary — autonomous agents can *propose* but not
*commit* without a human in the loop:

- **Tool tiering** (`crew/core/crew-tools.service.ts`): tools are classed
  into read-only tiers, collaboration tiers, and `PROPOSAL_TOOLS` — a
  governed tier where every call produces a non-destructive draft rendered
  as an inline approval card (agents, missions, deployments, ontology link
  writes, security audits, ingestion runs). Proposal tools inherit the
  requester's permissions; nothing executes until the card is applied.
- **Approval pipeline** — `governor/core/decision-router.ts` persists every
  decision to `approval_requests` (Postgres) and fans out `decision:new` /
  `decision:resolved` events across copilot/inbox/Slack/email/SMS via the
  Molt Protocol (Redis Streams). The ontology's write path
  (`ontology_define_link_type`, `ontology_link_objects`,
  `ontology_unlink_objects`) routes through the same gate.
- **Capability policies** — `governor/core/capability-policy-loader.service.ts`
  hot-reloads a per-org YAML policy: per-role tool allowlists, file-path
  scopes, network destinations, model caps, daily request caps, with
  `strict | warn | log` enforcement modes and violation logging via
  `policy-violation.service`.
- **Governed runtime** — `agents/core/governed-agent-runtime.service.ts`
  binds a lifecycle state machine + scoped topic indexer (per-agent subgraph
  view) + trajectory evaluation into a single `executionPermitted` decision
  per step.
- **Ground-truth grounding** — per AGENTS.md, `crew_turns.tools_used` is the
  record of what an agent actually did; `detectEvasion`/`repairEvasion`
  rewrite or reject turn prose claiming unexecuted work, and durable state
  (`crew_claims`/`crew_decisions`/`crew_commitments`) is written only from
  executed tool results or approval-gated proposals — never from agent
  prose.
- **Budget governance** — `governor/core/budget-governance.service.ts` plus
  `set_project_budget_cap` (itself a proposal-gated tool).
- **Form publishing guards** — `form-publishing-guards` + identity checks
  gate public form exposure.
- **CI/deploy gate** — `audit/zero-touch-audit-gate.service.ts` blocks
  zero-touch merges on CVE counts, invalid AST patches, or unattested SBOMs.
- **Agent federation (A2A)** — `agents/core/a2a-federation.service.ts`
  verifies inbound agent manifests and **zero-knowledge capability proofs**
  before accepting federated requests.
- **Adversarial self-testing** — `agents/core/red-team.service.ts`
  red-teams distilled skills with generated adversarial inputs and logs
  failures as DPO training records; `threat-analysis.service.ts` scores
  agent action outcomes (captcha detection, URL drift, anomalous responses)
  for the Selenium/computer-use agents.

## 7. Knowledge trust boundary

- **HIL verification** ("Knowledge Garden") — extracted graph nodes land in
  `staging` and only become query-visible as `verified` via
  `verifyNode`/`bulkVerifyNodes`; rejection is a first-class state, not a
  delete.
- **Provenance & confidence** — every node/edge carries source system,
  extraction run, confidence score, and verification actor/timestamp;
  `confidence-decay` and `utilityScore` keep stale assertions from silently
  persisting as truth.
- **Compliance reasoning audit trail** — neuro-symbolic `checkCompliance`
  returns the full `ProofStep` trace as its audit trail.

## 8. Privacy boundary

- **Tracking opt-out** — `middleware/privacy.ts` honors the `oj_opt_out`
  cookie and `Sec-GPC: 1` (Global Privacy Control) by short-circuiting with
  204.
- **PII/PAI tokenization** — `privacy/core/core-confidentiality-utility.service.ts`
  does deterministic, reversible tokenization of emails, phones, API keys,
  DB URIs, IPs, and secrets *before* content egresses to cloud LLMs — raw
  values live in ephemeral encrypted memory with per-org/session scoping and
  expiry, and are swapped back on detokenization.

## 9. Audit & forensics

- **Mutation audit** — `middleware/audit-logger.ts` logs every
  non-GET request with parsed entity type/id; `audit/core/audit-service.ts`
  writes categorized `auditLogs` rows (auth, data, admin, api_key,
  credential, config, export, delete, access, system).
- **Security event log** — `utils/security-logger.ts` emits structured
  `[SECURITY]` events (e.g. `cross_org_access_denied`).
- **Forensic event log** — `forensicEventLog` + trace-logger record
  execution-level events (skill runs, agent steps) with org scoping.
- **Agent access audit** — `middleware/agent-access-audit.ts` logs public
  agent access including Cloudflare Tunnel headers (real IP, country, Ray
  ID, Access JWT email).
- **Point-in-time reconstruction** — `governor/core/audit-trace.service.ts`
  replays blackboard deltas to reconstruct mission state at any timestamp;
  `reasoning-audit.service.ts` audits agent reasoning chains.
- **Reversible transactions** — `audit/core/transaction-log.ts` logs
  operations as reversible units behind commit/rollback semantics.
- **Compliance reporting** — `org/core/security-compliance.service.ts`
  produces framework reports (SOC2, GDPR, HIPAA, ISO27001) with findings,
  scores, and audit entries carrying IP/user-agent/severity.

## 10. Deployment boundary

- **Container hardening** — the `Dockerfile` builds on `node:18-alpine` and
  drops to a non-root `appuser` before runtime.
- **Graceful shutdown & health** — `middleware/hardening.ts` tracks shutdown
  state, enforces request timeouts, and reports DB/Redis/Qdrant health;
  `utils/graceful-shutdown.ts` drains connections so deploys don't drop
  in-flight work.
- **Circuit breakers** — `utils/circuit-breaker.ts` and the embed profile
  circuit breaker isolate failing integrations rather than cascading.

## 11. Licensing & lifecycle gates

- `middleware/licensing.ts` blocks all state-changing requests without a
  valid license (reads stay open; super-admin bypass for emergency access;
  licensing routes exempt for activation).

## 12. Transactional integrity

"Transactional security" here means: multi-step work must commit atomically
or not at all, retried work must not double-apply, and failed work must be
recoverable or reversible.

- **DB transactions for multi-write operations** — ~35 services wrap their
  writes in `db.transaction(...)`: `graph-service.createNodesBatch`,
  `link-predictor` approve/review (prediction → real edge promotion is
  atomic), `seed-provisioning`, `governor-resolver`, `dataset/item-service`,
  `knowledge-extraction`, `storage.service`, `mission-context-pruning`, and
  `media-studio` among them. A partially-applied write set is not
  observable.
- **Transactional outbox for events** —
  `core/infrastructure/kafka-outbox.service.ts` is the canonical pattern:
  `enqueueKafkaEvent(writer, …)` inserts into `kafka_outbox_events` *inside
  the caller's transaction* (`onConflictDoNothing` on `eventId` for
  producer-side dedup), so a domain write and its event commit or roll back
  together — no "row written but event lost" and no "event published for a
  rolled-back write."
  - The relay claims rows by guarded status flip (`WHERE status='pending'`
    in the UPDATE), publishes in `bigserial sequence` order, and preserves
    per-partition-key ordering: a failed event blocks its key's successors
    until next flush, while other keys proceed.
  - Retries use exponential backoff (500ms × 2^attempts, capped at 60s),
    `dead_letter` after 12 attempts, and a 60-second `lockedAt` sweep
    recovers rows orphaned mid-publish by a crashed process.
  - Consumer side: `kafka_consumed_events` carries a unique
    `(consumerGroup, eventId)` constraint — at-least-once delivery becomes
    effectively-once processing because replays hit the uniqueness
    constraint instead of re-applying.
- **Queue retry tiers** — `queue/queue.service.ts` assigns per-job-class
  policies: `SAFE` (3 attempts), `STANDARD` (2), `RISKY` (1, for external
  APIs that must not be retried blindly), `CRITICAL` (5), all exponential
  backoff; failed jobs are retained (`removeOnFail: false`) for debugging.
- **HTTP idempotency** — the `Idempotency-Key` middleware (§1) makes POST
  retries return the cached response instead of re-executing; keys are
  user-scoped and expire after 24h.
- **Write-path deduplication** — atomic `INSERT … ON CONFLICT` upserts on
  `(org, externalId)` and `(org, fingerprint)` partial unique indexes for
  nodes, and `(source, target, relation)` for edges, make collector re-runs
  idempotent by construction. `concept-service` documents the same contract
  ("safe for continuously-running collectors that re-assert").
- **Reversible operation log** — `audit/core/transaction-log.ts` gives agent
  executions a compensation layer: each operation (`file_create`,
  `db_insert`, `db_update`, `api_call`) is journaled with `rollbackData`
  before commit; `rollback()` replays compensating actions in reverse and
  `commit()` seals the transaction. `api_call` rollback is explicitly
  best-effort — external effects can't always be undone.
- **Approval-gated commit points** — durable crew state and ontology writes
  exist only as proposals until a human approves (§6), so the "commit
  boundary" for consequential work is a human decision, not just a DB
  commit.
- **Payment finality** — Stripe webhook events are signature-verified
  (`constructEvent`) before any billing state changes, so forged or
  replayed webhooks can't trigger plan transitions.
- **State machines** — agent lifecycle (`agent-lifecycle-state-machine`),
  ingestion `run-lifecycle`, and approval statuses constrain transitions to
  legal paths rather than allowing arbitrary field mutation.

## 13. Test & CI safety boundaries

- **Test database isolation** — `tests/configure-test-environment.ts`
  (`requireTestDatabaseUrl`) refuses to run integration tests unless the URL
  is postgres-protocol and its database name contains a distinct `test`
  segment — added after tests once wrote into the development database.
- **Repo verify gate** — `npm run verify` chains migration-journal,
  idempotency, theme, architecture-lint, and domain-drift checks plus
  tsc/unit/smoke/build. `lint:arch` enforces the controller/service pattern
  (routes can't reach `db` directly), which is what keeps org conditions
  from being bypassed by ad-hoc queries.
- **Smoke split** — `smoke` is hermetic; `smoke:db` needs a test
  `DATABASE_URL` and runs under the schema-drift CI job.

## Caveats & known weak points

- **`x-internal-token` is a master key** — it fabricates a super-admin
  context *with a caller-supplied `organizationId`*. `INTERNAL_API_SECRET`
  falls back to `SESSION_SECRET`, and in dev the session secret is
  per-process — but any deployment where the internal secret leaks (or is
  left as the historical default) yields unrestricted cross-tenant access.
  It needs rotation discipline and ideally mutual-TLS or network-scoping.
- **Password dev tolerance** — `password-service.verifyPassword` accepts
  `password123`/`admin123` interchangeably as a dev/test convenience. Verify
  this path is unreachable in production builds.
- **Redis-backed limiters fail open** — `org-rate-limit` (and the Redis
  limiter in `rate-limiter.ts`) skip enforcement when Redis is down. Correct
  for throughput, wrong for credential gates — which is why PIN lockout is
  in-process.
- **`getOrgConditions` misuse is silent** — passing `table: undefined` or
  misusing `allowGlobal` changes semantics quietly; the arch lint keeps
  routes honest but can't audit every service's usage.
- **`tenant-isolation.service` is in-memory** — the per-tenant KMS key
  contexts and residency checks are a process-local map, not a real KMS
  integration yet.
- **Sanitization is heuristic** — `sanitize.ts` blocks known-bad patterns;
  parameterized Drizzle queries remain the real SQLi boundary.
- **Security event sink is `console.log`** — `security-logger.ts` writes to
  stdout only; no tamper-evident or off-box shipping is wired.
- **Super-admin org fallback** — a super-admin with no org context is
  assigned the *first org in the system*, which can mask scoping bugs in
  views that assume a deliberate selection.
- **No Postgres RLS** — tenant isolation is enforced entirely at the
  application layer (`getOrgConditions` + arch lint). There is no database
  row-level security backstop, so a single service that forgets the
  condition (or builds a raw query) exposes every tenant.
- **No MFA** — there is no TOTP/second-factor implementation anywhere; the
  account surface is password-or-PIN only.
- **No `session.regenerate` on login** — the anonymous session ID appears to
  persist into the authenticated state, leaving a session-fixation exposure
  class open. (No `regenerate` call exists in the auth paths.)
- **Slack signature is fail-open** — `slack.adapter.ts` *warns and skips*
  verification when `SLACK_SIGNING_SECRET` is unset; a misconfigured
  deployment accepts unsigned webhooks.
- **Arbitrary script execution surface** — `python.gateway.executeScript`
  posts raw scripts to the sidecar's `/execute` endpoint; it is reached from
  agent/service/workflow paths with no visible sandboxing contract beyond
  whatever the sidecar container provides.
- **Dev-mode permeability** — CORS permits any origin in development, and
  the `*.trycloudflare.com` regex admits any tunnel subdomain in all
  environments.
- **PIN lockout is per-process** — the in-process counter resets on restart
  and is not shared across replicas; a multi-instance deployment multiplies
  the effective attempt budget.
