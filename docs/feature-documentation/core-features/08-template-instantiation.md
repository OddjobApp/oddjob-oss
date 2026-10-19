# Template Instantiation

## Overview

Pipeline templates are pre-built, parameterised workflow blueprints stored in the `pipeline_templates` table. The **instantiation** feature allows any user (or an AI agent via MCP) to deploy a live, fully-wired pipeline from a template with a single API call or tool invocation.

Previously, `POST /api/templates/:id/instantiate` returned a `"not yet implemented"` stub. It now executes `templatesService.instantiateTemplate()` and returns the created pipeline.

---

## How Instantiation Works

1. **Fetch template** by ID — throws `NotFoundError` if missing.
2. **Parameter substitution** — stringifies the template `config` JSON and replaces every `{{key}}` placeholder using a regex global replace for each entry in `parameters`.
3. **Create pipeline** — inserts a new row into `pipelines` using the substituted config's `triggerType`, `description`, and the supplied `name` (falls back to `"<template name> (Copy)"`).
4. **Create jobs** — for each job definition in `config.jobs`, strips the template-local `id`, inserts a new `jobs` row, and records the old → new ID mapping.
5. **Create steps** — for each step in `config.steps`, rewrites `jobId` from the template-local ID to the real new ID, then inserts into `pipeline_steps`.
6. **Return** the created pipeline record.

---

## REST API

### Instantiate a Template
```
POST /api/templates/:id/instantiate
Authorization: Bearer <token>

{
  "name": "Acme Corp Report",
  "parameters": {
    "client_name": "Acme Corp",
    "report_frequency": "weekly"
  }
}
```

**Response:** Full pipeline object (same shape as `GET /api/pipelines/:id`).

---

## Template Parameter Schema

Templates declare their parameters in the `parameterSchema` column. Call `GET /api/templates/:id` or the MCP `get_template_details` tool to inspect the schema before instantiating.

```json
{
  "parameterSchema": {
    "client_name":       { "type": "string",  "required": true,  "description": "Client company name" },
    "report_frequency":  { "type": "string",  "required": false, "default": "monthly" }
  }
}
```

Any `{{variable}}` in the template config that is not supplied in `parameters` is left as-is.

---

## MCP Tools

Three template tools are now exposed to AI agents:

| Tool | Description |
|---|---|
| `list_templates` | Browse the template gallery with optional search/category filter |
| `get_template_details` | Read full config + parameterSchema for a specific template |
| `instantiate_template` | Create a live pipeline from a template with parameter substitution |

### Example MCP usage
```
list_templates({ category: "marketing", limit: 5 })
→ [{ id: 12, name: "Email Nurture Campaign", ... }]

get_template_details({ templateId: 12 })
→ { parameterSchema: { target_segment: { type: "string" } }, ... }

instantiate_template({
  templateId: 12,
  name: "Q2 Nurture — Enterprise",
  parameters: { target_segment: "enterprise" }
})
→ { id: 88, name: "Q2 Nurture — Enterprise", ... }
```

---

## Schema Mapping Templates

The service also provides CRUD for **schema mapping templates** (org-scoped, used in data transformation pipelines):

| Method | Route | Description |
|---|---|---|
| `GET`    | `/api/templates/schema-mappings`     | List org's schema mapping templates |
| `POST`   | `/api/templates/schema-mappings`     | Create a schema mapping template |
| `DELETE` | `/api/templates/schema-mappings/:id` | Delete (org-scoped guard) |

---

## Files

| File | Change |
|---|---|
| `server/routes/templates.ts` | Route wired to `templatesService.instantiateTemplate()` |
| `server/domain/core/infrastructure/templates.service.ts` | Added `getTemplate`, `createTemplate`, `listSchemaMappingTemplates`, `createSchemaMappingTemplate`, `deleteSchemaMappingTemplate` |
| `server/mcp/handlers/templates.ts` | Added `handleInstantiateTemplate` + `InstantiateTemplateInput` schema |
| `server/mcp/tools/templates.ts` | New tool definitions file for all 3 template MCP tools |
| `server/mcp/index.ts` | Registered `templateToolDefinitions` |
| `server/mcp/handlers.ts` | Added `instantiate_template` dispatch case |
| `server/domain/core/tests/templates-service.test.ts` | Unit tests |
