
# Auth Core Services

This module contains the core services responsible for all aspects of user authentication, authorization, and security on the Oddjob platform.

## Core Responsibilities

### 1. User Authentication
- **`auth.service.ts`**: The main service for handling user login and session management.
- **`password-service.ts`**: Responsible for securely hashing and verifying user passwords.
- **`jwt.service.ts`**: Manages the creation and validation of JSON Web Tokens (JWTs) for authenticating API requests.

### 2. Authorization & Permissions
- **`user-manager.ts`**: Manages user roles and permissions, ensuring that users can only access the resources and perform the actions that their role allows.
- **`api-key.service.ts`**: Manages the lifecycle of API keys, which can be used for programmatic access to the Oddjob API.

### 3. Secure Credential Management
- **`encrypted-credentials.service.ts`**: A critical security service that provides a generic mechanism for encrypting, storing, and retrieving sensitive credentials (like API keys or OAuth tokens for third-party integrations). This service ensures that sensitive data is never stored in plain text.
- **`credentials-service.ts`**: A higher-level service that works with the `encryptedCredentialsService` to manage credentials for specific integrations.

### 4. Third-Party & Embedded Authentication
- **`embed-oauth.service.ts`**: Handles the OAuth 2.0 flow for authenticating users who are using Oddjob through an embedded context (e.g., an iframe).
- **`embed-profile.service.ts`**: Manages the profiles of users who are interacting with embedded Oddjob applications.
