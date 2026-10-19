# Monitoring Screen

**Route**: `/monitoring`, `/alerts`, `/observability`

## Overview
System health monitoring, alerting, and observability.

## Sections

### System Health
- Overall status indicator
- Component health checks
- Resource utilization

### Active Alerts
- Current alert notifications
- Severity levels
- Quick acknowledge/resolve

### Execution Metrics
- Job success/failure rates
- Pipeline throughput
- Schedule adherence

## Alert Severity Levels

| Level | Response Time | Examples |
|-------|---------------|----------|
| Critical | Immediate | Auth failures, system down |
| High | < 1 hour | Job failures, timeouts |
| Medium | < 4 hours | Schedule delays |
| Low | Next business day | Warnings, notifications |

## Troubleshooting Workflow

1. **Check System Health** - `get_system_health()`
2. **List Recent Failures** - `list_failed_jobs()`
3. **Get Execution Details** - `get_pipeline_execution_status()`
4. **Search Related Entities** - `search_knowledge_graph()`

## Help Scenarios

| Behavior | Likely Need | Response |
|----------|-------------|----------|
| Viewing alerts | Investigating issue | Run diagnostics |
| Idle on monitoring | Looking for problems | Summarize system health |
| Clicking failed job | Wants details | Show error and suggest fix |

## MCP Tools for This Screen
- `get_system_health` - System status
- `list_failed_jobs` - Recent failures
- `list_recent_executions` - Execution history
- `search_knowledge_graph` - Find related entities
