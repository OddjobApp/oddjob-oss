# Dynamic SaaS Schema Synchronization

## What it is

The Dynamic SaaS Schema Synchronization is an intelligent drift-detection mechanism designed to keep Oddjob natively aware of an organization's custom SaaS configurations (like JIRA) without hardcoding proprietary fields or workflows into Oddjob's database.

---

## Feature Overview

### Purpose

Enables the platform and AI Agents to:
- **Introspect** live SaaS schemas during sync operations.
- **Understand** custom issue types, workflows, estimations, and dynamically generated fields without pre-defined mapping.
- **Render** dynamic UI options for Human-In-The-Loop (HIL) forms based on real-time external data.
- **Operate** contextually aware within highly customized environments.

### Key Capabilities

| Capability | Description |
|---|---|
| **Drift Detection** | Intelligently snapshots SaaS schemas only when structural changes occur, preventing database bloat. |
| **Agent Prompt Injection** | Automatically maps human-readable names (e.g., "Priority", "Reopen Reason") to custom SaaS field IDs (`customfield_10014`) directly in the agent's system prompt. |
| **Dynamic HIL Forms** | The `FormRenderer` UI component queries the latest schema snapshots to dynamically populate select dropdowns, ensuring humans select valid external system options. |
| **Workflow Flexibility** | Eliminates the need to build "Work-Type" schemas (Epic, Story, Bug) natively; the system simply learns them from the integration endpoint. |

---

## Architecture

### System Flow

1. **Synchronization Start**
   - Integration worker begins sync (`saas-sync.service.ts`).
   - Fetches the comprehensive field dictionary via API (e.g., JIRA's `client.getFields()`).
   
2. **Drift Detection & Snapshotting**
   - The `hasSchemaDrift` utility hashes the incoming fields (`id, name, type, schema`) against the most recent record in `saas_schema_snapshots`.
   - If drift is detected, a new snapshot version is committed to the database.

3. **Agent Mission Context**
   - When `mission-strategic-planner.service.ts` spins up a new agent, it pulls the latest schema snapshot for the linked organization.
   - Generates an `EXTERNAL SAAS SCHEMAS` string block mapping custom field names to API-usable IDs.
   - The Agent's system prompt is injected with this block, resolving any LLM hallucination risks regarding field locations.

4. **Human-In-The-Loop (HIL) Feedback**
   - An agent requests missing information (e.g., "Estimate" or "Priority") via an HIL form.
   - The HIL form defines a `source: "jira:priority"` or `source: "jira:customfield_X"`.
   - The frontend `FormRenderer.tsx` detects the SaaS reference, hits `/api/saas/connectors/:platform/schema-snapshots`, and unpacks the `allowedValues` to render an interactive dropdown instead of a blank text input.

---

## Security & Reliability

- **No Stale Data**: UI and Agents are heavily reliant on the `saas_schema_snapshots` table, which is updated whenever the integration cron runs.
- **No Hallucination**: AI Agents don't guess API field structures; they are explicitly told via Context Injection.

---

## Files

| File | Purpose |
|---|---|
| `server/domain/integrations/saas-sync.service.ts` | Sync execution, field fetching, and drift detection logic. |
| `shared/schema/integrations.ts` | Database schema for `saas_schema_snapshots`. |
| `server/domain/mission/core/mission-strategic-planner.service.ts` | Injects the parsed SaaS schema map into the Agent's system prompt. |
| `server/domain/core/ui/components/shared/FormRenderer.tsx` | UI component that fetches and parses snapshot options dynamically for HIL forms. |
| `server/domain/apps/ui/components/approvals/ApprovalDetailDialog.tsx` | Passes SaaS `source` data to the FormRenderer. |
| `server/routes/saas/sync.ts` | API endpoint for retrieving SaaS snapshots for the UI. |
