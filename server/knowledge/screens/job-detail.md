# Job Detail Screen

**Route**: `/jobs/:id`

## Overview
Configure and manage a specific job definition.

## Tabs

| Tab | Purpose | User Intent |
|-----|---------|-------------|
| **Overview** | Name, type, status, description | Understanding the job |
| **Configuration** | Type-specific settings | Editing behavior |
| **Schemas** | Input/output data schemas | Defining data structure |
| **Runs** | Execution history | Debugging, reviewing results |
| **Variables** | Environment variables | Configuring secrets/params |

## Cards

### JobOverviewCard
- Job name, type, status
- Last run info
- Quick actions (Run, Edit)

### Type-Specific Config Cards
| Card | Job Types | Help Focus |
|------|-----------|------------|
| CurlJobConfigCard | curl | URL, method, headers, auth |
| AIJobConfigCard | ai_api_call, ai_agent | Model, prompt, temperature |
| ShellJobConfigCard | shell | Command, working dir, timeout |
| RepeaterJobConfigCard | repeater | Loop config, item variable |

### JobOutputStorageCard
- Output dataset selection
- Schema mapping configuration

## Common Help Scenarios

| User Behavior | Likely Need | Response |
|---------------|-------------|----------|
| Idle on Configuration tab | Unsure how to configure | Show job type schema |
| Viewing failed runs | Debugging failure | Check logs, suggest fix |
| On Schemas tab | Defining data structure | Explain input/output schema |
| Clicking "Test" button | Wants to validate | Offer dry-run guidance |

## MCP Tools for This Screen
- `get_job_details` - Get current configuration
- `get_job_schema` - Get config schema for job type
- `update_job` - Make changes
- `list_recent_executions` - Check run history
