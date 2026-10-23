# Automations

## Overview
The Automations screen manages reusable timing rules for automated job and pipeline execution. Create, search, and edit daily, weekly, monthly, or custom-cron rules. Enabling a timing rule does not attach executable work; connect the rule to a scheduled job or pipeline separately.

## Components

### Automation timing rules
Reusable timing patterns (e.g., "Every weekday at 9am").

### Scheduled Jobs
Links a job or pipeline to a schedule with specific trigger configuration.

## Schedule Patterns

| Pattern | Description | Example |
|---------|-------------|---------|
| 1 (Daily) | Runs once per day | Daily at 9:00 AM |
| 2 (Weekly) | Runs on selected weekdays | Monday at 9:00 AM |
| 3 (Monthly) | Runs on a selected day of the month | Day 1 at 10:00 AM |
| 4 (Cron) | Custom cron expression | `0 8 * * 1-5` |

## Pattern String Examples

### Daily at 9am
```json
{"starttime": "09:00"}
```

### Weekly Mon/Wed/Fri at 8am
```json
{"starttime": "08:00", "weekdays": "1,3,5"}
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
