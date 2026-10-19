# 🔐 Auth Service (`services/auth`)

The Auth Service is a standalone microservice dedicated to handling user identity, secure sessions, and authorization logic. It centralizes authentication for the Oddjob platform, allowing other services (Ingestor, Consumer, Mission Engine) to verify user identity via a shared Redis session store.

## Mach 3 Service Role: `auth`
In the Mach 3 distributed architecture, this service acts as the **Identity Provider**. It is responsible for the "Entry Point" of user interaction, ensuring that all subsequent requests across the distributed network are properly scoped and authenticated.

## Core Responsibilities
- **User Authentication**: Secure login and logout flows using Bcrypt hashing.
- **Session Management**: Distributed session tracking via Redis, enabling seamless horizontal scaling of API components.
- **Registration**: Onboarding of new users and organization creation.
- **CSRF Protection**: Generation and validation of anti-forgery tokens for the Multi-Page Application (MPA).
- **Password Lifecycle**: Secure password reset and update flows.

## Architecture
- **Express + Redis**: Uses `express-session` with a `connect-redis` store for high-availability session persistence.
- **Port 5001**: Default port for internal and external authentication requests.
- **Shared Schema**: Interacts with the `users` and `orgs` tables defined in the shared database schema.

## Key Files
- `src/index.ts`: Service entry point and Express configuration.
- `src/routes.ts`: Definition of `/login`, `/register`, and `/logout` endpoints.
- `src/middleware.ts`: Global error and 404 handlers.
- `src/utils.ts`: Helper functions for token generation and validation.

## Routes
- `POST /api/auth/login`: Authenticate credentials and establish a session.
- `POST /api/auth/register`: Create a new user profile.
- `GET /api/auth/session`: Retrieve the current session data (hydration).
- `GET /health`: Service availability check.

## Dependencies
- **Redis**: Persistent session store (`oddjob:sess:`).
- **PostgreSQL**: Primary data store for user and organization metadata.
- **[Shared Auth Package](../../packages/shared-auth)**: Reusable logic for permission checks and token validation.

## Testing Status
- [ ] Integration: 🟢 Authentication flow verified in `tests/integration/auth`
- [ ] Security: 🟡 CSRF and session hijacking protections enabled; awaiting penetration audit
