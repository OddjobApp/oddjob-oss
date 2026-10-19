# 🔐 Auth Pod (`server/domain/auth`)

The Auth Pod is the security foundation of Oddjob. It handles user authentication, session management, multi-tenancy isolation (organizations), and permission-based access control (RBAC).

## Mach 3 Service Role: `api` / `gateway`
In the Mach 3 distributed architecture:
- **API Pod**: Primarily uses the Auth Pod to validate user sessions and enforce organization boundaries on incoming requests.
- **Gateway Pod**: Uses the Auth Pod's token service to authorize external triggers (webhooks, API keys).

## Key Services
- **[AuthEngine](./core/auth-engine.ts)**: Primary logic for login, registration, and session hydration.
- **[UserManager](./core/user-manager.ts)**: Handles user profile management and organization assignments.
- **[PasswordService](./core/password-service.ts)**: Provides salt-based hashing and validation for secure credentials storage.
- **[TokenService](./core/token-service.ts)**: Generates and validates JWTs for internal and external authentication.

## Hooks
- **[SecurityHooks](./hooks/security-hooks.ts)**: Standard hooks for enforcing auth in API routes.
- **[NotifyHooks](./hooks/notify-hooks.ts)**: Lifecycle hooks for sending security alerts (e.g., "New Login Detected").

## Routes
- `POST /api/login`: Authenticate a user and create a session.
- `POST /api/register`: Create a new user account.
- `GET /api/user`: Retrieve the current authenticated user profile.
- `GET /api/orgs`: List organizations the user belongs to.

## Dependencies
- **PostgreSQL**: Stores users, passwords, and organization memberships.
- **Redis (Optional)**: Used for distributed session storage for high-availability `api` pods.
- **Organization Pod**: Provides the context for multi-tenant data isolation.

## 🧪 Testing

The Auth pod uses a decentralized testing structure. Tests are colocated with the security logic to ensure isolation and multi-tenancy validation.

### Test Structure
- **[services/](./tests/services/)**: Focused tests for user management, organization scoping, and authentication logic (e.g., `user-service`, `organization-service`).
- **[integration/](./tests/integration/)**: Multi-tenant isolation audits and deep API security validation.

### Running Tests
To run tests for this pod in isolation:
```bash
npx vitest server/domain/auth
```

## Testing Status
- [x] Core Logic: 🟢 Decentralized tests passing for user and org services
- [x] Session Flows: 🟢 Hardened API audits and session hydration passing
