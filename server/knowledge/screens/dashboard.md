# Dashboard Screen

**Route**: `/dashboard`

## Overview
High-level view of system status, recent activity, and quick navigation.

## Sections

### Stats Cards
- Total jobs, pipelines, schedules
- Recent execution counts
- System health indicators

### Recent Activity
- Latest job runs
- Pipeline executions
- Alert notifications

### Quick Actions
- Create new job
- Create new pipeline
- Navigate to specific areas

## User Intent on This Screen
Users typically want to:
- Get quick overview of system status
- Navigate to specific feature area
- Check if anything is broken

## Help Scenarios

| Behavior | Likely Need | Response |
|----------|-------------|----------|
| Idle on dashboard | Unsure where to start | Suggest based on their role |
| Looking at failed count | Investigating issues | Use `list_failed_jobs` |
| Clicking stats | Wants more detail | Navigate to relevant screen |

## MCP Tools for This Screen
- `get_system_health` - Overall system status
- `list_failed_jobs` - Recent failures
- `list_recent_executions` - Recent activity
