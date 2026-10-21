# Organization AgentMail connections

Each Oddjob organization connects one dedicated AgentMail inbox. Organization administrators manage it in **Settings → AgentMail** (also available in the operations settings panel). Members can see connection status and use their permitted email tools, but cannot replace or disconnect credentials.

## Connect an organization

1. Create a dedicated inbox in AgentMail. For a centrally managed AgentMail account, use a separate pod per customer and an inbox-scoped API key. Do not reuse an inbox between Oddjob organizations.
2. Open Oddjob Settings in the intended organization. Enter the exact AgentMail inbox ID and its API key, then choose **Verify and connect**. Never paste API keys into agent chat.
3. Oddjob verifies inbox access using a read-only API request. Connecting does not send a test email or provision paid resources.
4. Oddjob registers a webhook for that inbox alone (see [Inbound mail](#inbound-mail)). The API key therefore needs permission to manage webhooks.
5. Use the existing AgentMail email tools to read, send, or reply. CREW's existing outbound approval gate still governs sends. Email heartbeat triggers poll the trigger's organization inbox.

Keys and webhook signing secrets are stored in `encrypted_credentials` with organization-bound authenticated encryption, including support for the standard encryption-key rotation command. Connection responses contain no secret or secret hint. Reconnecting replaces the stored key and webhook; disconnecting removes them and deletes the webhook in AgentMail. In-flight requests may finish with the key they already loaded. Disconnecting does not delete the provider inbox or revoke the provider key; revoke it in AgentMail when necessary.

## Deployment

Apply the runtime migrations `0154_org_agentmail.sql` and `0155_org_agentmail_webhooks.sql` through Oddjob's normal runtime migrator before starting this application version. They add connection metadata with one row per organization, a unique inbox ID, the organization's webhook ID and a hash of its webhook token, and a table of delivered event IDs. Existing environment-based inboxes are **not automatically assigned** to any organization. Administrators must explicitly connect each organization.

Production ignores global `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX` and `AGENTMAIL_WEBHOOK_SECRET`. Missing organization context or a missing connection fails closed. There is no organization-1 or platform-credential fallback. Production needs `APP_URL` set to the deployment's public `https://` address, which webhook URLs are built from; connecting is refused without it. The existing `ENCRYPTION_KEY` is required for stored credentials.

## Inbound mail

Each organization has **its own AgentMail webhook**, created when it connects:

- It is registered for the organization's inbox only (`inbox_ids`) and for `message.received` events.
- It delivers to `${APP_URL}/api/integrations/agentmail/webhooks/<token>`. The token is 256 random bits; only its SHA-256 hash is stored.
- AgentMail returns a signing secret for that webhook alone, stored encrypted. Each delivery must carry a valid Svix signature made with it, and a timestamp within 5 minutes, or it is refused (401). A delivery signed with another organization's secret is refused.
- The message's `inbox_id` must be the organization's inbox (403 otherwise). AgentMail retries a delivery with the same `event_id`; each event is handled once.

What a reply does, always inside the organization that owns the inbox:

- **A reply on a thread a CREW room sent** is posted back into that room.
- **`STEER …` on a mission's own email thread** steers that mission. Steering outside a mission thread is not accepted.
- **`APPROVE <code>` / `REJECT <code>`** decides one of the organization's pending approvals, through the same decision path as the Decision Inbox. The sender must be the approval's addressee and a member of the organization, and the one-time passcode must match. A request ID from another organization is not found.

Without a public `https` address (a development server), connecting registers no webhook and inbound mail is read by polling only: AgentMail tools and email heartbeat triggers. Settings shows which mode an organization is in.

The former shared `/api/integrations/agentmail/webhook` endpoint returns 410 in every environment. Remove that webhook from AgentMail when migrating. It never processed a real delivery: it read `event.type`/`event.data`, while AgentMail sends `event_type`/`message`.

## API

- `GET /api/integrations/agentmail/connection`: public connection metadata and management permission.
- `PUT /api/integrations/agentmail/connection`: admin-only `{ "inboxId": "…", "apiKey": "…" }`; verifies and replaces the connection atomically.
- `DELETE /api/integrations/agentmail/connection`: admin-only disconnect.
- `GET /api/integrations/agentmail/threads` and `/threads/:threadId`: authenticated, inbox-scoped reads. The `/api/agentmail` alias serves the existing mission email panel.
- `POST /api/integrations/agentmail/webhooks/:token`: AgentMail's delivery endpoint for one organization. No session; authenticated by that organization's webhook signature.

Organization selection goes through `getUserOrgContext` and membership authorization. A supplied org ID is never treated as authorization by itself.

Provider references: [AgentMail multi-tenancy](https://www.agentmail.to/docs/multi-tenancy), [get inbox](https://docs.agentmail.to/api-reference/inboxes/get), [get inbox thread](https://docs.agentmail.to/api-reference/inboxes/threads/get), [create webhook](https://docs.agentmail.to/api-reference/webhooks/create), [webhook events](https://docs.agentmail.to/events), [webhook verification](https://docs.agentmail.to/webhook-verification).

## Dedicated room inboxes

1. An organization administrator connects its own AgentMail key and default inbox in **Settings → AgentMail**. Use an account/Pod limited to this organization. A key limited to one inbox cannot access additional room inboxes.
2. Create a separate inbox explicitly in the AgentMail console. Oddjob does not automatically create provider resources.
3. Open the saved CREW room and choose **Integrations** in the chat header. Enter that inbox ID and choose **Verify and assign**. The server verifies access using the encrypted organization key.
4. Room email tools use that assigned inbox. An unassigned room fails closed rather than using the default inbox. Non-room tools continue using the organization default. Heartbeat polling can select the same mapping with `sourceConfig.sessionKey`; this does not automatically create a heartbeat trigger or ingest replies into the room.

Only organization administrators can change assignments. Room reads reuse CREW's organization/project access checks. No secret is exposed in the room UI. Each inbox can belong to only one room and cannot also be an organization default. Removing an assignment does not delete the inbox or its mail at AgentMail. Disconnecting organization credentials disables all room mail access until the organization reconnects.

Apply `0156_room_agentmail.sql` after `0155_org_agentmail_webhooks.sql`. The migration journal includes both. Database triggers enforce exclusive mailbox ownership across organization defaults and room mappings, including concurrent writes. The existing organization webhook remains limited to the organization default inbox; room inboxes use explicit reads or heartbeat polling. Automatic room-inbox delivery is not enabled by this change.

## Notification mail versus authored email

AgentMail inboxes/outboxes are for Oddjob and room notifications. Generic `send_email`, legacy `gmail_send`, and `outlook_send_email` now raise an outbound confirmation card rather than sending immediately. The card offers verified Google/Microsoft sender accounts, shows their email address and connection scope, and offers an unchecked **Remember this sender for my outbound email in this organization** option. CC/BCC and plain/HTML content are preserved for review.

The saved choice belongs to the confirming user and organization, not the entire organization or room. It pins the connection ID, provider, and sender address. It preselects a still-valid account on future cards; it never authorizes automatic sending. **Forget saved sender** removes it. Project connections are offered only for drafts in that project. Existing Google/Microsoft OAuth connections are organization/project connections, not personal connections; the UI labels this explicitly.

An account must be connected, have sending permission, and return a verified sender identity. Confirmation rechecks the account before claiming the approval, and execution rechecks it again. Missing permissions, disconnected accounts, or changed identities never fall back to AgentMail. Preference storage happens only after an accepted send and explicit opt-in. A preference storage failure is reported separately and never retries a successful send. No real email is sent during tests.

Google requires Gmail sending permission and userinfo email access. Existing Google Gmail/Workspace consent profiles provide these. Microsoft requires delegated `Mail.Send` and `User.Read`; reconnect through `/api/saas/connectors/microsoft/oauth/initiate?for=email&organizationId=<org>` to explicitly request sending permission while preserving existing document scopes. Default Microsoft document consent is unchanged. Native Gmail thread/draft actions retain their existing provider-specific review flow; the new account picker applies to general outbound email drafts.

`GET /api/approvals/:id/email-accounts` requires approval-view authorization and returns public identities only. `DELETE /api/approvals/email-sender/preference` clears the signed-in user's choice in the selected organization. The approval decision accepts `modifiedOutput.emailAccount: { connectorId, provider, email, remember }`; other send parameters remain bound to the stored draft except reviewed body/subject edits. Apply `0157_outbound_email_preferences.sql` through the journal before enabling this UI.
