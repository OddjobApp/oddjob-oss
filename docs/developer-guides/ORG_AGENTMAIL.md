# Organization AgentMail connections

Each Oddjob organization connects one dedicated AgentMail inbox. Organization administrators manage it in **Settings → AgentMail** (also available in the operations settings panel). Members can see connection status and use their permitted email tools, but cannot replace or disconnect credentials.

## Connect an organization

1. Create a dedicated inbox in AgentMail. For a centrally managed AgentMail account, use a separate pod per customer and an inbox-scoped API key. Do not reuse an inbox between Oddjob organizations.
2. Open Oddjob Settings in the intended organization. Enter the exact AgentMail inbox ID and its API key, then choose **Verify and connect**. Never paste API keys into agent chat.
3. Oddjob verifies inbox access using a read-only API request. Connecting does not send a test email or provision paid resources.
4. Use the existing AgentMail email tools to read, send, or reply. CREW's existing outbound approval gate still governs sends. Email heartbeat triggers poll the trigger's organization inbox.

Keys are stored in `encrypted_credentials` with organization-bound authenticated encryption, including support for the standard encryption-key rotation command. Connection responses contain no secret or secret hint. Reconnecting replaces the stored key; disconnecting removes it. In-flight requests may finish with the key they already loaded. Disconnecting does not delete the provider inbox or revoke the provider key; revoke it in AgentMail when necessary.

## Deployment

Apply the registered runtime migration `0154_org_agentmail.sql` through Oddjob's normal runtime migrator before starting this application version. It adds connection metadata with one row per organization and a unique inbox ID. API keys remain in the existing encrypted credential store. Existing environment-based inboxes are **not automatically assigned** to any organization. Administrators must explicitly connect each organization.

Production ignores global `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX` credentials. Missing organization context or a missing connection fails closed. There is no organization-1 or platform-credential fallback. No new environment variables are needed; the existing `ENCRYPTION_KEY` is required for stored credentials.

## Inbound mail

This version uses organization-scoped **polling**, through AgentMail tools and email heartbeat triggers. Configure an email heartbeat trigger if incoming mail should launch scheduled work; connecting an inbox alone does not create an automation. The former shared `/api/integrations/agentmail/webhook` endpoint returns 410 in production. Remove that webhook from AgentMail when migrating. Incoming email cannot approve decisions or steer missions through that old endpoint. Use Oddjob's in-app approvals.

Signed per-organization push webhooks and automatic inbox provisioning are not implemented by this connection service. They require separate event deduplication and tenant-bound routing before enablement.

## API

- `GET /api/integrations/agentmail/connection`: public connection metadata and management permission.
- `PUT /api/integrations/agentmail/connection`: admin-only `{ "inboxId": "…", "apiKey": "…" }`; verifies and replaces the connection atomically.
- `DELETE /api/integrations/agentmail/connection`: admin-only disconnect.
- `GET /api/integrations/agentmail/threads` and `/threads/:threadId`: authenticated, inbox-scoped reads. The `/api/agentmail` alias serves the existing mission email panel.

Organization selection goes through `getUserOrgContext` and membership authorization. A supplied org ID is never treated as authorization by itself.

Provider references: [AgentMail multi-tenancy](https://www.agentmail.to/docs/multi-tenancy), [get inbox](https://docs.agentmail.to/api-reference/inboxes/get), [get inbox thread](https://docs.agentmail.to/api-reference/inboxes/threads/get).
