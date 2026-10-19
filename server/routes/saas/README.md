
# SaaS Connector Routes

This directory contains the API routes for managing connections to third-party SaaS platforms.

## Jira Integration (OAuth 2.0)

To provide a more secure and user-friendly experience, the Jira integration uses the OAuth 2.0 authorization code flow.

### Connection Flow

1.  **Initiate:** The user clicks "Connect to Jira" in the frontend. This directs them to the `/api/saas/connectors/jira/oauth/initiate` endpoint.
2.  **Redirect to Jira:** The backend constructs the appropriate authorization URL and redirects the user to Jira's authorization screen.
3.  **User Approval:** The user grants Oddjob permission to access their Jira account.
4.  **Callback to Oddjob:** Jira redirects the user back to the `/api/saas/connectors/jira/oauth/callback` endpoint, providing a temporary authorization code.
5.  **Token Exchange & Secure Storage:** The callback endpoint exchanges the authorization code for an `access_token` and a `refresh_token`. These tokens are then securely encrypted using the `encryptedCredentialsService` and stored in the database.
6.  **Connection Complete:** The `saasConnectors` table is updated with the ID of the new encrypted credential, and the user is redirected back to the main integrations page.

This flow ensures that sensitive credentials are never manually handled by the user and are always stored in an encrypted state.
