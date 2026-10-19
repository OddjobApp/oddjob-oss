# Schedule MCP Tools

## Schedule Operations

### list_schedules
List all schedule patterns.
```
list_schedules(activeOnly?: boolean)
```

### get_schedule_details
Get schedule configuration.
```
get_schedule_details(scheduleId?: number, scheduleName?: string)
```

### create_schedule
Create a timing pattern.
```
create_schedule(name: string, pattern: number, patternString: object, timezone?: string)
```
Pattern values: 1=hourly, 2=daily, 3=weekly, 4=cron

### update_schedule
Modify a schedule.
```
update_schedule(scheduleId: number, patternString?: object, isActive?: boolean)
```

## Scheduled Job Operations

### list_scheduled_jobs
List all job/pipeline schedules.
```
list_scheduled_jobs(activeOnly?: boolean, triggerType?: string)
```

### create_scheduled_job
Schedule a job or pipeline.
```
create_scheduled_job(
  name: string,
  jobId?: number,          // Use this OR pipelineId
  pipelineId?: number,
  scheduleId?: number,
  triggerType?: string,    // Schedule, Webhook, API, Manual
  isActive?: boolean
)
```

### update_scheduled_job
Modify scheduling configuration.
```
update_scheduled_job(scheduledJobId: number, config: object)
```

### get_upcoming_scheduled_runs
See what's scheduled to run soon.
```
get_upcoming_scheduled_runs(limit?: number)
```

## Usage Patterns

### Schedule a Daily Job
1. Create schedule: `create_schedule("Daily 9am", 2, {hour: 9, minute: 0})`
2. Link to job: `create_scheduled_job("Daily ETL", jobId: 5, scheduleId: 1)`
