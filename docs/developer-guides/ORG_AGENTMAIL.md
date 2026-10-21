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

## Project threads

An organization has one inbox, but a thread can belong to one of its projects. `agentmail_threads` records which, when the thread is first linked:

- **Sent from a CREW room:** the room's project.
- **About a mission:** a HIL email or an escalation alert takes the mission's primary project.
- **Sent by a tool:** a send from a project context takes that project.
- **Replies** stay in their thread, so they inherit its project.

A thread with no row or no project belongs to the whole organization, as before. A thread's project never changes once recorded; linking it again can only give an unscoped thread a project.

Every reader checks the project the way project pages do (`projectService.listProjects`): org admins see every thread, members see their private projects' threads, and other users see only org-visible ones. A thread the caller cannot read is left out of listings and answers 404 when asked for directly, the same as a thread that doesn't exist. This covers the `/threads` routes, the `list_agentmail_threads`, `get_agentmail_thread`, `reply_agentmail` and `send_agentmail` (`threadId`) tools, and the MCP handlers. Email heartbeat triggers act for no one, so they see only org-visible mail. `project_id` has no foreign key: a thread whose project is deleted stays hidden rather than becoming visible to everyone.

Migration `0156` backfills threads already linked to rooms and mission runs.

## API

- `GET /api/integrations/agentmail/connection`: public connection metadata and management permission.
- `PUT /api/integrations/agentmail/connection`: admin-only `{ "inboxId": "…", "apiKey": "…" }`; verifies and replaces the connection atomically.
- `DELETE /api/integrations/agentmail/connection`: admin-only disconnect.
- `GET /api/integrations/agentmail/threads` and `/threads/:threadId`: authenticated, inbox-scoped reads. The `/api/agentmail` alias serves the existing mission email panel.
- `POST /api/integrations/agentmail/webhooks/:token`: AgentMail's delivery endpoint for one organization. No session; authenticated by that organization's webhook signature.

Organization selection goes through `getUserOrgContext` and membership authorization. A supplied org ID is never treated as authorization by itself.

Provider references: [AgentMail multi-tenancy](https://www.agentmail.to/docs/multi-tenancy), [get inbox](https://docs.agentmail.to/api-reference/inboxes/get), [get inbox thread](https://docs.agentmail.to/api-reference/inboxes/threads/get), [create webhook](https://docs.agentmail.to/api-reference/webhooks/create), [webhook events](https://docs.agentmail.to/events), [webhook verification](https://docs.agentmail.to/webhook-verification).
