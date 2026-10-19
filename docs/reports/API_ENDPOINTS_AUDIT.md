# API Endpoints Audit

> **Spec References:** [docs/specs](../specs/README.md) — Feature-specific API details in CREDENTIALS_SPEC, SCHEDULES_SPEC, SaaS_INTEGRATIONS_SPEC, etc.

## Screens and Their API Endpoints

### ✅ Dashboard (`/dashboard`)
- **GET** `/api/dashboard/stats` ✅ EXISTS
- **GET** `/api/dashboard/timeline` ✅ EXISTS
- **GET** `/api/dashboard/insights` ✅ EXISTS

### ✅ Jobs (`/jobs`, `/jobs/:id`)
- **GET** `/api/jobs` ✅ EXISTS
- **POST** `/api/jobs` ✅ EXISTS
- **GET** `/api/jobs/:id` ✅ EXISTS
- **PUT** `/api/jobs/:id` ✅ EXISTS
- **PATCH** `/api/jobs/:id` ✅ EXISTS
- **DELETE** `/api/jobs/:id` ✅ EXISTS
- **GET** `/api/jobs/:id/pipeline-status` ✅ EXISTS
- **POST** `/api/jobs/:id/test` ✅ EXISTS

### ✅ Pipelines (`/pipelines`, `/pipelines/:id`)
- **GET** `/api/pipelines` ✅ EXISTS
- **GET** `/api/pipelines/:id` ✅ EXISTS
- **POST** `/api/pipelines` ✅ EXISTS
- **PUT** `/api/pipelines/:id` ✅ EXISTS
- **PATCH** `/api/pipelines/:id` ✅ EXISTS
- **DELETE** `/api/pipelines/:id` ✅ EXISTS
- **POST** `/api/pipelines/:id/execute` ✅ EXISTS
- **GET** `/api/pipelines/:id/executions` ✅ EXISTS

### ✅ Pipeline Executions (`/pipelines/:id/executions`, `/pipeline-executions/:id`)
- **GET** `/api/pipelines/:id/executions` ✅ EXISTS
- **GET** `/api/pipeline-executions/:id` ✅ EXISTS
- **POST** `/api/pipeline-executions/:id/rerun` ✅ EXISTS

### ✅ Schedules (`/schedules`, `/schedules/:id`)
- **GET** `/api/schedules` ✅ EXISTS
- **GET** `/api/schedules/:id` ✅ EXISTS
- **POST** `/api/schedules` ✅ EXISTS
- **PUT** `/api/schedules/:id` ✅ EXISTS
- **DELETE** `/api/schedules/:id` ✅ EXISTS
- **POST** `/api/schedules/preview` ✅ EXISTS

### ✅ Scheduled Jobs (`/scheduled-jobs`, `/scheduled-jobs/:id`)
- **GET** `/api/scheduled-jobs` ✅ EXISTS
- **GET** `/api/scheduled-jobs/:id` ✅ EXISTS
- **POST** `/api/scheduled-jobs` ✅ EXISTS
- **PUT** `/api/scheduled-jobs/:id` ✅ EXISTS
- **DELETE** `/api/scheduled-jobs/:id` ✅ EXISTS

### ✅ Monitoring (`/monitoring`, `/monitoring/:id`)
- **GET** `/api/executions` ✅ EXISTS
- **GET** `/api/executions/:id` ✅ EXISTS

### ✅ Alerts (`/alerts`)
- **GET** `/api/alerts` ✅ EXISTS
- **POST** `/api/alerts/:id/acknowledge` ✅ EXISTS

### ✅ Credentials (`/credentials`, `/credentials/:id`, `/credentials/new`)
- **GET** `/api/credentials` ✅ EXISTS
- **GET** `/api/credentials/:id` ✅ EXISTS
- **POST** `/api/credentials` ✅ EXISTS
- **PUT** `/api/credentials/:id` ✅ EXISTS
- **PATCH** `/api/credentials/:id` ✅ EXISTS
- **DELETE** `/api/credentials/:id` ✅ EXISTS
- **POST** `/api/credentials/check-secret` ✅ EXISTS

### ✅ Users (`/users`, `/users/:id`)
- **GET** `/api/users` ✅ EXISTS
- **GET** `/api/users/:id` ✅ EXISTS
- **PUT** `/api/users/:id` ✅ EXISTS
- **PATCH** `/api/users/:id` ✅ EXISTS
- **DELETE** `/api/users/:id` ✅ EXISTS
- **GET** `/api/users/current` ✅ EXISTS (used by Profile component)

### ⚠️ Settings (`/settings`)
- **No API endpoints** - Currently uses local state only (maintenance mode is in context)

### ✅ Authentication (`/auth/login`, `/auth/signup`)
- **POST** `/api/login` ✅ EXISTS
- **POST** `/api/register` ✅ EXISTS
- **POST** `/api/logout` ✅ EXISTS
- **GET** `/api/user` ✅ EXISTS

### ✅ RAG Assets (used in Jobs)
- **GET** `/api/rag-assets` ✅ EXISTS
- **POST** `/api/rag-assets` ✅ EXISTS
- **PUT** `/api/rag-assets/:id` ✅ EXISTS
- **DELETE** `/api/rag-assets/:id` ✅ EXISTS
- **POST** `/api/rag-assets/reorder` ✅ EXISTS
- **POST** `/api/rag-assets/upload` ✅ EXISTS

## Additional API Groups

The following route groups are not fully enumerated in this audit. Full endpoint coverage may be documented in OpenAPI specs or route source files. See [docs/specs](../specs/README.md) for feature-specific API documentation. For a complete list of routes, see `server/routes/*.ts` and `server/index.ts`.

**Note:** A comprehensive audit of all route groups is out of scope for this document. The Dashboard section above documents `/api/dashboard/stats`, `/api/dashboard/timeline`, and `/api/dashboard/insights`. Other groups below are summarized for reference.

| Route Prefix | Description | Key Endpoints |
|--------------|-------------|---------------|
| `/api/knowledge-graph/*` | Knowledge graph, nodes, edges, topics, documents | 30+ endpoints for CRUD, search, staging | 
| `/api/saas/*` | SaaS connectors (JIRA, Confluence, GitHub, etc.) | Connectors, sync, workflows | 
| `/api/predictive/*` | Predictive AI analytics | Dashboard, failures, resources, config | 
| `/api/agent-chat` | System copilot / agent chat | Chat endpoints | 
| `/api/agent-deployments` | Agent deployment management | Public agent deployment | 
| `/api/agent-analytics` | Agent analytics | Memory, metrics | 
| `/api/approvals` | Human-in-the-loop approvals | Decision inbox, approve/reject | 
| `/api/form-agents` | Form-powered agents | Form agent CRUD | 
| `/api/licensing` | License management | License status | 
| `/api/analytics/*` | Analytics dashboard | Cost, usage, stats | 

## Missing Endpoints

✅ **All core endpoints are now implemented!**

### Workgroups (`/workgroups`, `/workgroups/:id`)
- **GET** `/api/workgroups` ✅ EXISTS – List workgroups
- **POST** `/api/workgroups` ✅ EXISTS – Create workgroup (validates dependencies by default)
- **POST** `/api/workgroups/validate` ✅ EXISTS – Pre-creation dependency validation (same body as create)
- **GET** `/api/workgroups/:id` ✅ EXISTS – Detail
- **PATCH** `/api/workgroups/:id` ✅ EXISTS – Update
- **DELETE** `/api/workgroups/:id` ✅ EXISTS – Delete
- **GET** `/api/workgroups/:id/activity` ✅ EXISTS – Activity stream
- **GET** `/api/workgroups/:id/history` ✅ EXISTS – Blackboard history
- **POST** `/api/workgroups/:id/chat` ✅ EXISTS – Mission Control chat
- **POST** `/api/workgroups/:id/members` ✅ EXISTS – Add member
- **POST** `/api/workgroups/:id/members/:memberId/status` ✅ EXISTS – Update member status
- **POST** `/api/workgroups/:id/template` ✅ EXISTS – Create template from workgroup
- **GET** `/api/workgroups/:id/delete-diagnostic` ✅ EXISTS – Diagnostic for delete blockers
- **GET** `/api/workgroups/templates` ✅ EXISTS – List templates
- **POST** `/api/workgroups/plan` ✅ EXISTS – AI mission planning
- **POST** `/api/workgroups/templates/:id/instantiate` ✅ EXISTS – Instantiate template

### Recently Added:
1. ✅ **POST** `/api/credentials/check-secret` - Validates secret exists in environment variables
2. ✅ **GET** `/api/users/current` - Gets current authenticated user
3. ✅ **PATCH** `/api/jobs/:id` - Partial update for jobs (client uses this)
4. ✅ **PATCH** `/api/pipelines/:id` - Partial update for pipelines (client uses this)
5. ✅ **POST** `/api/workgroups/validate` - Pre-creation dependency validation

## Summary

- **Total Screens**: 12 main screens
- **Screens with Complete API Coverage**: 11/12 (91.7%)
- **Screens with Missing Endpoints**: 0 ✅
- **Screens with No API (Local State Only)**: 1 (Settings - by design)
- **All Required Endpoints**: ✅ COMPLETE

