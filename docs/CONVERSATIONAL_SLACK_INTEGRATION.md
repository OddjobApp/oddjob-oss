# Conversational Slack Integration

**Date:** April 27, 2026  
**Status:** ✅ Active and Operational  
**Related:** AgentMail Integration, Webhook Triggers, Unified Memory

---

## Overview

The Conversational Slack Integration enables users to interact with Oddjob directly from Slack through:

- **Natural language commands** to launch missions
- **Thread-based conversations** that maintain mission context
- **Interactive buttons** for approving/rejecting mission actions or **Steer Mission** for real-time guidance
- **Steering Modals** to capture detailed human guidance during active mission cycles
- **Granular Notifications** mapped to specific channels via subscription policies

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         SLACK WORKSPACE                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  App Mention │  │    DM to     │  │  Interactive Buttons │ │
│  │   @Oddjob    │  │    Bot       │  │   (Approve/Reject)   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
└─────────┼─────────────────┼─────────────────────┼───────────────┘
          │                 │                     │
          └─────────────────┼─────────────────────┘
                            │
          ┌─────────────────▼───────────────────────┐
          │   POST /api/webhooks/messaging/       │
          │   • /slack/events (Messages)          │
          │   • /slack/interactivity (Buttons)     │
          └─────────────────┬─────────────────────┘
                            │
          ┌─────────────────▼───────────────────────┐
          │      Messaging Webhooks Router            │
          │  • Signature Verification (HMAC)          │
          │  • Replay Attack Protection               │
          └─────────────────┬─────────────────────┘
                            │
          ┌─────────────────▼───────────────────────┐
          │   Conversational Bridge Service         │
          │  • Intent Analysis (AI-powered)           │
          │  • Thread-based Mission Routing           │
          │  • User Resolution (Email/Identity Map)   │
          │  • Unified Memory Context Retrieval       │
          └─────────────────┬─────────────────────┘
                            │
          ┌─────────────────┼─────────────────────┐
          │                 │                     │
    ┌─────▼──────┐  ┌──────▼──────┐  ┌──────────▼────────┐
    │  Mission   │  │  Knowledge  │  │   Slack Service   │
    │  Service   │  │   Service   │  │  (Response Post)  │
    └────────────┘  └─────────────┘  └───────────────────┘
```

---

## Setup Process

### Step 1: Create Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it "Oddjob" and select your workspace
4. Note your **Signing Secret** (Settings → Basic Information → App Credentials)

### Step 2: Configure Bot Token Scopes

Navigate to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**:

Required scopes:
```
app_mentions:read      # Detect @Oddjob mentions
channels:read          # List public channels
chat:write             # Send messages
files:read             # Download attachments
im:read                # Read DM channels
im:write               # Send DMs
users:read             # Lookup user info
users:read.email       # Match Slack → Oddjob users
```

### Step 3: Enable Event Subscriptions

Navigate to **Event Subscriptions** → Enable:

**Request URL:**
```
https://<YOUR_APP_URL>/api/webhooks/messaging/slack/events
```

**Subscribe to bot events:**
- `app_mention` - When someone mentions @Oddjob
- `message.im` - Direct messages to the bot

### Step 4: Enable Interactivity (Buttons)

Navigate to **Interactivity & Shortcuts** → Enable:

**Request URL:**
```
https://<YOUR_APP_URL>/api/webhooks/messaging/slack/interactivity
```

### Step 5: Install App to Workspace

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 6: Configure Oddjob Connector

In the Oddjob Dashboard:

1. Navigate to **Integrations** → **SaaS Connectors**
2. Click **Add Connector** → Select **Slack**
3. Fill in the configuration:
   - **Config Name:** "Production Slack" (or your label)
   - **Bot Token:** Paste your `xoxb-...` token
   - **Webhook URL:** (Optional) For advanced use cases
4. Click **Test Connection** to verify
5. Click **Save**

### Step 7: Environment Variables

Ensure your Oddjob server has:

```bash
# Required for webhook signature verification
SLACK_SIGNING_SECRET=your_signing_secret_here

# Optional: For enhanced logging/debugging
SLACK_DEBUG=true
```

---

## Features

### 1. Mission Launch via Chat

Users can launch missions by mentioning the bot or sending a DM:

```
@Oddjob Build me a Slack bot that monitors #alerts and posts summaries to #general
```

**AI Intent Analysis** automatically determines:
- **Intent:** `LAUNCH_MISSION`
- **Orchestrator:** `rolling_wave` (default), `dynamic`, or `reactive`
- **Objective:** Summarized from user input
- **Response:** Friendly acknowledgment

**Example Response:**
```
🚀 Mission Launched!

Objective: Build Slack bot that monitors #alerts and posts summaries
Orchestrator: rolling_wave
Mission ID: 42 (Run: 156)

I'll notify you here once I reach a milestone or require orders.
```

### 2. Thread-Based Context

Conversations maintain context through Slack threads:

```
User: @Oddjob Research competitors for our product
Bot:  🚀 Mission Launched! (Run: 156)
      ...
      
[User replies in thread]
User: Actually, focus on pricing strategies
Bot:  ✅ Command Received: Resuming mission with your new instructions...
```

The thread's `thread_ts` is stored in `missionContext.threadTs`, enabling:
- **Command routing** to existing missions
- **Status updates** posted back to the same thread
- **Conversation history** preserved

3. Triggers mission continuation or cancellation

### 4. Mission Steering (Interactive Nudging)

Molt and the Mission Messaging Bridge include a **Steer Mission** button in proactive updates:

```
🚀 Mission Update: #42 Phase Transition
...
[Approve] [Reject] [Steer Mission]
```

Clicking **Steer Mission**:
1. Opens a **Slack Modal** with a text area for human guidance.
2. User enters guidance (e.g., "Pivot to the research phase immediately").
3. Decision is captured in `missionRuns.lastUserCommand`.
4. Mission phase is set to `PLANNING` and an immediate wave is scheduled.

### 5. Granular Channel Subscriptions

Oddjob supports restricting notifications to specific channels based on event type and entity ID:

- **notifyMissions**: Post mission starts, completions, and milestones.
- **notifyJobs**: Post job failures or high-risk tool usage.
- **notifyApprovals**: Post HIL approval requests.
- **Entity Specific**: Subscribe to only a specific mission ID or job ID.

Settings are managed in the `slackChannelSubscriptions` table and enforced by `SlackService.sendNotification`.

### 6. Voice-to-Mission

Users can send voice memos:

1. User records audio message in Slack
2. Oddjob downloads the audio file
3. Audio is transcribed using `transcriptionService`
4. Transcription is analyzed for intent
5. Mission launches with transcribed objective

**Supported formats:** `.m4a`, `.mp3`, `.wav`

### 5. File Attachments

Files sent with messages become mission deliverables:

1. File downloaded from Slack
2. Stored in Evidence Storage (`missions/{id}/attachments/`)
3. Deliverable record created
4. Audio files transcribed and added to mission context

### 6. Knowledge Queries

Users can query organizational knowledge:

```
@Oddjob What API credentials do we have for Stripe?
```

The system:
1. Detects `QUERY_KNOWLEDGE` intent
2. Searches Knowledge Graph
3. Returns relevant nodes with descriptions

---

## Security

### Webhook Signature Verification

All Slack webhooks are verified using HMAC-SHA256:

```typescript
const sigBaseString = `v0:${timestamp}:${rawBody}`;
const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBaseString)
    .digest('hex');
    
return crypto.timingSafeEqual(mySignature, signature);
```

**Replay protection:** Requests older than 5 minutes are rejected.

### Identity Challenge

Unknown users cannot launch missions:

```
🛡️ Identity Required

I see you want to launch a mission, but I don't have a verified 
Oddjob account linked to your Slack profile (U123456).

Please visit the Oddjob Dashboard to pair your account.
```

User resolution methods (in order):
1. **Explicit identity mapping** (`userPlatformIdentities` table)
2. **Email matching** (Slack profile email → Oddjob user email)

### Bot Message Prevention

Bot messages are ignored to prevent infinite loops:

```typescript
if (event.bot_id || event.subtype === 'bot_message') return;
```

---

## API Endpoints

### Webhook Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/webhooks/messaging/slack/events` | POST | Receives app mentions and DMs |
| `/api/webhooks/messaging/slack/interactivity` | POST | Receives button clicks |

### Connector Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/saas/connectors` | GET | List configured connectors |
| `/api/saas/create-connector` | POST | Create/update Slack connector |
| `/api/saas/connectors/slack/test` | POST | Test Slack connection |
| `/api/saas/connectors/slack/discover/channels` | POST | List available channels |

---

## Configuration Schema

### SaaS Connector (Slack)

```typescript
interface SlackConnectorConfig {
  platform: 'slack';
  config_name: string;
  config: {
    enabled: boolean;
    allowed_channels?: string[];
  };
  credentials: {
    bot_token: string;      // xoxb-...
    webhook_url?: string;   // Optional custom webhook
  };
  status: 'connected' | 'error' | 'inactive';
}
```

### Environment Variables

```bash
# Required
SLACK_SIGNING_SECRET=      # From Slack App settings

# Optional
SLACK_DEBUG=true            # Enable verbose logging
SLACK_TIMEOUT=30000         # Request timeout (ms)
```

---

## Troubleshooting

### "Invalid signature" errors

**Cause:** `SLACK_SIGNING_SECRET` is missing or incorrect

**Solution:**
1. Verify `SLACK_SIGNING_SECRET` is set in environment
2. Ensure secret is from correct Slack app
3. Restart server after changing env vars

### "No active slack connector found"

**Cause:** Slack connector not configured or inactive

**Solution:**
1. Check Connectors Dashboard for Slack entry
2. Verify connector status is "connected"
3. Test connection to validate bot token

### Bot not responding to mentions

**Cause:** Event subscription not configured

**Solution:**
1. Verify **Event Subscriptions** is enabled in Slack app
2. Check `app_mention` is in subscribed events
3. Ensure bot is invited to channel (`/invite @Oddjob`)
4. Verify Request URL is accessible (not behind firewall)

### "Identity Required" for known users

**Cause:** Email mismatch between Slack and Oddjob

**Solution:**
1. Verify user's Slack profile has email
2. Check email matches Oddjob account email
3. Create explicit identity mapping if needed

### Molt buttons not working

**Cause:** Interactivity URL not configured

**Solution:**
1. Enable **Interactivity & Shortcuts** in Slack app
2. Set Request URL to `/api/webhooks/messaging/slack/interactivity`
3. Reinstall app after changes

---

## Related Features

This integration leverages several Oddjob subsystems:

| Feature | Integration Point |
|---------|-------------------|
| **Unified Memory** | Intent analysis uses fused LTM + Knowledge Graph |
| **AgentMail** | Thread-based routing pattern (similar to email steering) |
| **Webhook Triggers** | Slack connector uses same webhook infrastructure |
| **Mission Orchestrator** | Rolling Wave orchestrator for mission execution |
| **Molt** | Interactive decision routing and approval workflow |
| **Evidence Storage** | File attachments stored in mission evidence |

---

## Testing

Run integration tests:

```bash
# Backend service tests
npm test -- tests/feature-relationships/

# Conversational bridge specific
npm test -- tests/domain/integrations/test-conversational-bridge.ts
```

Manual testing checklist:
- [ ] App mention triggers intent analysis
- [ ] DM launches mission
- [ ] Thread reply routes to existing mission
- [ ] File attachment creates deliverable
- [ ] Audio message transcribes and launches
- [ ] Unknown user blocked from mission launch
- [ ] Molt approve/reject buttons work
- [ ] Knowledge query returns results

---

**Last Updated:** April 27, 2026
