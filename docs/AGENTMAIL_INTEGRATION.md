# AgentMail Integration

The Oddjob AgentMail integration provides a production-grade, bidirectional email communication layer for AI agents. It enables missions to send high-fidelity emails and process inbound replies as steering commands or approval decisions.

## Features

- **Bidirectional Messaging**: Send emails and receive replies directly within the mission context.
- **Human-in-the-Loop (HIL) Governance**: Support for `APPROVE` and `REJECT` intents via email with secure 6-digit OTP passcodes.
- **Mission Steering**: Use the `STEER` keyword in email replies to provide real-time guidance to an active mission.
- **Premium Capabilities**:
  - **Idempotency**: All messages include a `clientId` to prevent duplicate delivery in agentic retry loops.
  - **Thread Sync**: Automatically links email threads to specific mission runs for conversational continuity.
  - **Labels & Tags**: Organize agent communications with custom labels (e.g., `priority:high`, `category:security`).
  - **Attachments**: Full support for sending and receiving attachments, which are automatically parsed and added to the mission blackboard.

## Inbound Email Intents

Oddjob classifies inbound emails into the following intents:

| Intent | Pattern | Required Security | Action |
| :--- | :--- | :--- | :--- |
| **Approve** | `APPROVE <passcode>` | 6-digit OTP | Resumes the pending approval request and the mission wave. |
| **Reject** | `REJECT <passcode>` | 6-digit OTP | Rejects the request and terminates the mission step. |
| **Steer** | `STEER <guidance>` | Sender Identity | Appends guidance to mission blackboard and resumes execution. |
| **Launch** | `LAUNCH <objective>` | Admin Role | Creates and starts a new mission based on the objective. |

## Technical Implementation

### AgentMailService
Located at `server/domain/integrations/core/agentmail.service.ts`.
Provides methods for `send()`, `reply()`, `forward()`, and `sendHilEmail()`.

### Intent Classification
Located at `server/domain/integrations/core/agentmail-intent.service.ts`.
Uses a Python-based classifier (with regex fallback) to extract intents and passcodes from inbound email bodies.

### Webhook Handling
Located at `server/domain/integrations/routes/agentmail.ts`.
Receives `message.received` events from AgentMail. Performs HMAC signature verification using the SVIX protocol.

## Configuration

| Variable | Description |
| :--- | :--- |
| `AGENTMAIL_API_KEY` | Your AgentMail API token. |
| `AGENTMAIL_INBOX` | The default inbox for Oddjob (e.g., `oddjobapp@agentmail.to`). |

## Usage Examples

### Sending a HIL Approval Email
```typescript
await agentMailService.sendHilEmail({
  to: "admin@example.com",
  subject: "Approval Required: Security Triage",
  text: "The agent has identified a potential vulnerability. Shall we proceed with remediation?",
  executionId: "step_exec_123",
  requestId: 456
});
```

### Steering a Mission via Reply
The user replies to an update from the agent:
> STEER Please focus the security scan on the `/api/v2` namespace and ignore the legacy endpoints.

The `AgentMailThreadSync` service identifies the thread, extracts the guidance, and resumes the mission with the new instructions.
