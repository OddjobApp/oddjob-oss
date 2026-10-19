# Jobs Feature

## Overview
Jobs are reusable task definitions that execute specific actions. They can run standalone or as pipeline steps.

## Concepts & Terminology

### Activity Type vs. Task
To ensure clarity when assisting users, distinction between these terms is critical:

- **Activity Type (System Term: Job Type)**: The technical definition or "class" of a capability.
    - *Examples*: `shell`, `http_request`, `sql_query`, `ai_agent`.
    - *Analogy*: Think of this as the "Blueprint" or "Function Definition".

- **Task (System Term: Job)**: A specific, configured instance of an Activity Type.
    - *Examples*: "Daily Database Backup" (a Task of type `sql_query`), "Ping Health Check" (a Task of type `http_request`).
    - *Analogy*: Think of this as the "Instance" or "Object".

**Key Takeaway**: Users create **Tasks** by selecting an **Activity Type**. When a user asks to "create a task", they need to choose the "activity type" first.

## Activity Types (Job Types)

### API/Integration
| Type | Purpose | Key Config |
|------|---------|------------|
| `curl` | HTTP API calls | `url`, `method`, `headers`, `body`, `credentialId` |
| `openapi` | OpenAPI spec operations | `specId`, `operationId`, `parameters` |
| `selenium` | Browser automation | `mode` (local/grid/auto_pilot), `browserType`, `headless`, `steps[]`, `startUrl`, `goal` |

> [!NOTE] 
> The `selenium` job type supports an `auto_pilot` mode. When `mode: "auto_pilot"` is set, instead of executing a rigid array of steps, it routes to `SeleniumAgentService.runAutoPilot()`, which uses an LLM to dynamically browse the page and achieve the `goal`. This mode supports the `extract_knowledge` capability.

### Script Execution
| Type | Purpose | Key Config |
|------|---------|------------|
| `shell` | Bash/PowerShell | `command`, `workingDir`, `timeout` |
| `python` | Python scripts | `script`, `requirements`, `timeout` |
| `node_script` | Node.js scripts | `script`, `dependencies` |

### AI/ML
| Type | Purpose | Key Config |
|------|---------|------------|
| `ai_api_call` | Single LLM completion | `prompt`, `model`, `temperature` |
| `ai_agent` | Multi-turn agent | `systemPrompt`, `tools`, `maxIterations` |
| `reranker` | RAG reranking | `query`, `documents`, `topK` |

### Data Processing
| Type | Purpose | Key Config |
|------|---------|------------|
| `transformer` | Data transformation | `rules[]`, `inputPath`, `outputPath` |
| `sql_query` | Database queries | `query`, `credentialId` |
| `folder_import` | Import files | `folderPath`, `pattern`, `recursive` |
| `file_export` | Export data | `destinationPath`, `format` |

### Control Flow
| Type | Purpose | Key Config |
|------|---------|------------|
| `iterator` | Loop over collection | `inputArray`, `targetJobId`, `itemVarName` |
| `decision` | Conditional branch | `condition`, `trueStepId`, `falseStepId` |
| `repeater` | Retry/repeat | `maxRetries`, `delayMs` |
| `human_approval` | Manual gate | `assigneeEmail`, `timeoutHours` |

### Notifications
| Type | Purpose | Key Config |
|------|---------|------------|
| `slack_post` | Slack messages | `credentialId`, `channelId`, `message` |
| `email_send` | Email | `credentialId`, `to`, `subject`, `body` |

## Common Patterns

### JIRA Integration
```json
{
  "type": "curl",
  "url": "/rest/api/3/search",
  "method": "GET",
  "credentialId": <JIRA_CREDENTIAL_ID>,
  "queryParams": {
    "jql": "project = PROJ AND status = \"In Development\"",
    "fields": "key,summary,status"
  }
}
```

### Data Transformation
```json
{
  "type": "transformer",
  "rules": [
    {"path": "$.items[*]", "transform": "extract", "fields": ["id", "name"]}
  ]
}
```

## User Help Scenarios

| Scenario | Response |
|----------|----------|
| User unsure which job type | List types with use cases, ask about goal |
| User stuck on config | Get job schema, show example |
| Job failing | Check recent runs, suggest debug steps |
