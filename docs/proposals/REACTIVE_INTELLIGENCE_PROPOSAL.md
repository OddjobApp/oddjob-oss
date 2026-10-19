# Proposal: Reactive Intelligence Engine & Change Management

## Overview
This proposal outlines the implementation of a comprehensive **Change Detection and Response System** within the Oddjob platform. This upgrade transitions Oddjob from a purely scheduled/manual task runner to a **Reactive Intelligence Engine**. It enables the system to detect semantic changes in data (Diffing), evaluate them against baselines (Snapshots), and trigger sophisticated, governed responses (Event Bus + Suppression) with human oversight (Diff UI).

---

## 1. Core Components

### A. Diffing Service (The "Change Detector")
A stateless service that computes semantic differences between two JSON objects or text blobs.
*   **Functionality**:
    *   Accepts `CurrentState` and `BaselineState`.
    *   Produces `DiffResult`: A structured object containing added, removed, and modified fields.
    *   Key Logic: Supports "Semantic Diffing" (ignoring noise fields like `timestamp` or `_generatedAt` via configuration).
*   **Implementation**: `server/services/diff-service.ts` ✅ IMPLEMENTED

### B. State Snapshotting (The "Memory")
A mechanism to "Pin" a specific job output or knowledge node state as the "Golden Record". This replaces the flaky "compare vs last run" logic.
*   **Use Cases**: Compliance Baselines, Approved Configurations, "Last Known Good" states.
*   **Implementation**: `shared/schema/knowledge.ts` (snapshots table) ✅ IMPLEMENTED

### C. Reactive Event Bus (The "Nervous System")
A standardized messaging layer that decouples detection from action.
*   **Protocol**: Adopts **CloudEvents 1.0** standard for event payloads.
*   **Flow**: `Job (Detector)` -> `Diff Service` -> `Event Bus` -> `Trigger Router` -> `Pipeline (Reactor)`.
*   **Implementation**: `server/services/event-bus.ts` ✅ IMPLEMENTED

### D. Suppression Engine (The "Filter")
Logic to prevent "Alert Storms" when massive changes occur.
*   **Capabilities**: Deduping windows, batching events, and global quiet hours.
*   **Implementation**: Built into Event Bus via `debounceWindow` and `batchSize` ✅ IMPLEMENTED

### E. CEL Extensions (The "Brainpower")
Extended expression language functions for powerful conditional logic.
*   **Text Functions**: `contains`, `matches` (regex), `lower`, `upper`, `trim`, `startsWith`, `endsWith`
*   **Diff Functions**: `hasChange`, `value`, `oldValue`, `percentageChange`
*   **List Functions**: `size`, `contains`, `any`, `all`, `filter`, `sum`, `avg`
*   **Implementation**: `server/services/cel-extensions.ts` ✅ IMPLEMENTED

---

## 2. Database Schema Changes

### New Table: `snapshots`
Stores baseline versions of job outputs or entity states.
```typescript
export const snapshots = pgTable("snapshots", {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(), // 'job_output', 'knowledge_node', 'pipeline_step'
    entityId: integer("entity_id").notNull(),
    jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    hash: text("hash").notNull(),
    label: text("label"),
    description: text("description"),
    isPrimary: boolean("is_primary").default(false),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### New Table: `event_log`
Stores the emitted CloudEvents for auditing and replay.
```typescript
export const eventLog = pgTable("event_log", {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull().unique(),
    type: text("type").notNull(),
    source: text("source").notNull(),
    subject: text("subject"),
    payload: jsonb("payload").notNull(),
    organizationId: integer("organization_id").references(() => orgs.id),
    emittedAt: timestamp("emitted_at").defaultNow().notNull(),
});
```

### Table Updates: `pipeline_triggers`
Enhanced triggers to support CloudEvent filtering and suppression.
```typescript
export const pipelineTriggers = pgTable("pipeline_triggers", {
    // ... existing fields ...
    filterCondition: text("filter_condition"), // CEL: "event.data.diff.hasChanges && diff.percentageChange('price') > 10"
    debounceWindow: integer("debounce_window").default(0), // Seconds (0 = immediate)
    batchSize: integer("batch_size").default(1), // Max events to bundle
});
```

**Migration File**: `migrations/0009_reactive_intelligence.sql` ✅ CREATED

---

## 3. Business Logic & API Changes

### A. CEL Environment Extension (`cel-extensions.ts`)
Registered standard string, diff, and list utilities for Decision/Trigger conditions.

**Text Functions**:
| Function | Description | Example |
|---|---|---|
| `text.contains(str, search)` | Check substring | `text.contains(output.body, "error")` |
| `text.matches(str, regex)` | Regex test | `text.matches(email, "^.*@company.com$")` |
| `text.lower(str)` | Lowercase | `text.lower(status) == "critical"` |
| `text.startsWith(str, prefix)` | Prefix check | `text.startsWith(code, "ERR")` |
| `text.len(str)` | String length | `text.len(summary) > 100` |

**Diff Functions**:
| Function | Description | Example |
|---|---|---|
| `diff.hasChange(path)` | Path changed | `diff.hasChange("price")` |
| `diff.value(path)` | New value | `diff.value("status") == "closed"` |
| `diff.oldValue(path)` | Previous value | `diff.oldValue("status") == "open"` |
| `diff.percentageChange(path)` | Numeric change % | `diff.percentageChange("price") > 10` |
| `diff.changeCount()` | Total changes | `diff.changeCount() > 5` |

**List Functions**:
| Function | Description | Example |
|---|---|---|
| `list.size(arr)` | Array length | `list.size(items) > 0` |
| `list.any(arr, prop, val)` | Any match | `list.any(errors, "severity", "critical")` |
| `list.sum(arr)` | Sum numbers | `list.sum(prices)` |

### B. Pipeline Step Runner Integration (TODO)
*   **Post-Execution Logic**:
    *   If Job has `comparisonMode: 'snapshot'`: Fetch the `isPrimary` snapshot for this job.
    *   If Job has `comparisonMode: 'auto'`: Fetch the `last_successful` run.
    *   **Action**: Compute Diff -> Inject `{{step.X.diff}}` into context -> Emit Event (if configured).

### C. Backend API Endpoints (TODO)
*   `POST /api/snapshots`: Create a snapshot from a specific run ID.
*   `GET /api/snapshots/:entityId?type=job_output`: List snapshots for an entity.
*   `PATCH /api/snapshots/:id/primary`: Set a snapshot as the primary baseline.
*   `POST /api/diff/preview`: Ad-hoc diff between two states (for UI preview).

---

## 4. UI Requirements (TODO)

### A. Job Configuration (Frontend)
*   **"Change Detection" Tab** in Job Detail:
    *   Toggle: "Enable Diffing".
    *   Mode Selector: "Compare against Last Run" vs "Compare against Snapshot".
    *   "Ignore Fields": Tag input for JSON paths to exclude (e.g., `lastUpdated`, `timestamp`).

### B. Run Detail View
*   **"Changes" Tab**:
    *   Side-by-Side or Unified Diff visualizer (use `react-diff-viewer` or similar).
    *   Highlight: Green for additions, Red for removals, Yellow for modifications.
    *   Summary bar: "3 added, 1 removed, 5 modified".

### C. Snapshot Manager
*   **New Page**: `/settings/snapshots` or integrated into Knowledge Store.
*   List view of all snapshots with filtering by entity type.
*   Actions: "View Data", "Set as Primary", "Delete".
*   "Create Snapshot" button in Run Detail view.

### D. Trigger Configuration
*   **Enhanced Trigger Form**:
    *   "Debounce Window" number input (seconds).
    *   "Batch Size" number input.
    *   Tooltip explaining suppression behavior.

---

## 5. Implementation Status

| Component | Status | File |
|---|---|---|
| Diff Service | ✅ Complete | `server/services/diff-service.ts` |
| CEL Extensions | ✅ Complete | `server/services/cel-extensions.ts` |
| Event Bus | ✅ Complete | `server/services/event-bus.ts` |
| Snapshots Schema | ✅ Complete | `shared/schema/knowledge.ts` |
| Event Log Schema | ✅ Complete | `shared/schema/knowledge.ts` |
| Trigger Debouncing | ✅ Complete | `schema.ts` |
| Migration | ✅ Applied | `migrations/0009_reactive_intelligence.sql` |
| Step Runner Integration | ✅ Complete | `server/pipeline-step-runner.ts` |
| API Endpoints | ✅ Complete | `server/routes.ts` |
| Diff Viewer UI | ✅ Complete | `client/src/components/DiffViewer.tsx` |
| Step Diff Viewer | ✅ Complete | `client/src/components/StepDiffViewer.tsx` |
| Snapshot Manager UI | ✅ Complete | `client/src/pages/SnapshotManager.tsx` |
| Execution Detail Integration | ✅ Complete | `client/src/pages/PipelineExecutionDetail.tsx` |
| Job Config UI | 🔲 TODO | `client/src/pages/JobDetail.tsx` |

---

## 6. How to Use

### Viewing Changes in Pipeline Executions
1.  Navigate to a Pipeline's Execution History
2.  Click on a specific execution to view details
3.  For each successful step, click the **"View Changes"** button
4.  The diff dialog shows what changed compared to the previous run

### Managing Snapshots
1.  Navigate to **Administration > Snapshots** in the sidebar
2.  View all baseline snapshots across the system
3.  Filter by entity type (Job Output, Knowledge Node, Pipeline Step)
4.  Set a snapshot as "Primary" to use it as the comparison baseline
5.  Delete outdated snapshots

### Creating Snapshots via API
```bash
POST /api/snapshots
{
  "entityType": "job_output",
  "entityId": 123,
  "jobId": 456,
  "data": { "price": 99.99, "status": "active" },
  "label": "Q1 Baseline",
  "isPrimary": true
}
```

---

## 7. Example Usage

### Competitive Intelligence Pipeline
```
[Scraper Job] -> outputs competitor pricing JSON
        |
        v
[Diff Service] -- computes diff vs. last run --
        |
        v (if diff.hasChange("price"))
[Event Bus] -- emits "competitor.price_changed" --
        |
        v (trigger fires with 60s debounce)
[Reactor Pipeline] -- "Notify Sales Team" --
```

### CEL Condition Examples
```javascript
// Only fire if price dropped by more than 10%
diff.hasChange("price") && diff.percentageChange("price") < -10

// Fire if any critical error appeared
list.any(event.data.errors, "severity", "critical")

// Fire if summary contains "outage" (case-insensitive)
text.containsIgnoreCase(event.data.summary, "outage")
```
