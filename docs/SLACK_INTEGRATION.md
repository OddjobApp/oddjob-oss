# Slack Integration

Complete integration guide for connecting Oddjob to Slack workspaces.

---

## Overview

The Slack Integration enables team collaboration by connecting Oddjob jobs, missions, and approvals directly to Slack channels. Teams can execute jobs, receive notifications, and approve requests without leaving Slack.

---

## Features

### Slash Commands
- `/oddjob help` - Display available commands
- `/oddjob run <job-id>` - Execute a job
- `/oddjob status <job-id>` - Check job health status
- `/oddjob jobs` - List recent jobs
- `/oddjob missions` - List recent missions
- `/oddjob collections` - List recent collections
- `/oddjob approve [approval-id]` - List or approve pending approvals

### Interactive Components
- **Approval Buttons**: One-click approve/reject directly in Slack
- **Job Status Cards**: Rich formatting with health scores
- **Mission Notifications**: Automatic completion/failure alerts
- **Thread Support**: Organized conversation threads

### Notifications
- Mission completion alerts
- Job failure notifications
- Approval requests with interactive buttons
- Collection execution summaries
- **App launch notifications** - When apps are published/deployed

---

## Installation

### 1. Environment Variables

```env
# Slack App Credentials
SLACK_CLIENT_ID=your_client_id
SLACK_CLIENT_SECRET=your_client_secret
SLACK_SIGNING_SECRET=your_signing_secret

# App URL (for OAuth callback)
APP_URL=https://your-app.com
```

### 2. Database Migration

```bash
# Run schema
psql -d oddjob < server/migrations/002_slack_integration.sql
```

### 3. Register Routes

```typescript
// server/app.ts
import slackRoutes from "./routes/integrations/slack.route.js";

app.use("/api/integrations", slackRoutes);
```

### 4. Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name it "Oddjob" and select your workspace
4. Add these OAuth scopes:
   - `chat:write` - Send messages
   - `commands` - Slash commands
   - `im:write` - Direct messages
   - `channels:read` - Read channel info
   - `groups:read` - Read private channel info
   - `mpim:read` - Read multi-person IM info

5. Add slash commands:
   - Command: `/oddjob`
   - Request URL: `https://your-app.com/api/integrations/slack/command`
   - Short description: "Control Oddjob from Slack"

6. Enable Interactivity:
   - Request URL: `https://your-app.com/api/integrations/slack/interaction`

7. Set OAuth Redirect URL:
   - `https://your-app.com/api/integrations/slack/callback`

8. Install to workspace and copy credentials

---

## API Endpoints

### Installation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/slack/install` | Get OAuth install URL |
| GET | `/api/integrations/slack/callback` | OAuth callback handler |

### Commands & Interactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/integrations/slack/command` | Handle slash commands |
| POST | `/api/integrations/slack/interaction` | Handle button clicks |
| POST | `/api/integrations/slack/event` | Handle Slack events |

### Workspace Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/slack/workspaces` | List connected workspaces |
| GET | `/api/integrations/slack/workspaces/:id` | Get workspace details |
| PUT | `/api/integrations/slack/workspaces/:id/settings` | Update settings |
| DELETE | `/api/integrations/slack/workspaces/:id` | Disconnect workspace |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/integrations/slack/notify` | Send manual notification |
| GET | `/api/integrations/slack/notifications` | List notification history |

---

## Usage Examples

### Connecting a Workspace

```typescript
// User clicks "Connect Slack" button
const response = await fetch("/api/integrations/slack/install");
const { installUrl } = await response.json();

// Redirect user to installUrl
window.location.href = installUrl;

// After OAuth, user returns to callback URL
// Workspace is automatically configured
```

### Sending a Notification

```typescript
import { slackService } from "@domain/integrations/core/slack.service.js";

// Send mission completion notification
await slackService.sendNotification(workspaceId, "mission_complete", {
    missionId: 123,
    missionName: "Data Pipeline",
    duration: 45,
    jobCount: 5,
});

// Send job failure alert
await slackService.sendNotification(workspaceId, "job_failure", {
    jobId: 456,
    jobName: "Data Import",
    errorMessage: "Connection timeout",
});

// Send approval request
await slackService.sendNotification(workspaceId, "approval_requested", {
    approvalRequestId: 789,
    jobName: "Deploy to Production",
    requesterName: "John Doe",
    description: "Production deployment approval needed",
});

// Send app launched notification
await slackService.sendNotification(workspaceId, "app_launched", {
    appId: 123,
    slug: "my-dashboard",
    name: "My Analytics Dashboard",
    organizationId: 1,
    publicUrl: "https://your-app.com/app/my-dashboard",
});
```

### Handling Commands Programmatically

```typescript
// Process a slash command
const result = await slackService.handleCommand({
    command: "/oddjob",
    text: "run 123",
    user_id: "U123",
    team_id: "T123",
    channel_id: "C123",
    response_url: "https://hooks.slack.com/...",
    // ... other fields
});

// Result is formatted for Slack response
console.log(result.text); // "✅ Job *Test Job* started!"
```

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `slack_workspaces` | Connected Slack teams |
| `slack_commands` | Slash command history |
| `slack_interactions` | Button click tracking |
| `slack_notifications` | Notification delivery log |
| `slack_channel_subscriptions` | Channel notification preferences |

### Key Fields

**slack_workspaces:**
- `team_id` - Slack team identifier
- `bot_token` - OAuth bot token (encrypted)
- `default_channel` - Default notification channel
- `notify_on_mission_complete`
- `notify_on_job_failure`
- `notify_on_approval`
- `notify_on_app_launched` - App deployment notifications

---

## Security

### Request Verification

All Slack requests are verified using signature validation:

```typescript
function verifySlackRequest(signature: string, timestamp: string, body: any): boolean {
    const sigBaseString = `v0:${timestamp}:${JSON.stringify(body)}`;
    const mySignature = "v0=" + crypto
        .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
        .update(sigBaseString)
        .digest("hex");
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(mySignature)
    );
}
```

### Token Storage

- Bot tokens are encrypted at rest
- User tokens (if used) are stored separately
- Tokens are never logged or exposed in API responses

---

## Testing

```bash
# Run Slack integration tests
npm test -- tests/integrations/slack.test.ts
```

### Manual Testing

1. **Install to test workspace:**
   ```bash
   curl https://your-app.com/api/integrations/slack/install
   ```

2. **Test slash command:**
   ```bash
   curl -X POST https://your-app.com/api/integrations/slack/command \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "command=/oddjob&text=help&team_id=T123&user_id=U123"
   ```

3. **Test notification:**
   ```bash
   curl -X POST https://your-app.com/api/integrations/slack/notify \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "workspaceId": 1,
       "channel": "#general",
       "message": "Test notification"
     }'
   ```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Workspace not connected" | Check OAuth flow completed successfully |
| "Invalid request signature" | Verify SLACK_SIGNING_SECRET matches Slack app |
| Commands not appearing | Reinstall app after adding slash commands |
| Notifications not sending | Check workspace isActive flag and notification settings |
| Rate limited | Implement exponential backoff in webhook handlers |

---

## Configuration

### Per-Workspace Settings

```typescript
// Update notification preferences
await db.update(slackWorkspaces)
    .set({
        notifyOnMissionComplete: true,
        notifyOnJobFailure: true,
        notifyOnApproval: true,
        notifyOnAppLaunched: true,
        defaultChannel: "#alerts",
    })
    .where(eq(slackWorkspaces.id, workspaceId));
```

### Channel Subscriptions

```typescript
// Subscribe specific channel to mission notifications
await db.insert(slackChannelSubscriptions).values({
    workspaceId: 1,
    organizationId: 1,
    channelId: "C123456",
    channelName: "#data-pipelines",
    notifyMissions: true,
    notifyJobs: false,
    notifyApprovals: false,
    subscribedMissionIds: [1, 2, 3], // Only these missions
});
```

---

## Best Practices

1. **Use threads** for long-running conversation
2. **Set default channels** for each notification type
3. **Enable fallback** to email for critical notifications
4. **Monitor delivery status** via `slack_notifications` table
5. **Implement rate limiting** for high-frequency jobs
6. **Use ephemeral responses** for sensitive data

---

For questions or issues, refer to the service implementation in:
- `@domain/integrations/core/slack.service.ts`
- `@server/routes/integrations/slack.route.ts`
