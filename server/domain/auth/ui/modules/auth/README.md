# 🔐 Auth Module (`client/src/modules/auth`)

The Auth Module manages the entire user lifecycle on the frontend, including secure login, multi-tenant registration, and session hydration. It provides the global authentication context used by the rest of the application to enforce route protection and organization-level scoping.

## Mach 3 UI Role: `auth`
In the Mach 3 distributed architecture, this module is the frontend counterpart to the **Auth Service**. It handles the initial handshake with the identity provider, manages secure cookie-based sessions, and ensures that all subsequent API calls across the distributed network are properly authenticated.

## Core Pages
- **[AuthPage](./pages/AuthPage.tsx)**: Unified login and registration view with dynamic tab switching.
- **[ForgotPassword](./pages/ForgotPassword.tsx)**: Interface for initiating recovery workflows.
- **[ResetPassword](./pages/ResetPassword.tsx)**: Secure form for establishing new credentials via recovery tokens.

## Key Components
- **[Login](./components/Login.tsx)**: Optimized form for credential-based authentication.
- **[Register](./components/Register.tsx)**: Multi-field form for user onboarding and organization setup.
- **Enterprise identity**: SAML/OIDC login and SCIM lifecycle management are not currently implemented in this UI.

## Hooks & State
- **`use-auth`**: The primary hook for accessing current `user`, `org`, and `isAuthenticated` status. It wraps React Query's session fetching logic.
- **Session Persistence**: Leverages HTTP-only cookies managed by the backend, with frontend state synchronized via immediate hydration on app load.

## API Integration
- `POST /api/login` (also available as `/api/auth/login`): Authenticate with username-or-email and password and start a server session.
- `POST /api/auth/register`: Create profile and organization.
- `GET /api/auth/session`: Hydrate frontend state from existing session cookie.

## Testing Status
- [ ] Authentication Flow: 🟢 Critical paths (Login/Register/Logout) verified in integration tests
- [ ] Session Security: 🟡 CSRF token validation active; automated penetration tests pending
