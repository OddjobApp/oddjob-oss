# Live HTTP Connector

## What it is

The Live HTTP Connector is a single governed exit for every outbound HTTP request the platform makes on a caller's behalf. Form Studio `query` fields, Flow Studio `http_connector` steps and the `http_query` agent tool all hand their URL to the same service, which validates it against the egress firewall, fetches it, caches the response per organization and optionally extracts a JSON path before returning it.

It exists so that "fetch a live API" is one audited code path rather than a `fetch()` call in each studio. A weather dashboard, a currency conversion and an agent's market-data lookup are the same request shape with the same guardrails.

---

## Feature Overview

### Purpose

Enables studios and agents to:
- **Query** a live external REST endpoint without a bespoke integration or a stored credential per studio.
- **Interpolate** form values into query parameters, so a field the user fills drives the request.
- **Extract** one value out of a nested response via a dot-notated `jsonPath`, instead of handing an agent a whole payload.
- **Reuse** a response within a TTL window, so a dashboard with four widgets on one endpoint issues one request.

### Key Capabilities

| Capability | Description |
|---|---|
| **Governed egress** | Every URL, and every redirect hop, is validated by `EgressFirewall`. The connector has no private URL path of its own. |
| **Reactive parameters** | `params` support `{{fieldName}}` templates resolved from live form values; the request is withheld until every placeholder resolves. |
| **JSON path extraction** | `jsonPath` (e.g. `current.temperature_2m`, `rates.EUR`) narrows the response before it reaches the UI or the agent. |
| **Per-org response cache** | Keyed by organization, method, final URL and body, with a caller-supplied TTL up to 24 hours. |
| **Agent parity** | `http_query` is a `read-safe` tool in the CREW research set, so an agent reaches live data through the same service and the same guardrails as a form. |

---

## Architecture

### System Flow

1. **Request origin**
   - A Form Studio `query` field, a Flow Studio `http_connector` step, or the `http_query` agent tool supplies a `url`, optional `params`, `method`, `jsonPath` and `cacheTtlSeconds`.
   - Form and flow callers reach the service over `POST /api/integrations/http-connector/query`; the agent tool calls `httpConnectorService.executeQuery` in process.

2. **Authentication and rate limiting**
   - The route requires an authenticated session (`requireAuth`) and is bounded by `apiRateLimiter`.
   - This is load-bearing rather than boilerplate: `getUserOrgContext` returns an anonymous context with a null organization instead of throwing, and the `/api` `apiKeyAuth` middleware is a no-op when no header is present. Without `requireAuth` the endpoint is an unauthenticated server-side fetcher.

3. **Egress validation**
   - `EgressFirewall.validateUrl` rejects non-HTTP(S) schemes and any host in loopback, private, link-local, CGNAT, benchmarking, multicast or reserved space — in both IPv4 and IPv6 form, including IPv4-mapped IPv6 such as `[::ffff:127.0.0.1]`.
   - `EgressFirewall.validateResolvedHost` then resolves the hostname and rejects it if DNS points at any of that space, which is what a public name like `localtest.me` does.
   - When `AGENT_EGRESS_WHITELIST` is set, only the listed domains pass.

4. **Fetch with per-hop revalidation**
   - `EgressFirewall.fetch` issues the request with `redirect: "manual"` and re-runs both checks on every hop, up to five. `redirect: "follow"` would validate only the caller's URL and then let an allowed public host redirect the request into private space.
   - Method semantics match what `follow` would have done: 301, 302 and 303 become a bodyless GET; 307 and 308 keep the method and body.
   - A 10-second abort budget covers the body read, not just the response headers.

5. **Response handling**
   - JSON responses are parsed; anything else is returned as text.
   - A successful response is cached for `cacheTtlSeconds`, then `jsonPath` extraction runs and the narrowed value is returned.
   - A blocked request returns HTTP 403 with the firewall's reason; a timeout or transport failure returns 504.

---

## Security & Reliability

- **One egress check, not two.** The connector originally carried its own `isPrivateOrLocalHost`, which bypassed `AGENT_EGRESS_WHITELIST` entirely and whose IPv6 branches could never match, because `URL.hostname` keeps the brackets on an IPv6 literal. It now calls `EgressFirewall`, which is canonical and shared with `browse_web` and `attach_url`. See [Security Boundaries §5](../../SECURITY_BOUNDARIES.md).
- **Redirects are a validated boundary**, not a transparent one — the guard runs per hop.
- **Known gap — DNS rebinding.** The resolution check and the connection are separate steps, so a host that answers with a public address and then a private one on re-resolution is not blocked. Closing this requires pinning the socket to the checked address via a custom undici dispatcher.
- **Known gap — no response size ceiling.** `res.json()`/`res.text()` will read a response of any size; the 10-second budget is the only bound. `attach_url`, by contrast, enforces 25 MB.
- **Credential injection is not wired.** The `credentialId` parameter resolves a row from `credentialsService` and looks for `key`, `apiKey` or `token` on it, but a credential's secret is not on the row: it is in the credential secret store (`resolveCredentialSecret`), and `list`/`getById` responses never carry it. No `Authorization` header is ever attached. The parameter is also client-supplied next to a client-supplied URL, so resolving it to a real secret without moving that decision server-side would let a caller post an org secret to a host of their choosing.
- **Cache keys omit `credentialId` and `headers`.** Two requests to one URL that differ only by credential share a cache entry within the TTL.

---

## Files

| File | Purpose |
|---|---|
| `server/utils/egress-firewall.ts` | The canonical egress check: `validateUrl`, `validateResolvedHost`, and `fetch` with per-hop revalidation. |
| `server/domain/integrations/http-connector.service.ts` | Query execution, response cache, and `jsonPath` extraction. |
| `server/domain/integrations/routes/http-connector.ts` | `POST /api/integrations/http-connector/query`, behind `requireAuth` and `apiRateLimiter`. |
| `server/routes/hubs/integrations.ts` | Mounts the router at `/api/integrations/http-connector`. |
| `server/domain/tools/v1/capabilities/web.ts` | The `http_query` agent tool and `browse_web`, both on the shared firewall. |
| `server/domain/core/ui/components/shared/FormRenderer.tsx` | Renders `query` fields, resolves `{{field}}` templates, and calls the route. |
| `client/src/modules/forms/StudioRenderer.tsx` | Form Studio's `query` field type and its presets. |
| `client/src/modules/flows/FlowStudioPod.tsx` | The `http_connector` flow step and its port contracts. |
| `server/domain/integrations/tests/http-connector.service.test.ts` | SSRF, redirect, whitelist and caching coverage for the service. |
| `tests/unit/security-hardening.test.ts` | `EgressFirewall.validateUrl` and redirect-hop coverage. |
| `server/utils/egress-firewall-dns.test.ts` | DNS-resolution guard coverage, with an injected resolver. |

---

## Documentation References

- [Security Boundaries §5 — Egress boundary](../../SECURITY_BOUNDARIES.md) — where this fits among the platform's boundaries.
- Capability pages: [`http_query`](../../capabilities/http_query.md), [`browse_web`](../../capabilities/browse_web.md), [`attach_url`](../../capabilities/attach_url.md) — generated from the tool definitions, including their declared guardrails.
