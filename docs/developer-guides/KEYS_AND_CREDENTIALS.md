# AI keys and credentials

How Oddjob holds secrets on a multi-tenant platform: the organization's AI key
(strict BYOK), every other credential's secret, and the rules code must follow
so that one organization's work never runs on another's secret — or on the
platform's.

## 1. AI is strict BYOK

The platform pays for no AI in production. Every organization connects its own
key, and its AI work runs on that key or not at all.

| | Development | Production |
|---|---|---|
| Org has connected a Gemini key | Org's key | Org's key |
| Org has no key | Platform `GEMINI_API_KEY` stands in | Call refused: *"Connect your organization's Gemini API key in Organization Settings"* |
| Shared provider keys in the environment (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`, `OPEN_AI_API_KEY`, `ANTHROPIC_API_KEY`, `MODEL_API_KEY`, `FAL_KEY`) | Used as the fallback above | **Boot refused** (`server/config/env.ts`) |
| `LOCAL_SLM_ENABLED`, `ALLOW_AI_MOCK_FALLBACK` | Allowed | Boot refused |

### Connecting a key

Organization Settings → AI (`PUT /api/org-model`). The key is checked against
Gemini with a non-generating request before it is saved, sent only in the
`x-goog-api-key` header, and never returned — status shows the model and a hint
(`…a1b2`).

- **Who:** org admins; in orgs enforcing strict RBAC, `connector:manage`.
  (Compatibility mode grants every member every permission, so it keeps the
  org-admin check rather than widening to everyone.)
- **Audit:** `AI_KEY_CONNECTED`, `AI_KEY_REPLACED`, `AI_KEY_REMOVED` in
  `audit_logs`, with key hints only.
- **Storage:** `encrypted_credentials`, AES-256-GCM, sealed to
  `organization_ai:<org>:gemini` (`v2.` ciphertext). A row moved to another
  org's slot fails to decrypt. Keys saved before sealing are re-sealed on first
  read.

### Reading a key in code

| You are… | Use |
|---|---|
| Calling the model through `AIClientFactory` / `aiClient` (the org-aware client) | Pass `developmentProviderKey()` as the `apiKey` argument. The client uses the org's key itself; the argument only matters in development. |
| Building your own provider client, or gating a feature on "is AI available" | `await resolveOrgGeminiKey(orgId)` — `null` means show `ORG_GEMINI_KEY_MISSING`, never fall back. |

Both live in `server/domain/ai/core/org-gemini-key.ts`, the only file allowed to
read a provider key from the environment. `npm run lint:shared-ai-keys` (in
`verify`) fails on any other `process.env.*_API_KEY` read; its baseline is 0.

Two failure shapes this replaced, both silent in production:

- `if (!process.env.GEMINI_API_KEY) return …` — a gate on a variable production
  never sets switched the feature off for every customer (semantic search, RAG
  enrichment, reranking, NLQ parsing, critic, cognitive evaluator, …).
- `const KEY = process.env.GEMINI_API_KEY` at module load — captured once, never
  the org's.

### Features that moved to Gemini

Organizations can only connect a Gemini key, so features that ran on other
providers either move to Gemini or refuse in production:

| Feature | Runs on | Notes |
|---|---|---|
| Transcription (Slack voice notes, YouTube fallback) | Gemini, org key | Audio uploaded via the Files API; segment timestamps are approximate |
| Forge app images | Gemini image, org key | `synthesizeImageFile`; DALL-E only in development |
| Structured planning, forge repair and hot-reload patches | Gemini, org key | `orgJsonCompletion` (`server/domain/ai/core/org-json-completion.ts`) |
| `generate_image` tool | Gemini image, org key | Falls back to an org's own stored OpenAI/DALL-E credential |
| Video generation (Media Studio) | fal.ai (Seedance), org key | Organization Settings → Video rendering (`/api/org-model/fal`); `FAL_KEY` refused at boot |

### fal.ai key

Same rules as the Gemini key — org admins (or `connector:manage` under strict
RBAC), audited as `AI_KEY_*` with `provider: "fal"`, stored sealed to
`organization_ai:<org>:fal`, never returned. In code use
`resolveOrgFalKey(orgId)`; Media Studio builds a fal provider per call from it
(`providerFor(engine, orgId)`) instead of caching one on a platform key.

The key's shape is checked when saved, not its validity: there is no
non-billing fal.ai endpoint the save could safely call. A wrong key is refused
on the first render, before anything is billed.

For a one-shot JSON answer from the model, use `orgJsonCompletion`; never call
a provider's REST API with a platform key.

## 2. Credentials hold their own secret

A `credentials` row used to *name* an environment variable (`env_var_name`) and
every caller read `process.env[envVarName]`. On a shared platform that made an
organization's "credential" an operator's variable — the same value for every
tenant that named it — and a way to read the platform's own secrets.

Now an organization's credential stores its secret, encrypted and sealed to
`credential:<org>:<id>` in `encrypted_credentials`.

| Credential | Secret source |
|---|---|
| Organization's, secret stored | The stored secret |
| Organization's, no stored secret | Development: the named variable (legacy). **Production: none.** |
| Platform-level (no organization) | The named variable |

- **Create:** the form asks for the **Secret**; the API takes `secret`.
  An organization's credential must carry one in production. A Google AI
  provider credential is a pointer to the org's Gemini connection and holds none.
- **Rotate:** `PATCH /api/credentials/:id` with `secret`. Leaving it out keeps
  the current one.
- **Read in code:** `await resolveCredentialSecret(credential)`
  (`server/domain/auth/core/credential-secret-store.ts`). Pass the row; it needs
  `id`, `organizationId` and `envVarName`.
- **Load a credential for a job or tool:**
  `credentialsService.getForExecution(id, orgId)` — the caller's org, else
  platform-level, never another tenant's. Do not use `getById(id, org, true)`:
  `true` (super admin) drops the org filter.
- **API responses** never contain secrets. `list` and create/update return the
  row with secret-bearing metadata keys removed and `secretSource`
  (`stored` / `environment` / `missing`).
- **Gmail** OAuth tokens moved from plain-text metadata into the store; existing
  rows are migrated on first load.
- **Cycle integrations** store values through the same store; the old
  `cycle_integration_credential` rows are moved over on first read.

### Platform variables are never a credential

`readCredentialSecret` (`server/utils/credential-secret.ts`) refuses the
platform's own secrets even where an environment variable is still allowed:
session, encryption, database, Redis, JWT, internal, signing, Stripe, Firebase,
the provider AI keys, and the `PG*`, `DATABASE_`, `REDIS_`, `SESSION_`,
`ENCRYPTION_`, `JWT_`, `AWS_`, `INTERNAL_`, `NODE_` prefixes. Credential create
and update reject those names. `{{env.X}}` templates resolve only variables the
caller supplied, never `process.env`.

This list is containment for legacy and platform-level rows — it cannot know
every secret an operator adds. Stored secrets are the fix.

## 3. User code never runs on the host in production

Python and shell jobs run in the Docker sandbox (`--network none`). A job's
`sandbox: false` is honoured only outside production
(`mustSandboxUserCode`), and production refuses to boot with
`SANDBOX_ALLOW_UNSANDBOXED=true`.

Generated apps get the same treatment. The running app process, its
`npm install` (postinstall scripts), its build and the forge's type/compile
checks start with `tenantProcessEnv(...)` (`server/utils/tenant-process-env.ts`):
an allowlist of what an OS and toolchain need — paths, temp, locale, proxies,
toolchain locations — plus the variables the caller passes explicitly. Never
spread `...process.env` into a process that runs tenant code; a secret added to
the environment tomorrow would leak by default.

## 4. Gmail sends from the organization's own mailbox

`gmailService` is a singleton but holds no organization's tokens: each
`loadCredentials(org)` / `sendHilNotification(org, …)` builds a client for that
organization's credential. It used to load tokens onto one shared client, so a
send that awaited between loading and sending could go out from another
organization's mailbox.

## 5. Rotating the master key

`ENCRYPTION_KEY` seals every organization's AI keys and credential secrets.
It is a keyring: the current key encrypts, `ENCRYPTION_KEYS_PREVIOUS`
(comma-separated) only decrypts, and new ciphertext records which key sealed
it (`v3.<key id>.<b|u>.…`; older `v2.` and unprefixed ciphertext is tried
against each key).

1. Generate a key (`openssl rand -hex 32`). Set it as `ENCRYPTION_KEY`, move the
   old one to `ENCRYPTION_KEYS_PREVIOUS`, deploy. Everything stays readable.
2. `npm run encryption:rotate` — a dry run listing what would change and
   anything unreadable. Then `npm run encryption:rotate -- --apply`.
   It re-encrypts `encrypted_credentials` and `scribe_vault_records`, re-sealing
   bound rows to the same owner (`encryptedCredentialOwner`), with a
   compare-and-set per row so a secret saved mid-run is not overwritten.
3. When a run reports 0 to rotate and 0 failed, remove `ENCRYPTION_KEYS_PREVIOUS`.

Production refuses to boot if a previous key is malformed. App deployment
tokens use `APP_TOKEN_ENCRYPTION_KEY` and are re-minted when unreadable, so
they need no rotation.

A new writer that seals rows in `encrypted_credentials` with an owner must add
its entity type to `server/utils/encrypted-credential-owner.ts`, or rotation
cannot re-seal those rows (they are reported as failed, never corrupted).

## 6. Amazon product data is org BYOK

The `amazon_*` tools read catalog data through a `credentials` row of type
`api_key` whose `metadata.provider` selects the backend:

| `metadata.provider` | Secret is | Also set in metadata |
|---|---|---|
| `amazon_creators` | Creators API client secret | `clientId`, `partnerTag`, `version` (`3.1` NA / `3.2` EU / `3.3` FE), `marketplace` |
| `amazon_rainforest` | Rainforest API key | `marketplace` |
| `amazon_serpapi` | SerpApi key | `marketplace` |

`server/domain/integrations/amazon/resolver.ts` resolves them: the calling
organization's rows first, then platform-level rows — but platform rows count
only for the paid providers. A platform-level `amazon_creators` row is ignored
because a platform Associates tag would earn affiliate commission on every
tenant's purchases.

The Creators API requires an approved Amazon Associates account; an account
that has not qualified fails at the token or catalog call, which surfaces as a
tool error rather than an empty success. Nothing in the group reads
`process.env`, and purchases are never autonomous — `amazon_propose_purchase`
files an approval that issues a checkout link the approver completes in their
own Amazon session.

## Known gaps

- **KMS / envelope encryption.** Keys rotate, but the master key still lives
  in the environment. Moving it into a KMS (GCP KMS fits, given Gemini) is an
  infrastructure decision.
- **SDLC tooling inherits the full environment.** `sdlc-tools`,
  `git-workspace`, the Playwright runner and test-loop controller run the
  platform's own repository checks with `{ ...process.env }`. They are not
  tenant code today; if mission workspaces start running tenant repositories
  through them, switch them to `tenantProcessEnv`.
- **Platform-level credentials** (no organization) can still name an
  environment variable outside the reserved list, and any platform `ai_provider`
  credential so named would be platform-funded AI.
