# Oddjob Copilot Knowledge Base

This document provides comprehensive knowledge about Oddjob's UI, features, and MCP tools
for the System Copilot to provide accurate, context-aware assistance.

## Application Overview

Oddjob is an automation orchestration platform that enables users to:
- Create and manage automation **Jobs** (reusable task definitions)
- Build **Pipelines** (multi-step workflows connecting jobs)
- Schedule automated execution using **Schedules** and **Scheduled Jobs**
- Store and query organizational knowledge in the **Knowledge Graph**
- Monitor system health and troubleshoot issues via **Alerts** and **Monitoring**

---

## Screen/Page Reference

### Core Operations

| Screen | Route | Purpose | Key Actions |
|--------|-------|---------|-------------|
| **Dashboard** | `/dashboard` | Overview of system status, recent activity, quick stats | View metrics, navigate to areas |
| **Jobs** | `/jobs` | List all job definitions | Create, search, filter jobs |
| **Job Detail** | `/jobs/:id` | Configure a specific job | Edit config, test, view runs |
| **Pipelines** | `/pipelines` | List all pipelines | Create, search, filter pipelines |
| **Pipeline Detail** | `/pipelines/:id` | Build/edit pipeline workflow | Add steps, configure flow, run |
| **Templates** | `/templates` | Pre-built pipeline/job templates | Browse, instantiate templates |

### Scheduling & Monitoring

| Screen | Route | Purpose | Key Actions |
|--------|-------|---------|-------------|
| **Schedules** | `/schedules` | Manage timing patterns (cron, daily, etc.) | Create schedule patterns |
| **Scheduled Jobs** | `/scheduled-jobs` | Link jobs/pipelines to schedules | Schedule automation runs |
| **Monitoring** | `/monitoring` | Real-time system health | View metrics, performance |
| **Observability** | `/observability` | Detailed tracing and logs | Deep dive into executions |
| **Alerts** | `/alerts` | Alert rules and notifications | Configure thresholds, notifications |

### Knowledge Management

| Screen | Route | Purpose | Key Actions |
|--------|-------|---------|-------------|
| **Knowledge Dashboard** | `/knowledge` | Overview of knowledge graph | View stats, recent entities |
| **Knowledge Garden** | `/knowledge/garden` | Document and enrichment ingestion | Upload docs, enrich with AI |
| **Knowledge Graph** | `/knowledge/graph` | Visual graph explorer | Search entities, view relationships |
| **Knowledge Store** | `/knowledge-store` | Document storage (RAG) | Upload, search documents |
| **Datasets** | `/datasets` | Structured data collections | Create, manage datasets |

### Administration

| Screen | Route | Purpose | Key Actions |
|--------|-------|---------|-------------|
| **Credentials** | `/credentials` | API keys, auth tokens | Add/manage credentials |
| **Organizations** | `/organizations` | Multi-tenant org management | Create/manage orgs |
| **Users** | `/users` | User account management | Add users, assign roles |
| **Settings** | `/settings` | System configuration | Adjust global settings |
| **Tool Registry** | `/admin/tools` | MCP tool management | View available tools |
| **Event Log** | `/admin/events` | Audit trail | Review system events |

---

## UI Components (Cards)

### Job Configuration Cards

| Card | Location | Purpose | User Goal |
|------|----------|---------|-----------|
| **JobOverviewCard** | Job Detail | Job name, type, status | Understand job basics |
| **CurlJobConfigCard** | Job Detail (CURL type) | HTTP request configuration | Configure API calls |
| **AIJobConfigCard** | Job Detail (AI types) | AI model, prompt configuration | Set up AI tasks |
| **ShellJobConfigCard** | Job Detail (Shell type) | Shell command configuration | Configure scripts |
| **RepeaterJobConfigCard** | Job Detail (Repeater) | Loop/iteration config | Process collections |
| **RerankerJobConfigCard** | Job Detail (Reranker) | RAG reranking config | Configure semantic search |
| **JobOutputStorageCard** | Job Detail | Output dataset selection | Store job results |

### Dashboard Cards

| Card | Purpose | What to Help With |
|------|---------|-------------------|
| **StatCard** | Display key metrics | Explain what metrics mean |
| **Recent Activity** | Show recent runs | Navigate to specific runs |
| **System Health** | Overall status | Diagnose issues |

### Tab Panels (Job Detail)

| Tab | Content | User Intent When Here |
|-----|---------|----------------------|
| **Overview** | Basic job info, status | Understanding the job |
| **Configuration** | Type-specific settings | Editing behavior |
| **Schemas** | Input/output schemas | Defining data structure |
| **Runs** | Execution history | Debugging, reviewing results |
| **Variables** | Environment variables | Configuring secrets/params |

---

## MCP Tools Reference

### Job Management Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `list_jobs` | Get all jobs | User asks "what jobs exist", "show my jobs" |
| `get_job_details` | Get specific job config | User asks about a job, mentions job by name/ID |
| `create_job` | Create new job | User wants to automate something new |
| `update_job` | Modify existing job | User wants to change job behavior |
| `delete_job` | Remove a job | User wants to clean up |
| `get_job_schema` | Get config schema for job type | Before creating a job, understand structure |

### Template Management Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `list_templates` | GetAll templates | User asks "what templates are available", "suggest a workflow" |
| `get_template_details` | Inspect template | User wants to know what a template does |

### Pipeline Management Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `list_pipelines` | Get all pipelines | User asks about workflows |
| `get_pipeline_details` | Get pipeline steps and config | User asks about specific pipeline |
| `create_pipeline` | Create new workflow | User wants multi-step automation |
| `update_pipeline` | Modify pipeline | User wants to change workflow |
| `delete_pipeline` | Remove pipeline | Cleanup |
| `add_pipeline_step` | Add step to pipeline | Building out workflow |
| `update_pipeline_step` | Modify a step | Changing step behavior |
| `delete_pipeline_step` | Remove a step | Simplifying workflow |
| `trigger_pipeline` | Execute a pipeline | User wants to run now |
| `run_pipeline` | Same as trigger | User wants to run now |
| `list_recent_executions` | Get recent runs | Debugging, monitoring |
| `get_pipeline_variable_syntax` | Learn variable syntax | Before connecting steps |

### Schedule Management Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `list_schedules` | Get schedule patterns | User asks about timing |
| `get_schedule_details` | Get specific schedule | User asks about a schedule |
| `create_schedule` | Create timing pattern | User wants recurring automation |
| `update_schedule` | Modify schedule | Change timing |
| `list_scheduled_jobs` | Get job/pipeline schedules | What's scheduled to run |
| `create_scheduled_job` | Schedule a job/pipeline | User wants automatic runs |
| `update_scheduled_job` | Modify scheduled job | Change what runs when |
| `get_upcoming_scheduled_runs` | What's running soon | User asks "what's next" |

### Knowledge Graph Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `search_knowledge_graph` | Find entities | User asks about relationships, systems |
| `get_entity_impact` | Analyze dependencies | User asks "what depends on X" |
| `create_entity` | Add to graph | User wants to track something |
| `create_relationship` | Link entities | User wants to connect things |
| `suggest_schema` | AI-generate ontology | User setting up new domain |
| `get_graph_statistics` | Graph overview | User asks about graph size |
| `list_datasets` | List structured datasets | User asks about Jira, GitHub, or "datasets" |
| `query_dataset` | Search within a dataset | User asks for specific issues, tickets, or rows |
| `get_dataset_details` | Get schema/metadata | Understand what fields are searchable |
| `create_dataset` | Create new collection | Exporting results to a new dataset |
| `add_dataset_items`| Insert data into dataset | Storing processed information |

### Utility Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `sql_query` | Query database directly | Complex queries, debugging |
| `current_time` | Get current timestamp | Time-sensitive operations |
| `calculator` | Math operations | Calculations |
| `get_system_health` | Overall system status | Diagnosing issues |
| `list_failed_jobs` | Recent failures | Troubleshooting |
| `list_credentials` | Available credentials | Before creating jobs that need auth |
| `get_credential_info` | Credential metadata | Understanding available integrations |

---

## Job Types Deep Dive

### API/Integration Jobs

| Type | Use Case | Key Config Fields |
|------|----------|-------------------|
| `curl` | HTTP API calls | `url`, `method`, `headers`, `body`, `credentialId` |
| `openapi` | OpenAPI spec operations | `specId`, `operationId`, `parameters` |
| `selenium` | Browser automation | `browserType`, `headless`, `steps[]` |

### Script Execution Jobs

| Type | Use Case | Key Config Fields |
|------|----------|-------------------|
| `shell` | Bash/PowerShell commands | `command`, `workingDir`, `timeout` |
| `python` | Python script execution | `script`, `requirements`, `timeout` |
| `node_script` | Node.js script execution | `script`, `dependencies` |

### AI/ML Jobs

| Type | Use Case | Key Config Fields |
|------|----------|-------------------|
| `ai_api_call` | Single LLM completion | `prompt`, `model`, `temperature` |
| `ai_agent` | Multi-turn agent with tools | `systemPrompt`, `tools`, `maxIterations` |
| `reranker` | RAG semantic reranking | `query`, `documents`, `topK` |

### Data Processing Jobs

| Type | Use Case | Key Config Fields |
|------|----------|-------------------|
| `transformer` | Data transformation (jq/JSONata) | `rules[]`, `inputPath`, `outputPath` |
| `sql_query` | Database queries | `query`, `credentialId` |
| `folder_import` | Import files from directory | `folderPath`, `pattern`, `recursive` |
| `file_export` | Export data to files | `destinationPath`, `format`, `content` |

### Control Flow Jobs

| Type | Use Case | Key Config Fields |
|------|----------|-------------------|
| `iterator` | Loop over collection | `inputArray`, `targetJobId`, `itemVarName` |
| `decision` | Conditional branching | `condition`, `trueStepId`, `falseStepId` |
| `repeater` | Retry/repeat execution | `maxRetries`, `delayMs`, `condition` |
| `human_approval` | Manual approval gate | `formId`, `assigneeEmail`, `timeoutHours` |

### Notification Jobs

| Type | Use Case | Key Config Fields |
|------|----------|-------------------|
| `slack_post` | Slack messages | `credentialId`, `channelId`, `message` |
| `email_send` | Email notifications | `credentialId`, `to`, `subject`, `body` |

---

## Context-Aware Assistance Patterns

### When User is on Job Detail Page

If user is idle or struggling on a job configuration:
1. Check job type from context
2. Offer specific help for that job type's config
3. Suggest common patterns for that job type
4. Offer to show similar jobs as examples

### When User is on Pipeline Builder

If user is building a pipeline:
1. Explain step connection using `{{steps.N.output}}`
2. Offer to suggest next steps based on current flow
3. Warn about common mistakes (missing connections, type mismatches)

### When User is on Alerts Page

If user is investigating alerts:
1. Use `list_failed_jobs` to find recent failures
2. Use `search_knowledge_graph` to find related entities
3. Offer diagnostic suggestions based on alert type

### When User is on Knowledge Graph

If user is exploring the graph:
1. Use `search_knowledge_graph` for their query
2. Use `get_entity_impact` for dependency questions
3. **Cross-Reference**: If the graph mentions external links (Jira/GitHub), use `list_datasets` to find the corresponding data.
4. Offer to create entities/relationships as needed

### When User is on Datasets Page

If user is managing datasets:
1. Use `list_datasets` to understand inventory
2. Use `query_dataset` to show sample data if asked
3. Offer to create new datasets from AI analysis results
4. Help define schemas for new datasets via `create_dataset`

---

## Response Guidelines by Cognitive State

### S (Symptom) - User is Stuck/Frustrated
- Be **direct** and **action-oriented**
- Provide immediate, specific solutions
- Use bullet points for quick scanning
- Offer to run diagnostics

### C (Cause) - User is Diagnosing
- Be **educational** and explain the "why"
- Show cause-effect relationships
- Suggest better architectural approaches
- Reference knowledge graph connections

### O (Outcome) - User Knows What They Want
- Be **efficient** and **proactive**
- Offer to generate the full config/pipeline
- Skip explanations, focus on delivery
- Confirm and execute quickly

### R (Resource) - User Needs Information
- Be **precise** and **technical**
- Provide exact syntax, schemas, examples
- Link to relevant documentation
- Show code snippets they can copy

### E (Effect) - User is Validating
- Be **reassuring** and **thorough**
- Suggest verification steps
- Offer to run tests (e.g., direct data queries via `query_dataset`)
- Point out potential edge cases

### 🧠 Strategic Persona: Knowledge Engine & Data Explorer
When in the Knowledge Graph or Global Context:
- **Research Policy**: Always check BOTH the Knowledge Graph (unstructured) AND Datasets (structured).
- **Tool Priority**: Prioritize `list_datasets` and `query_dataset` for any request mentioning "counts", "stats", "tickets", or "issues".
- **Verification**: Cross-reference Graph Nodes with Dataset entries to provide a unified truth.
