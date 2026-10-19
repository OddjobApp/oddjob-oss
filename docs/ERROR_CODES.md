# Error Codes Reference

Every API error Oddjob returns carries a machine-readable **`code`** so the
frontend (and integrators) can branch on failures without string-matching
messages. This page documents the canonical codes, their HTTP status, and what
each one means.

- **Source of truth:** [`shared/schema/errors.ts`](../shared/schema/errors.ts) —
  the `ErrorCode` registry and the `ErrorResponse` envelope type.
- **Thrown via:** the `ApplicationError` class hierarchy in
  [`shared/utils/errorHandling.ts`](../shared/utils/errorHandling.ts).

> Keep this doc in sync with `shared/schema/errors.ts`. When you add a code
> there, add a row here.

---

## Standard error response

All API errors serialize to this envelope:

```jsonc
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",            // one of the codes below
    "message": "Route not found: GET /login",
    "details": { /* optional, code-specific */ },
    "statusCode": 404
  },
  "correlationId": "…",             // for tracing a single request
  "timestamp": "2026-07-27T22:51:46.915Z",
  "path": "/login"
}
```

TypeScript shape: `ErrorResponse` in `shared/schema/errors.ts`.

**Client guidance:** branch on `error.code`, not `error.message` (messages are
human-facing and may change). Use `statusCode` for generic handling (ret/redirect
on 401, back-off on 429/503) and `correlationId` when filing a bug.

---

## Canonical codes

### Validation — `400 Bad Request`
| Code | Meaning |
|---|---|
| `VALIDATION_FAILED` | Request failed schema/business validation. `details` usually lists the offending fields. |
| `INVALID_INPUT` | A field value is present but not acceptable. |
| `MISSING_REQUIRED_FIELD` | A required field was omitted. |
| `INVALID_FORMAT` | A field is the wrong type/format (e.g. malformed date, bad enum). |
| `BAD_REQUEST` | Generic malformed request that doesn't fit a more specific code. |

### Authentication — `401 Unauthorized`
| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | No valid session/credentials for a protected resource. |
| `SESSION_EXPIRED` | Session existed but has expired — re-authenticate. |
| `INVALID_CREDENTIALS` | Username/password (or API key) was rejected. |
| `TOKEN_EXPIRED` | A bearer/refresh token has expired. |

### Authorization — `403 Forbidden`
| Code | Meaning |
|---|---|
| `FORBIDDEN` | Authenticated, but not allowed to perform this action. |
| `INSUFFICIENT_PERMISSIONS` | Missing a specific role/permission the action requires. |
| `RESOURCE_ACCESS_DENIED` | Not permitted to access this particular resource (e.g. another org's). |

### Not found — `404 Not Found`
| Code | Meaning |
|---|---|
| `NOT_FOUND` | Generic — the route or resource doesn't exist. |
| `JOB_NOT_FOUND` | The referenced job id doesn't exist (or isn't visible to the caller). |
| `PIPELINE_NOT_FOUND` | The referenced pipeline id doesn't exist. |
| `CREDENTIAL_NOT_FOUND` | The referenced credential doesn't exist. |
| `USER_NOT_FOUND` | The referenced user doesn't exist. |
| `EXECUTION_NOT_FOUND` | The referenced run/execution id doesn't exist. |
| `DOCUMENT_NOT_FOUND` | The referenced knowledge document doesn't exist. |
| `DRAFT_NOT_FOUND` | The referenced cycle builder draft doesn't exist. |
| `SWARM_TASK_NOT_FOUND` | The referenced swarm task for bidding doesn't exist. |

### Conflict — `409 Conflict`
| Code | Meaning |
|---|---|
| `CONFLICT` | Generic conflict with current server state. |
| `DUPLICATE_ENTRY` | A uniqueness constraint would be violated (already exists). |
| `RESOURCE_IN_USE` | Can't modify/delete because the resource is referenced elsewhere. |
| `VERSION_CONFLICT` | Optimistic-concurrency clash — the resource changed since you read it. |

### Unprocessable — `422 Unprocessable Entity`
| Code | Meaning |
|---|---|
| `UNPROCESSABLE_ENTITY` | Well-formed request that can't be processed as-is. |
| `SCHEMA_VALIDATION_FAILED` | Payload failed a stricter schema (e.g. a job/pipeline contract). |

### External service — `502 / 503`
| Code | Meaning |
|---|---|
| `EXTERNAL_SERVICE_ERROR` | An upstream/third-party dependency failed (often via the circuit breaker). |
| `AI_PROVIDER_ERROR` | The model provider (Gemini/Qwen/Ollama/etc.) returned an error. |
| `DATABASE_ERROR` | A database operation failed. |
| `VECTOR_STORE_ERROR` | The vector store (Qdrant) operation failed. |

### Execution / internal — `500 Internal Server Error`
| Code | Meaning |
|---|---|
| `INTERNAL_ERROR` | Unhandled/unexpected server error (the default fallback). |
| `JOB_EXECUTION_FAILED` | A job ran but failed during execution. |
| `PIPELINE_EXECUTION_FAILED` | A pipeline ran but failed during execution. |
| `CONFIGURATION_ERROR` | The server/feature is misconfigured (missing env, bad config). |

### Rate limiting — `429 Too Many Requests`
| Code | Meaning |
|---|---|
| `RATE_LIMITED` | Too many requests — back off and retry after a delay. |
| `QUOTA_EXCEEDED` | A usage quota/budget cap has been hit. |

### Licensing — `402 / 400 / 409`
| Code | Meaning |
|---|---|
| `LICENSE_REQUIRED` | The feature requires an active license/plan. |
| `LICENSE_EXPIRED` | The license/plan has expired. |
| `TRIAL_ALREADY_USED` | A trial was already consumed for this org/account. |

---

## Error class hierarchy

Codes are thrown through `ApplicationError` (in `shared/utils/errorHandling.ts`),
which carries `code`, `severity`, `details`, and `context`. Convenience
subclasses set the code for you:

| Class | Code | Notes |
|---|---|---|
| `ApplicationError` | *(any)* | Base class — pass any `ErrorCode`. |
| `ValidationError` | `VALIDATION_FAILED` | severity `MEDIUM` |
| `NotFoundError` | `NOT_FOUND` | takes `resource` + `identifier` → `details` |
| `UnauthorizedError` | `UNAUTHORIZED` | severity `HIGH` |
| `PipelineExecutionError` | `PIPELINE_EXECUTION_FAILED` | pipeline run failures |

The circuit breaker raises `EXTERNAL_SERVICE_ERROR` when an upstream trips.

---

## Ad-hoc codes (not yet in the registry)

Some routes/services emit `code` strings that are **not** in
`shared/schema/errors.ts`. They work, but they aren't type-checked or centrally
documented — prefer migrating these into the canonical registry.

`AUTH_ERROR`, `AUTH_REQUIRED`, `MISSING_AUTH`, `INVALID_TOKEN`,
`CREDENTIALS_INVALID` (auth) · `DB_ERROR` (database) ·
`CONTRACT_VALIDATION_FAILED`, `MISSING_BODY`, `MISSING_PAYLOAD`,
`MISSING_SOURCE`, `INVALID_TIMESTAMP` (validation) ·
`ORG_CHECK_ERROR`, `TENANT_SCOPE_REQUIRED`, `ORG_MCP_DISABLED`,
`MCP_GLOBALLY_DISABLED` (org / MCP gating) ·
`SIM_ERROR`, `SIM_FAILURE`, `SIM_AUDIT_FAILURE`, `SIM_INVALID_CHANGE`,
`SIM_NO_PROPOSAL` (governance simulator) ·
`DEPRECATED_PLUGIN`, `HIGH_VULN`, `REPO_INACCESSIBLE`, `EMPTY_OUTPUT`,
`NO_COLLAPSE`, `ROUTE_NOT_HANDLED_BY_API_POD`, `GENERIC` (misc).

> Suggested cleanup: fold the auth/validation/org ones into the existing
> categories above (e.g. `AUTH_REQUIRED` → `UNAUTHORIZED`,
> `DB_ERROR` → `DATABASE_ERROR`, `MISSING_BODY` → `MISSING_REQUIRED_FIELD`).

---

## System / passthrough codes (not Oddjob-defined)

You may also see codes originating from Node.js or its HTTP clients. These are
**not** application error codes — they come from the runtime and typically surface
inside an `EXTERNAL_SERVICE_ERROR` / `INTERNAL_ERROR`:

- **Node fs/system:** `ENOENT`, `EACCES`, `EEXIST`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`…
- **Node core:** `ERR_ASSERTION`, `ERR_INVALID_CHAR`, `ERR_HTTP_INVALID_HEADER_VALUE`, `ERR_INVALID_HTTP_TOKEN`…
- **undici (HTTP client):** `UND_ERR_ABORTED`, `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_CLOSED`…

Treat these as infrastructure/transient failures (usually safe to retry).

---

## Adding a new error code

1. Add it to the right category in `shared/schema/errors.ts` (`ErrorCode`).
2. Throw it via `new ApplicationError(ErrorCode.YOUR_CODE, message, severity, details)`
   (or a subclass), so the envelope + `statusCode` are set consistently.
3. Add a row to the matching table above.
4. If the frontend needs to react to it, handle `error.code === 'YOUR_CODE'`.
