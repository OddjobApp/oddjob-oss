# AgentMail Integration

## What it is

AgentMail is a **connector** — it bridges Oddjob's internal agent infrastructure to the open email network via the AgentMail API (`api.agentmail.to/v0`). It is not a skill (no sandboxed code execution) and not a plain tool (it is stateful, bidirectional, and operates over an external persistent channel).

Oddjob's inbox: **oddjobapp@agentmail.to**

---

## Feature Overview

### Purpose

Enables agents and the platform to:
- **Send** mission results, HIL approval requests, and agent-to-agent tasks over email
- **Receive** replies (approve/reject/steer) and act on them autonomously with a full security gate
- **Track** conversation threads across runs

### Key Capabilities

| Capability | Description |
|---|---|
| **Outbound HIL email** | Agents send approval requests with a one-time passcode instead of requiring the approver to log in |
| **Inbound reply processing** | `APPROVE <passcode>` / `REJECT <passcode>` reply directly resolves the `approval_requests` row |
| **Mission steering by email** | `STEER <guidance>` updates `missions.humanSteeringNudge` from any email client |
| **MCP tool access** | Agents can `agentmail_send`, `agentmail_list_threads`, `agentmail_get_thread` via MCP |
| **Thread continuity** | Replies go into the same thread; context is preserved across multi-turn approvals |
| **Gmail fallback** | If `AGENTMAIL_API_KEY` is not set, falls back to the existing Gmail OAuth flow |

---

## Architecture

### Classification: Connector

AgentMail sits in the **connector** tier — alongside Gmail, Jira, Slack, and Resend. It is:
- **Stateful**: threads and messages persist externally on AgentMail's infrastructure
- **Bidirectional**: both outbound (send) and inbound (webhook) data flows
- **External surface**: exposes a real email address (`oddjobapp@agentmail.to`) to the internet
- **Not a skill**: no code is compiled or sandboxed; it's an API integration
- **Not an agent tool alone**: the inbound side runs autonomously without an agent invoking it

The distinction from a *tool*: tools are invoked on-demand by an agent during a run. A connector operates persistently — the inbound webhook fires independently of any running agent.

```
OUTBOUND (agent-driven)
  Agent → DecisionRouter (email channel)
        → agentMailService.sendHilEmail()
        → OTP written to otp_codes table
        → Email delivered from oddjobapp@agentmail.to

INBOUND (event-driven)
  User reply → AgentMail webhook → POST /api/integrations/agentmail/webhook
             → HMAC verified (whsec_...)
             → Intent parsed (APPROVE/REJECT/STEER/LAUNCH)
             → Security gate (sender pin + OTP verify)
             → approval_requests updated → waiting agent resumes
```

---

## Security Model

Inbound actions are protected by **four layers**:

1. **HMAC signature** — every webhook payload is signed with `whsec_UbuOqGleMLtb0buuh865F3oWd3HWje16`; invalid signatures are rejected immediately.
2. **Sender pinning** — the `From:` address must match a registered Oddjob user in the `users` table.
3. **OTP passcode** — for `APPROVE`/`REJECT`, a 6-digit code stored in `otp_codes` (10 min TTL, single-use) must be present in the reply body.
4. **Org role check** — (planned) low-risk intents (`STEER`) require sender to be a known user; high-risk intents (`APPROVE`/`LAUNCH`) require OTP.

### Threat mitigations

| Threat | Mitigation |
|---|---|
| Spoofed `From:` header | Sender address pinned against `users.email` |
| Forwarded approval email | OTP is tied to `executionId + email`; different sender = gate failure |
| Replay attack | `otp_codes.usedAt` set on first use; subsequent attempts rejected |
| Tampered webhook body | HMAC verification rejects any payload where body doesn't match signature |
| Expired passcode | `expiresAt` checked; codes valid for 10 minutes only |

---

## API Endpoints

### `POST /api/integrations/agentmail/webhook`
Receives `message.received` events from AgentMail.

**Headers checked:**
- `svix-id`, `svix-timestamp`, `svix-signature` — for HMAC verification

**Supported intents (parsed from reply body):**

| Keyword | Intent | Security tier |
|---|---|---|
| `APPROVE <6-digit>` | Resolves approval as approved | High (OTP required) |
| `REJECT <6-digit>` | Resolves approval as rejected | High (OTP required) |
| `STEER <text>` | Updates mission steering nudge | Low (known user only) |
| `NUDGE <text>` | Alias for STEER | Low |
| `LAUNCH <objective>` | (planned) Creates a new mission | High |

### `GET /api/integrations/agentmail/status`
Returns `{ configured, inbox, reachable }`. Use for health checks.

---

## MCP Tools

Three tools exposed to agents via the MCP protocol:

### `agentmail_send`
Send an email from `oddjobapp@agentmail.to`.

```json
{
  "to": ["user@example.com"],
  "subject": "Mission complete: Q1 Analysis",
  "text": "The mission has completed. Results attached.",
  "thread_id": "optional-for-replies"
}
```

### `agentmail_list_threads`
List recent inbox threads.

```json
{ "limit": 20 }
```

### `agentmail_get_thread`
Get all messages in a specific thread.

```json
{ "thread_id": "b26bd21c-91f5-4367-915f-0aae7fcf0af0" }
```

---

## Configuration

```env
AGENTMAIL_API_KEY=am_us_...          # Bearer token for API calls
AGENTMAIL_INBOX=oddjobapp@agentmail.to  # Sending inbox address
AGENTMAIL_WEBHOOK_SECRET=whsec_...   # HMAC secret for inbound verification
APP_URL=https://your-domain.com       # Used in reply links + webhook registration
```

### Registered webhook
- **ID**: `ep_3CPGFojVj3x9gG0a6B588gxuZJW`
- **Event types**: `message.received`
- **URL**: must be updated to `${APP_URL}/api/integrations/agentmail/webhook` in production

To update:
```
PATCH https://api.agentmail.to/v0/webhooks/ep_3CPGFojVj3x9gG0a6B588gxuZJW
{ "url": "https://YOUR_DOMAIN/api/integrations/agentmail/webhook" }
```

---

## Files

| File | Purpose |
|---|---|
| `server/domain/integrations/core/agentmail.service.ts` | API wrapper: send, list, HMAC verify, `sendHilEmail()` |
| `server/domain/integrations/core/agentmail-intent.service.ts` | Intent parser + security gate (OTP, sender pin) |
| `server/domain/integrations/routes/agentmail.ts` | Express routes: webhook + status |
| `server/mcp/tools/agentmail.ts` | MCP tool definitions |
| `server/mcp/handlers/agentmail.ts` | MCP tool handlers |
| `server/domain/governor/core/decision-router.ts` | `email` channel now sends via AgentMail (Gmail fallback) |
| `server/routes/hubs/integrations.ts` | Route registration |
| `server/domain/integrations/tests/agentmail.test.ts` | Unit tests |

---

## Integration Points

- **`DecisionRouter`** — `email` channel automatically uses AgentMail when configured
- **`otp_codes` table** — OTP passcodes stored here, same table as HIL form OTPs
- **`approval_requests` table** — inbound APPROVE/REJECT updates the row; waiting agent resumes via existing DB poll loop
- **`missions.humanSteeringNudge`** — updated by STEER intent
- **`forensic_event_log`** — every inbound attempt (pass or fail) is audit-logged
