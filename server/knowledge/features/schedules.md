# Schedules Feature

## Overview
Schedules define timing patterns for automated job/pipeline execution.

## Components

### Schedules
Reusable timing patterns (e.g., "Every weekday at 9am").

### Scheduled Jobs
Links a job or pipeline to a schedule with specific trigger configuration.

## Schedule Patterns

| Pattern | Description | Example |
|---------|-------------|---------|
| 1 (Hourly) | Runs every hour | Every hour at :00 |
| 2 (Daily) | Runs once per day | Daily at 9:00 AM |
| 3 (Weekly) | Runs on specific days | Mon/Wed/Fri at 8:00 AM |
| 4 (Cron) | Custom cron expression | `0 8 * * 1-5` |

## Pattern String Examples

### Daily at 9am
```json
{"hour": 9, "minute": 0}
```

### Weekly Mon/Wed/Fri at 8am
```json
{"days": [1, 3, 5], "hour": 8, "minute": 0}
```

### Cron (Weekdays at 8am)
```json
{"cron": "0 8 * * 1-5"}
```

## Trigger Types

| Type | Description |
|------|-------------|
| Schedule | Runs on the linked schedule pattern |
| Webhook | Triggered by external webhook call |
| API | Triggered via API call |
| Manual | Must be manually triggered |

## Creating a Scheduled Job

### Example: Daily ETL Pipeline
```json
{
  "name": "Daily ETL",
  "pipelineId": 5,
  "scheduleId": 1,
  "triggerType": "Schedule",
  "isActive": true
}
```

### Example: Webhook-Triggered Job
```json
{
  "name": "JIRA Sync",
  "jobId": 10,
  "triggerType": "Webhook",
  "triggerCredentialId": 2
}
```

## Configuration Options

| Field | Purpose |
|-------|---------|
| `scheduleId` | Link to schedule pattern |
| `delayThreshold` | Minutes before delay alert (default: 15) |
| `maxRetries` | Retry attempts on failure (0-10) |
| `retryDelaySeconds` | Seconds between retries |
| `maxConcurrentRuns` | Parallel execution limit |
| `parameterValues` | Default parameters to pass |

## User Help Scenarios

| Scenario | Response |
|----------|----------|
| Set up recurring job | Create schedule, link via scheduled job |
| Job not running on schedule | Check schedule is active, verify cron syntax |
| Too many concurrent runs | Adjust maxConcurrentRuns setting |
