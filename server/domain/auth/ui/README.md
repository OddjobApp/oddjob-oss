# UI Module: Auth

## Overview

The Auth UI module contains the credential-based login, registration, password-reset, session-hydration, and organization-scoped authorization surfaces.

It is the gateway to the platform, providing the visual interface for the critical security services in the `auth/core` domain.

## Key Features & Components

- **Login Page:** The primary entry point for username-or-email and password authentication. Enterprise SSO is not currently exposed by this surface.
- **Registration Form:** The form for new users to create an account.
- **Password Reset Workflow:** A series of pages that allow a user who has forgotten their password to securely reset it via an email link.
- **User Profile Page:** Account details and password-management surfaces. MFA policy fields exist elsewhere in the platform, but this login flow does not currently perform an MFA challenge.
- **Organization/Team Management:** For users with the appropriate permissions, interfaces to invite new users to their organization and manage user roles and permissions.

## Data Flow

These components interact with the auth API. The browser uses a server-managed session, hydrates identity from `/api/user`, and obtains CSRF protection for state-changing requests. The login UI does not store a bearer token in browser storage.
