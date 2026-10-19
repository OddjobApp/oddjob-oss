# Proposal: Reactive Intelligence Phase 2

## Overview
This document outlines the implementation plan for completing the Reactive Intelligence feature set. It covers two main areas:
1. **Job Config UI** - Per-job diffing configuration
2. **Enhanced Reactive UX** - Event Log Viewer, Trigger Builder, and workflow integrations

---

## Part 1: Job Config UI

### 1.1 Objective
Allow users to configure diffing behavior **per-job** directly in the Job Detail page. This enables fine-grained control over:
- Whether diffing is enabled for the job
- Which fields to ignore during comparison
- Which snapshot to use as the baseline

### 1.2 Schema Changes

Add new columns to the `jobs` table:

```typescript
// In schema.ts - jobs table
export const jobs = pgTable("jobs", {
  // ... existing columns ...
  
  // Diffing Configuration
  diffingEnabled: boolean("diffing_enabled").default(true),
  diffIgnorePaths: text("diff_ignore_paths").array(), // e.g., ["timestamp", "updatedAt", "_meta"]
  diffBaselineMode: text("diff_baseline_mode").default("last_run"), // "last_run" | "primary_snapshot" | "disabled"
  diffThresholdPercent: integer("diff_threshold_percent"), // Only emit event if change > X%
});
```

**Migration:**
```sql
ALTER TABLE jobs 
  ADD COLUMN diffing_enabled BOOLEAN DEFAULT true,
  ADD COLUMN diff_ignore_paths TEXT[],
  ADD COLUMN diff_baseline_mode TEXT DEFAULT 'last_run',
  ADD COLUMN diff_threshold_percent INTEGER;
```

### 1.3 UI Components

#### A. Diffing Settings Card
Location: `client/src/pages/JobDetail.tsx` (new tab or section)

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔄 Change Detection Settings                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Enable Diffing                                                 │
│  ┌──────┐                                                       │
│  │  ✓   │  Compare outputs between runs                        │
│  └──────┘                                                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Baseline Mode                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Compare against last successful run              ▼     │    │
│  └────────────────────────────────────────────────────────┘    │
│  Options:                                                       │
│  • Compare against last successful run (default)                │
│  • Compare against primary snapshot                             │
│  • Disabled                                                     │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Ignore Paths                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ timestamp  ✕ │ updatedAt  ✕ │ _generatedAt  ✕ │  +    │    │
│  └────────────────────────────────────────────────────────┘    │
│  Fields at these paths will be excluded from comparison.       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Significance Threshold                                         │
│  ┌──────────────┐                                              │
│  │ 5%         ▲ │  Only trigger events if total change > 5%   │
│  └──────────────┘                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### B. Implementation Files

| File | Changes |
|------|---------|
| `client/src/pages/JobDetail.tsx` | Add "Change Detection" tab/section |
| `client/src/components/DiffSettingsForm.tsx` | New component for diffing config |
| `server/routes.ts` | Update job PATCH endpoint to handle new fields |
| `server/pipeline-step-runner.ts` | Read job config before computing diff |

### 1.4 API Changes

**GET /api/jobs/:id** - Returns new fields:
```json
{
  "id": 123,
  "name": "Price Monitor",
  "diffingEnabled": true,
  "diffIgnorePaths": ["timestamp", "lastChecked"],
  "diffBaselineMode": "last_run",
  "diffThresholdPercent": 5
}
```

**PATCH /api/jobs/:id** - Accepts new fields:
```json
{
  "diffingEnabled": true,
  "diffIgnorePaths": ["timestamp", "lastChecked"],
  "diffBaselineMode": "primary_snapshot",
  "diffThresholdPercent": 10
}
```

### 1.5 Step Runner Integration

Update `server/pipeline-step-runner.ts` to respect job config:

```typescript
// After job execution
if (job.diffingEnabled !== false && job.diffBaselineMode !== 'disabled') {
  const diffConfig = {
    ignorePaths: [
      ...(job.diffIgnorePaths || []),
      'timestamp', 'createdAt', 'updatedAt', '_generatedAt' // defaults
    ],
    thresholdPercent: job.diffThresholdPercent
  };
  
  const baseline = job.diffBaselineMode === 'primary_snapshot'
    ? await getPrimarySnapshot(job.id)
    : await getLastSuccessfulOutput(job.id);
    
  const diff = computeDiff(baseline, currentOutput, diffConfig);
  
  // Only emit if above threshold
  if (diff.hasChanges && (!diffConfig.thresholdPercent || diff.significancePercent > diffConfig.thresholdPercent)) {
    await emitDiffEvent(diff, job, pipeline);
  }
}
```

---

## Part 2: Enhanced Reactive UX

### 2.1 Event Log Viewer

#### Objective
Provide visibility into all events emitted by the system for debugging, auditing, and compliance.

#### UI Design
Location: New page at `/admin/events` or `/monitoring/events`

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 📋 Event Log                                                         [Refresh]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Filters:  Type: [All ▼]  Status: [All ▼]  Date: [Last 7 days ▼]  [Search...] │
│                                                                                 │
│  ───────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│  │ Type        │ Source         │ Status    │ Triggers │ Timestamp            │
│  ├─────────────┼────────────────┼───────────┼──────────┼──────────────────────┤
│  │ job.changed │ Price Monitor  │ Processed │ 2        │ Dec 24, 2024 3:45 PM │
│  │ job.changed │ Stock Checker  │ Debounced │ 0        │ Dec 24, 2024 3:40 PM │
│  │ job.failed  │ API Fetcher    │ Processed │ 1        │ Dec 24, 2024 3:35 PM │
│  │ job.changed │ Price Monitor  │ Processed │ 2        │ Dec 24, 2024 3:30 PM │
│                                                                                 │
│  Click row to expand:                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ Event ID: evt_abc123                                                    │   │
│  │ CloudEvents Type: ai.oddjob.job.changed                                 │   │
│  │                                                                         │   │
│  │ Payload:                                                                │   │
│  │ {                                                                       │   │
│  │   "jobId": 123,                                                         │   │
│  │   "jobName": "Price Monitor",                                           │   │
│  │   "diff": { "hasChanges": true, "changeCount": 3 },                     │   │
│  │   "changedPaths": ["/price", "/stock", "/availability"]                 │   │
│  │ }                                                                       │   │
│  │                                                                         │   │
│  │ Triggered Pipelines:                                                    │   │
│  │  • Alert Pipeline (#45) - Completed                                     │   │
│  │  • Notification Service (#67) - Running                                 │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  [< Previous]                     Page 1 of 12                    [Next >]     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Implementation

| File | Description |
|------|-------------|
| `client/src/pages/EventLog.tsx` | New page component |
| `client/src/App.tsx` | Add route `/admin/events` |
| `client/src/components/Layout.tsx` | Add nav link under Administration |
| `server/routes.ts` | Add `GET /api/events` with filtering |

#### API Endpoint

```typescript
GET /api/events?type=job.changed&status=processed&from=2024-12-01&limit=50

Response:
{
  "events": [
    {
      "id": 1,
      "eventId": "evt_abc123",
      "eventType": "job.changed",
      "source": "job:123",
      "subject": "Price Monitor",
      "data": { ... },
      "status": "processed",
      "triggeredPipelines": [45, 67],
      "createdAt": "2024-12-24T15:45:00Z"
    }
  ],
  "total": 1234,
  "page": 1,
  "limit": 50
}
```

---

### 2.2 Trigger Builder UI

#### Objective
Visual editor for creating event-triggered pipelines without writing code.

#### UI Design
Location: Pipeline Detail page > Triggers tab (enhanced)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ⚡ Pipeline Triggers                                            [+ New Trigger] │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Trigger 1: Price Change Alert                                    [Edit] [🗑]  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ WHEN                                                                    │   │
│  │ Event Type: [job.changed ▼]                                             │   │
│  │ Source Job: [Price Monitor ▼]                                           │   │
│  │                                                                         │   │
│  │ IF (conditions)                                                         │   │
│  │ ┌─────────────────────────────────────────────────────────────────┐    │   │
│  │ │ diff.hasChange("price") AND diff.percentageChange("price") > 10 │    │   │
│  │ └─────────────────────────────────────────────────────────────────┘    │   │
│  │                [Condition Builder...]                                   │   │
│  │                                                                         │   │
│  │ THEN                                                                    │   │
│  │ Execute Pipeline with variables:                                        │   │
│  │  • alert_type = "price_spike"                                          │   │
│  │  • old_price = ${event.diff.oldValue.price}                            │   │
│  │  • new_price = ${event.diff.value.price}                               │   │
│  │                                                                         │   │
│  │ SUPPRESSION                                                             │   │
│  │ Debounce: [5 minutes ▼]    Batch Size: [10 ▼]                         │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  Trigger 2: Error Notification                                    [Edit] [🗑]  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ WHEN event.type == "job.failed"                                         │   │
│  │ THEN send Slack notification                                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Schema Updates

The `pipeline_triggers` table already has `eventType`, `filterCondition`, `debounceWindow`, `batchSize`. Add:

```sql
ALTER TABLE pipeline_triggers
  ADD COLUMN source_job_id INTEGER REFERENCES jobs(id),
  ADD COLUMN inject_variables JSONB DEFAULT '{}',
  ADD COLUMN description TEXT;
```

#### Implementation

| File | Description |
|------|-------------|
| `client/src/components/TriggerBuilder.tsx` | New visual trigger editor |
| `client/src/components/ConditionBuilderModal.tsx` | Modal for building filter conditions |
| `server/routes.ts` | Update trigger CRUD to handle new fields |

---

### 2.3 Diff in Human Approval Tasks

#### Objective
Show what changed when a user is asked to approve a pipeline step, helping them make informed decisions.

#### UI Design
Location: External Task Page (`/external/task/:traceId`)

Add a collapsible "Changes" section to the approval form:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Human Review Required                                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Pipeline: Competitive Intelligence                                             │
│  Step: Price Comparison Analysis                                                │
│                                                                                 │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  📊 Changes Detected                                               [Collapse]  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Summary: 3 added, 0 removed, 2 modified                                │   │
│  │                                                                         │   │
│  │  + /products/0/price          $99.99                                   │   │
│  │  + /products/0/competitor     "AcmeCorp"                               │   │
│  │  + /products/0/sourceUrl      "https://..."                            │   │
│  │  ~ /summary/totalProducts     5 → 8                                    │   │
│  │  ~ /summary/avgPrice          $85.00 → $92.50                          │   │
│  │                                                                         │   │
│  │  [View Side-by-Side] [View Raw Diff]                                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  Output to Review:                                                              │
│  [Current output JSON displayed here...]                                        │
│                                                                                 │
│  ─────────────────────────────────────────────────────────────────────────────  │
│                                                                                 │
│  Decision:                                                                      │
│  [  Approve  ]    [  Reject  ]    [  Request Changes  ]                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Implementation

| File | Description |
|------|-------------|
| `client/src/pages/ExternalTaskPage.tsx` | Import and add DiffViewer component |
| `server/routes.ts` | Include diff in task details response |
| `server/pipeline-step-runner.ts` | Store diff with HIL task |

---

### 2.4 Snapshot from Run Detail

#### Objective
Allow users to create a snapshot directly from a completed pipeline execution, making it easy to establish baselines.

#### UI Design
Location: Pipeline Execution Detail page

Add a button to each successful step:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: Price Extraction                                          │
│  Status: ✅ Success                                                 │
│                                                                     │
│  Output:                                                            │
│  { "price": 99.99, "currency": "USD", "lastUpdated": "..." }       │
│                                                                     │
│  [View Job Log]  [View Changes]  [📷 Create Snapshot]              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Clicking "Create Snapshot" opens a modal:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📷 Create Snapshot                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Label                                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Q4 2024 Baseline                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Description (optional)                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Approved pricing baseline for Q4 competitive analysis      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ☐ Set as Primary Baseline                                         │
│    Future comparisons will use this snapshot                        │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  [Cancel]                                            [Create]       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Implementation

| File | Description |
|------|-------------|
| `client/src/components/CreateSnapshotModal.tsx` | New modal component |
| `client/src/pages/PipelineExecutionDetail.tsx` | Add button and modal trigger |
| `server/routes.ts` | Reuse existing POST `/api/snapshots` |

---

## Implementation Roadmap

### Phase 2A: Job Config UI (Priority: Medium)
- **Effort:** 4-6 hours
- **Files:** 4 new/modified
- **Dependencies:** None

### Phase 2B: Event Log Viewer (Priority: High)
- **Effort:** 3-4 hours
- **Files:** 3 new
- **Dependencies:** None

### Phase 2C: Snapshot from Run Detail (Priority: High)
- **Effort:** 2-3 hours
- **Files:** 2 modified + 1 new component
- **Dependencies:** None

### Phase 2D: Diff in Human Approval (Priority: Medium)
- **Effort:** 2-3 hours
- **Files:** 2 modified
- **Dependencies:** Step Runner already computes diff

### Phase 2E: Trigger Builder UI (Priority: Low)
- **Effort:** 6-8 hours
- **Files:** 3 new components
- **Dependencies:** Schema update for triggers

---

## Part 3: Optional Enhancements

### 3.1 Diff History Timeline

#### Objective
Show a timeline of all changes for a specific job or entity over time, enabling trend analysis.

#### UI Design
Location: Job Detail page > "History" tab

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 📈 Change History: Price Monitor                                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Time Range: [Last 30 days ▼]         Group By: [Day ▼]       [Export CSV]     │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │     ▲                                                                    │  │
│  │  15 │      ●                                     ●                       │  │
│  │     │     ╱╲                                   ╱ ╲                       │  │
│  │  10 │    ╱  ╲           ●       ●             ╱   ╲                      │  │
│  │     │   ╱    ╲         ╱ ╲    ╱ ╲           ╱     ╲      ●              │  │
│  │   5 │  ╱      ╲       ╱   ╲  ╱   ╲         ╱       ╲    ╱               │  │
│  │     │ ╱        ╲     ╱     ╲╱     ╲       ╱         ╲  ╱                │  │
│  │   0 ├──────────────────────────────────────────────────────▶            │  │
│  │       Dec 1   Dec 5   Dec 10  Dec 15   Dec 20   Dec 24                  │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  Changes by Field:                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │ /price          ████████████████████████████████████  45 changes         │  │
│  │ /stock          ████████████████████████             32 changes          │  │
│  │ /availability   █████████████████                    23 changes          │  │
│  │ /lastUpdated    ████████████████████████████████████████████  (ignored)  │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  Recent Changes:                                                                │
│  │ Dec 24, 3:45 PM │ 3 fields │ +2 -0 ~1 │ [View Diff]                        │
│  │ Dec 24, 2:30 PM │ 1 field  │ +0 -0 ~1 │ [View Diff]                        │
│  │ Dec 24, 1:15 PM │ 5 fields │ +3 -1 ~1 │ [View Diff]                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Implementation

| File | Description |
|------|-------------|
| `client/src/components/DiffHistoryTimeline.tsx` | Chart component using Recharts |
| `client/src/pages/JobDetail.tsx` | Add "History" tab |
| `server/routes.ts` | Add `GET /api/jobs/:id/diff-history` |

**Effort:** 4-5 hours

---

### 3.2 Snapshot Comparison Tool

#### Objective
Allow users to compare any two snapshots side-by-side, not just current vs. baseline.

#### UI Design
Location: Snapshot Manager page or dedicated `/compare` page

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 🔍 Compare Snapshots                                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Baseline                                      Current                           │
│  ┌────────────────────────────┐               ┌────────────────────────────┐   │
│  │ Q3 2024 Baseline     ▼    │               │ Q4 2024 Baseline     ▼    │   │
│  └────────────────────────────┘               └────────────────────────────┘   │
│                                                                                 │
│  [Compare]                                                                      │
│                                                                                 │
│  ───────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│  Summary: 12 added, 3 removed, 45 modified                                      │
│                                                                                 │
│  ┌──────────────────────────────┬──────────────────────────────┐               │
│  │ Q3 2024 Baseline             │ Q4 2024 Baseline             │               │
│  ├──────────────────────────────┼──────────────────────────────┤               │
│  │ {                            │ {                            │               │
│  │   "products": [              │   "products": [              │               │
│  │     {                        │     {                        │               │
│  │       "name": "Widget A",    │       "name": "Widget A",    │               │
│  │ -     "price": 89.99,        │ +     "price": 99.99,        │               │
│  │       "stock": 150           │       "stock": 150           │               │
│  │     }                        │     }                        │               │
│  │   ]                          │   ]                          │               │
│  │ }                            │ }                            │               │
│  └──────────────────────────────┴──────────────────────────────┘               │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Implementation

| File | Description |
|------|-------------|
| `client/src/pages/SnapshotCompare.tsx` | New comparison page |
| `client/src/App.tsx` | Add route `/snapshots/compare` |
| `server/routes.ts` | Add `POST /api/snapshots/compare` |

**Effort:** 3-4 hours

---

### 3.3 Webhook Integration for Events

#### Objective
Allow users to configure webhooks that are called when specific events occur, enabling integration with external systems.

#### UI Design
Location: Settings > Integrations

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 🔗 Webhook Integrations                                          [+ Add Webhook]│
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  Webhook 1: Slack Alerts                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ URL: https://hooks.slack.com/services/...                               │   │
│  │ Events: job.changed, job.failed                                         │   │
│  │ Status: ✅ Active    Last called: 2 minutes ago    [Test] [Edit] [🗑]  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  Webhook 2: PagerDuty                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ URL: https://events.pagerduty.com/v2/...                                │   │
│  │ Events: job.failed (when error contains "CRITICAL")                     │   │
│  │ Status: ✅ Active    Last called: 1 hour ago       [Test] [Edit] [🗑]  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  Webhook 3: Custom Analytics                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ URL: https://analytics.mycompany.com/ingest                             │   │
│  │ Events: job.changed (all)                                               │   │
│  │ Status: ⚠️ Failing   Last error: 403 Forbidden    [Test] [Edit] [🗑]  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Schema

```sql
CREATE TABLE webhooks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT, -- For HMAC signing
  event_types TEXT[] DEFAULT '{}',
  filter_condition TEXT, -- CEL expression
  headers JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_called_at TIMESTAMP,
  last_status INTEGER,
  organization_id INTEGER REFERENCES orgs(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Implementation

| File | Description |
|------|-------------|
| `shared/schema/webhooks.ts` | New schema file |
| `client/src/pages/WebhookSettings.tsx` | Webhook management page |
| `server/services/webhook-service.ts` | Webhook delivery logic |
| `server/services/event-bus.ts` | Add webhook dispatch |

**Effort:** 6-8 hours

---

### 3.4 Change Alerts & Notifications

#### Objective
Allow users to subscribe to change notifications via email, Slack, or in-app alerts.

#### UI Design
Location: User Profile > Notification Preferences

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 🔔 Notification Preferences                                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  📧 Email Notifications                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ Job failures                                        [Immediate]       │   │
│  │ ☑ Significant changes (>10%)                          [Daily digest]    │   │
│  │ ☐ All job completions                                 [Disabled]        │   │
│  │ ☑ Human approval requests                             [Immediate]       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  🔔 In-App Notifications                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ Show notification bell for pending approvals                          │   │
│  │ ☑ Toast notifications for job failures                                  │   │
│  │ ☐ Toast notifications for significant changes                           │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  🎯 Watch Specific Jobs                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ Price Monitor          [🔔 All Changes]                                 │   │
│  │ Competitor Tracker     [📊 >5% Changes Only]                            │   │
│  │ Stock Checker          [❌ Failures Only]                               │   │
│  │                                             [+ Watch Another Job]       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  [Save Preferences]                                                             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Implementation

| File | Description |
|------|-------------|
| `shared/schema/notifications.ts` | Notification preferences schema |
| `client/src/components/NotificationBell.tsx` | Header notification indicator |
| `client/src/pages/NotificationPreferences.tsx` | Settings page |
| `server/services/notification-service.ts` | Email/in-app dispatch |

**Effort:** 8-10 hours

---

### 3.5 Rollback to Snapshot

#### Objective
Allow users to "restore" a previous snapshot as the current expected output, useful for reverting unwanted changes.

#### UI Design
Location: Snapshot Manager, or from Diff Viewer

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ Confirm Rollback                                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  You are about to set the following snapshot as the     │
│  PRIMARY BASELINE for Job: "Price Monitor"              │
│                                                         │
│  Snapshot: Q3 2024 Baseline                             │
│  Created: Sep 30, 2024 at 11:59 PM                      │
│  Created By: admin@example.com                          │
│                                                         │
│  This means:                                            │
│  • Future diffs will compare against this snapshot      │
│  • Any "expected" values in alerts will use this data   │
│  • The current output will show as "changed"            │
│                                                         │
│  [Cancel]                    [Set as Primary Baseline]  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Implementation

This is mostly UI - the backend already supports setting primary snapshots via `PATCH /api/snapshots/:id/primary`.

| File | Description |
|------|-------------|
| `client/src/components/RollbackConfirmModal.tsx` | Confirmation dialog |
| `client/src/pages/SnapshotManager.tsx` | Add "Rollback" action |

**Effort:** 1-2 hours

---

### 3.6 Diff Annotations & Comments

#### Objective
Allow users to add comments to specific changes, useful for documentation and audit trails.

#### UI Design
In the Diff Viewer:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  + /price          $99.99                                      [💬 Add Comment] │
│    ┌───────────────────────────────────────────────────────────────────────┐   │
│    │ 💬 John D. (Dec 24, 3:45 PM):                                         │   │
│    │ "This is expected - we raised prices for Q4 launch"                   │   │
│    │                                                         [Reply] [👍 2] │   │
│    └───────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ~ /stock          150 → 120                                   [💬 Add Comment] │
│    ┌───────────────────────────────────────────────────────────────────────┐   │
│    │ 💬 Jane S. (Dec 24, 3:50 PM):                                         │   │
│    │ "Need to investigate - this is unexpected depletion"                  │   │
│    │                                                         [Reply] [❗ Flag] │   │
│    └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Schema

```sql
CREATE TABLE diff_annotations (
  id SERIAL PRIMARY KEY,
  execution_id INTEGER REFERENCES pipeline_step_executions(id),
  change_path TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  is_flagged BOOLEAN DEFAULT false
);
```

#### Implementation

| File | Description |
|------|-------------|
| `shared/schema/annotations.ts` | New schema |
| `client/src/components/DiffAnnotation.tsx` | Comment component |
| `client/src/components/DiffViewer.tsx` | Add annotation support |
| `server/routes.ts` | CRUD for annotations |

**Effort:** 5-6 hours

---

## Complete Summary

### Core Features (Required)

| Feature | Effort | Priority | Status |
|---------|--------|----------|--------|
| Diff Service | - | - | ✅ Complete |
| CEL Extensions | - | - | ✅ Complete |
| Event Bus | - | - | ✅ Complete |
| Snapshot Schema | - | - | ✅ Complete |
| Step Runner Integration | - | - | ✅ Complete |
| API Endpoints | - | - | ✅ Complete |
| Diff Viewer UI | - | - | ✅ Complete |
| Snapshot Manager UI | - | - | ✅ Complete |
| Decision Node Enhancements | - | - | ✅ Complete |

### Phase 2 Features (Enhanced UX)

| Feature | Effort | Priority | Value |
|---------|--------|----------|-------|
| Event Log Viewer | 3-4h | 🔴 High | Debugging & compliance |
| Snapshot from Run | 2-3h | 🔴 High | Easy baseline creation |
| Job Config UI | 4-6h | 🟡 Medium | Fine-grained control |
| Diff in HIL Tasks | 2-3h | 🟡 Medium | Better approval UX |
| Trigger Builder | 6-8h | 🟢 Low | No-code trigger setup |

### Phase 3 Features (Optional Enhancements)

| Feature | Effort | Priority | Value |
|---------|--------|----------|-------|
| Diff History Timeline | 4-5h | 🟡 Medium | Trend analysis |
| Snapshot Comparison | 3-4h | 🟡 Medium | Flexible comparisons |
| Webhook Integration | 6-8h | 🟡 Medium | External integrations |
| Change Alerts | 8-10h | 🟢 Low | User notifications |
| Rollback to Snapshot | 1-2h | 🟢 Low | Easy revert |
| Diff Annotations | 5-6h | 🟢 Low | Documentation & audit |

---

## Recommended Implementation Order

1. **Event Log Viewer** (3-4h) - Critical for debugging
2. **Snapshot from Run Detail** (2-3h) - Quick win, high value
3. **Job Config UI** (4-6h) - Power user feature
4. **Diff History Timeline** (4-5h) - Analytics value
5. **Diff in HIL Tasks** (2-3h) - Better approvals
6. **Snapshot Comparison** (3-4h) - Flexibility
7. **Rollback to Snapshot** (1-2h) - Quick win
8. **Trigger Builder UI** (6-8h) - Complex but valuable
9. **Webhook Integration** (6-8h) - External connectivity
10. **Diff Annotations** (5-6h) - Collaboration
11. **Change Alerts** (8-10h) - Notifications system

**Total estimated effort:** ~50-65 hours for all features

---

*Created: December 24, 2024*
*Related: REACTIVE_INTELLIGENCE_PROPOSAL.md*

