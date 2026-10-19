# OpenAPI Auth Introspection

## Overview

The `OpenApiExecutor` now reads the `securitySchemes` block from the OpenAPI spec at execution time and applies the correct HTTP authentication mechanism automatically. Previously all requests defaulted to `Authorization: Bearer <secret>` regardless of what the spec declared.

---

## Resolution Order

1. **Resolve operation-level `security`** — inspect `operationDef.security` (the requirement list for this specific operation).
2. **Walk global `security`** — if the operation has no security override, fall back to the root-level `security` array.
3. **Match each requirement name to `components.securitySchemes`** (OAS 3.x) or `securityDefinitions` (Swagger 2.x).
4. **Apply the first matched scheme** according to its `type` field.
5. **Fallback** — if no matching scheme is found, use credential type heuristic (`password` → Basic, otherwise Bearer).

---

## Supported Auth Schemes

| Spec declaration | Applied as |
|---|---|
| `type: http, scheme: bearer` | `Authorization: Bearer <secret>` |
| `type: http, scheme: basic` | `Authorization: Basic <base64(secret)>` |
| `type: apiKey, in: header, name: X-Api-Key` | `X-Api-Key: <secret>` |
| `type: apiKey, in: query, name: api_key` | `?api_key=<secret>` appended to URL |
| `type: apiKey, in: cookie, name: session` | `Cookie: session=<secret>` |
| `type: oauth2` | `Authorization: Bearer <secret>` (token assumed pre-obtained) |
| `type: openIdConnect` | `Authorization: Bearer <secret>` |
| No scheme found, credential type = `password` | `Authorization: Basic <base64(secret)>` |
| No scheme found, other credential type | `Authorization: Bearer <secret>` |

---

## Secret Format

The secret is the credential's own, stored encrypted for the organization and read with `resolveCredentialSecret(credential)`. An environment variable named by the credential is used only for platform-level credentials, or outside production for rows created before secrets were stored. See [AI keys and credentials](../../developer-guides/KEYS_AND_CREDENTIALS.md).

For **Basic auth**, the secret must be in `username:password` format. The executor Base64-encodes it automatically — do not pre-encode it in the credential.

---

## Example Spec Fragments

### API Key in header
```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
security:
  - ApiKeyAuth: []
```

### HTTP Basic
```yaml
components:
  securitySchemes:
    BasicAuth:
      type: http
      scheme: basic
```

### OAuth2 Bearer
```yaml
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.example.com/token
          scopes: {}
```

---

## Files

| File | Change |
|---|---|
| `server/domain/jobs/core/executors/openapi-executor.ts` | Added `applyOpenApiAuth()` helper; replaced hardcoded Bearer |
| `server/domain/jobs/tests/executors/openapi-auth.test.ts` | Unit tests for all scheme types + fallbacks |
