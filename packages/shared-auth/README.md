# 🔐 Shared Auth Package (`packages/shared-auth`)

The Shared Auth Package provides the security primitives and session management logic used by every service in the Oddjob platform. It ensures a consistent, secure approach to identity verification, whether a request comes from a human user, an internal microservice, or an external approval form.

## Role in Mach 3
In the distributed architecture, this package is the source of truth for:
- **Identity Verification**: Decodes and validates JWTs to extract `UserContext` and `OrganizationContext`.
- **Service Authorization**: Issues short-lived "Service Tokens" for secure, non-interactive calls between pods (e.g., `mission` -> `forge`).
- **External Handshakes**: Manages specialized tokens for Human-In-The-Loop (HIL) workflows, such as external approval links.

## Core Features
- **JWT Provider**: Standardized generation and verification using `jsonwebtoken`, with support for custom issuers and expiry.
- **Service Tokens**: 5-minute transient tokens for intra-cluster communication, preventing long-term credential leakage.
- **Session Utilities**: Helpers for parsing Express sessions from Redis, used by the `api` and `auth-service` pods.
- **Type-Safe Context**: Defines the `UserContext` and `JWTPayload` interfaces to ensure consistent multi-tenancy enforcement.

## Key Exports
- **[generateToken()](./src/jwt.ts)**: Creates a user authentication token with organization and role claims.
- **[generateServiceToken()](./src/jwt.ts)**: Creates a token for a specific service identity (e.g., `service:mission`).
- **[generateExternalToken()](./src/jwt.ts)**: Creates a token for external HIL form access.
- **[verifyToken()](./src/jwt.ts)**: Validates and decodes any supported JWT type.
- **[isTokenExpired()](./src/jwt.ts)**: Utility to check token validity against current time.

## Security Constants
- **Issuer**: `oddjob`
- **Default Expiry**: `24h` (User), `5m` (Service), `48h` (External/HIL)
- **Secret**: Resolved from `JWT_SECRET` or `SESSION_SECRET` environment variables.

## Usage Example
```typescript
import { verifyToken } from "@oddjob/shared-auth";

const result = verifyToken(incomingToken);
if (result.success) {
    console.log(`Authenticated User: ${result.user.userId} in Org: ${result.user.organizationId}`);
}
```

## Testing Status
- [ ] Logic: 🟢 Unit tests for JWT generation and expiration passing
- [ ] Integration: 🟡 Cross-service token handshakes verified in dev environment
