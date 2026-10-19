# Job Type Enhancements

Comprehensive documentation for the 10 job type enhancements implemented in the Oddjob platform.

---

## Overview

These enhancements provide powerful capabilities for managing, monitoring, and optimizing jobs across the platform. Each enhancement addresses specific functional or UX gaps identified in the job system.

---

## 1. Request History & Replay 🔁

### Purpose
Store and replay job requests for debugging, testing, and auditing.

### Features
- **Automatic recording** of all job requests and responses
- **One-click replay** with optional parameter modifications
- **Request comparison** to identify changes over time
- **Statistics dashboard** showing success rates, response times, and trends
- **Dry-run capability** for safe testing

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs/:id/history` | Get request history for a job |
| GET | `/api/jobs/:id/history/stats` | Get request statistics |
| POST | `/api/jobs/:id/replay` | Replay a previous request |
| POST | `/api/jobs/:id/history/compare` | Compare two requests |

### Usage Example
```typescript
// Get last 50 requests
const history = await fetch(`/api/jobs/${jobId}/history?limit=50`).then(r => r.json());

// Replay with modifications
const replay = await fetch(`/api/jobs/${jobId}/replay`, {
    method: "POST",
    body: JSON.stringify({
        requestId: 123,
        modifyParams: { userId: "new-user-id" },
        dryRun: false
    })
}).then(r => r.json());
```

### Database Schema
```sql
CREATE TABLE job_request_history (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL,
    request_method TEXT,
    request_url TEXT,
    request_headers JSONB,
    request_body JSONB,
    response_status INTEGER,
    response_body JSONB,
    response_time_ms INTEGER,
    triggered_by TEXT,
    is_replayable INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 2. Live Output Streaming 📡

### Purpose
Real-time log streaming for long-running jobs via WebSocket/SSE.

### Features
- **Server-Sent Events (SSE)** for efficient streaming
- **Multiple log types**: stdout, stderr, system, AI responses
- **Progress tracking** with visual indicators
- **Chunk-based storage** for large outputs
- **Auto-cleanup** after job completion

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs/:id/stream` | SSE endpoint for live logs |
| GET | `/api/jobs/:id/runs` | Get active runs for a job |
| GET | `/api/jobs/:id/runs/:runId/logs` | Get logs for a specific run |

### Frontend Usage (React)
```typescript
const useJobStreaming = (jobId: number, jobRunId: number) => {
    const [logs, setLogs] = useState([]);
    
    useEffect(() => {
        const eventSource = new EventSource(
            `/api/jobs/${jobId}/stream?jobRunId=${jobRunId}`
        );
        
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "log") {
                setLogs(prev => [...prev, data]);
            }
            if (data.type === "complete") {
                eventSource.close();
            }
        };
        
        return () => eventSource.close();
    }, [jobId, jobRunId]);
    
    return logs;
};
```

---

## 3. Cost & Token Tracking 💰

### Purpose
Track AI token usage and calculate costs for budget management.

### Features
- **Per-request token counting** (input/output)
- **Cost calculation** for all major AI providers:
  - OpenAI (GPT-4, GPT-3.5, GPT-4 Turbo)
  - Gemini (Pro, Ultra)
  - Anthropic (Claude 3 Opus, Sonnet, Haiku)
- **Daily aggregation** for spend dashboards
- **Cost estimation** before execution
- **Organization-wide tracking**

### Pricing (per 1K tokens)
| Model | Input | Output |
|-------|-------|--------|
| gpt-4 | $0.03 | $0.06 |
| gpt-4-turbo | $0.01 | $0.03 |
| gpt-3.5-turbo | $0.0005 | $0.0015 |
| gemini-pro | $0.000125 | $0.000375 |
| claude-3-opus | $0.015 | $0.075 |
| claude-3-sonnet | $0.003 | $0.015 |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs/:id/tokens` | Get token usage for a job |
| GET | `/api/org/tokens` | Organization-wide usage |
| GET | `/api/tokens/pricing` | Get pricing information |
| POST | `/api/tokens/estimate` | Estimate cost for request |

### Usage Example
```typescript
// Get job token usage
const usage = await fetch(`/api/jobs/${jobId}/tokens?days=30`).then(r => r.json());
console.log(`Total cost: $${usage.totalCost}`);

// Estimate before running
const estimate = await fetch(`/api/tokens/estimate`, {
    method: "POST",
    body: JSON.stringify({
        model: "gpt-4",
        inputTokens: 2000,
        outputTokens: 500
    })
}).then(r => r.json());
console.log(`Estimated cost: $${estimate.totalCost}`);
```

---

## 4. Data Preview & Validation 👁️

### Purpose
Preview datasets and validate schema before processing.

### Features
- **Row preview** (first N rows with pagination)
- **Schema validation** with detailed error messages
- **Field statistics** (null rates, uniqueness, type checking)
- **Transformation preview** showing input → output mapping
- **Required field validation**

### Service Methods
```typescript
interface DataPreviewService {
    previewDataset(datasetId: number, options?: { limit?: number; offset?: number }): Promise<PreviewResult>;
    validateDataset(datasetId: number): Promise<ValidationResult>;
    previewJobOutput(jobId: number, datasetId: number): Promise<JobOutputPreview>;
    getDatasetStats(datasetId: number): Promise<DatasetStats>;
}
```

### Validation Result
```typescript
interface ValidationResult {
    isValid: boolean;
    errors: string[];      // Critical issues
    warnings: string[];    // Non-critical issues
    stats: {
        totalRows: number;
        validRows: number;
        invalidRows: number;
        missingFields: string[];
    };
}
```

---

## 5. Human Approval Enhancements 👥

### Purpose
Advanced HIL capabilities with escalation, delegation, and auto-approval.

### Features

#### Escalation Rules
- **Timeout-based**: Escalate if pending > X minutes
- **Business hours**: Escalate outside configured hours
- **Role-based**: Escalate to specific roles (admin, manager)
- **User-based**: Escalate to specific users

#### Auto-Approval
- **Pattern matching**: Learn from historical approvals
- **Similarity threshold**: Configurable confidence level (default: 90%)
- **Reliability scoring**: Track pattern trustworthiness

#### Delegation
- Transfer ownership to other users or roles
- Audit trail of all delegations

### Configuration
```typescript
interface HilJobConfig {
    escalationEnabled: boolean;
    escalationTimeoutMinutes: number;
    escalationRole: string;
    autoApprovalEnabled: boolean;
    similarityThreshold: number;  // 0-100
    businessHoursOnly: boolean;
    businessHoursStart: number; // 24h format
    businessHoursEnd: number;
}
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs/:id/hil/config` | Get HIL configuration |
| PUT | `/api/jobs/:id/hil/config` | Update HIL configuration |
| GET | `/api/jobs/:id/hil/analytics` | Get approval analytics |
| POST | `/api/approvals/:id/check-escalation` | Check if should escalate |
| POST | `/api/approvals/:id/escalate` | Manually escalate |
| POST | `/api/approvals/:id/check-auto-approval` | Check if can auto-approve |

---

## 6. Visual Job Builder 🎨

### Purpose
Node-based visual editor for composing multi-step jobs.

### Features
- **10 node types**: Trigger, Dataset, AI Agent, API, Filter, Transform, Merge, Split, Output
- **Drag-and-drop** interface
- **Visual connections** between nodes
- **Property panel** for configuration
- **Canvas** with grid background
- **Test and Save** actions

### Node Types
| Type | Icon | Color | Inputs | Outputs |
|------|------|-------|--------|---------|
| trigger | Play | Green | 0 | 1 |
| dataset | Database | Blue | 1 | 1 |
| ai_agent | Brain | Purple | 1 | 1 |
| api | Globe | Cyan | 1 | 1 |
| filter | Filter | Amber | 1 | 2 |
| transform | Settings | Indigo | 1 | 1 |
| merge | Merge | Pink | 2 | 1 |
| split | Split | Teal | 1 | 2 |
| output | CheckCircle | Green | 1 | 0 |

### Usage
> **Removed 2026-09-20.** `VisualJobBuilder` was written but never mounted — no route, no
> importer and no save path — so this example could not have worked. Pipelines are
> assembled step by step in the pipeline domain; there is no node editor.
typescript
const JOB_TYPE_CONFIG = {
    curl: {
        label: "HTTP Request",
        icon: "Globe",
        color: "#3b82f6",     // Blue
        bgColor: "#eff6ff",   // Light blue
        category: "integration"
    },
    ai_agent: {
        label: "AI Agent",
        icon: "Brain",
        color: "#8b5cf6",     // Purple
        bgColor: "#f5f3ff",   // Light purple
        category: "ai"
    },
    // ... more types
};
```

### Categories
| Category | Color Theme | Types |
|----------|-------------|-------|
| Integration | Blue/Cyan | curl, api, openapi, webhook |
| AI | Purple | ai_agent, ai_api_call |
| Data | Green | dataset, document |
| Automation | Gray/Indigo | shell, script, workflow |
| Human | Orange | human_approval |

### Usage
```typescript
import { getJobTypeConfig, getJobTypeIcon, getHealthScoreStyle } from "@domain/jobs/ui/job-type-config";

const config = getJobTypeConfig("ai_agent");
// { label: "AI Agent", icon: "Brain", color: "#8b5cf6", ... }

const Icon = getJobTypeIcon("ai_agent");
// Brain component from lucide-react

const healthStyle = getHealthScoreStyle(85);
// { color: "#84cc16", bg: "#ecfccb", label: "Good" }
```

---

## 8. Inline Test Panel 🧪

### Purpose
Side-by-side configuration and test results in the job editor.

### Features
- **Split view**: Config on left, results on right
- **Real-time execution**: Run tests without leaving editor
- **Response time display**: Shows execution duration
- **Output formatting**: JSON, text, table views
- **Error highlighting**: Clear error messages
- **One-click re-run**: Quick iteration

### UI Layout
```
┌────────────────────────────┬────────────────────────────┐
│     Configuration          │      Test Results          │
│                            │                            │
│  ┌─────────────────────┐   │  ┌─────────────────────┐   │
│  │ Job Type: AI Agent  │   │  │ ✅ Success          │   │
│  │ Model: GPT-4        │   │  │ Time: 1.2s          │   │
│  │ Prompt: [.......]   │   │  │                     │   │
│  │                     │   │  │ Output:             │   │
│  │ [Test Button]       │   │  │ {                   │   │
│  └─────────────────────┘   │  │   "result": "..."   │   │
│                            │  │ }                   │   │
│                            │  └─────────────────────┘   │
└────────────────────────────┴────────────────────────────┘
```

---

## 9. Job Health Score 💚💛❤️

### Purpose
Composite health metric for monitoring job reliability.

### Scoring Algorithm
```
healthScore = (
    successRate * 0.4 +
    avgResponseTimeScore * 0.2 +
    errorRateTrend * 0.2 +
    recencyScore * 0.2
)
```

### Components
| Component | Weight | Description |
|-----------|--------|-------------|
| Success Rate | 40% | % of successful runs (30 days) |
| Response Time | 20% | Speed score (faster = better) |
| Error Trend | 20% | Improving vs declining trend |
| Recency | 20% | Time since last successful run |

### Health Levels
| Score | Level | Color | Icon |
|-------|-------|-------|------|
| 90-100 | Excellent | Green #22c55e | CheckCircle |
| 75-89 | Good | Lime #84cc16 | CheckCircle |
| 60-74 | Fair | Yellow #eab308 | AlertTriangle |
| 40-59 | Poor | Orange #f97316 | AlertTriangle |
| 0-39 | Critical | Red #ef4444 | XCircle |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs/:id/health` | Get health score |
| GET | `/api/jobs/:id/health/trend` | Get trend over time |
| GET | `/api/org/health` | Organization summary |

### Usage Example
```typescript
const health = await fetch(`/api/jobs/${jobId}/health`).then(r => r.json());
console.log(`Health: ${health.overall}% (${health.status.label})`);
console.log(`Trend: ${health.successRate}% success rate`);
```

---

## 10. Quick Actions from Library ⚡

### Purpose
Fast job operations directly from the Agent Library grid.

### Features
- **Run button**: Immediate execution without opening editor
- **Test button**: Opens test panel in modal
- **Stats button**: Quick view of health, history, tokens
- **Health badge**: Color-coded score on each card
- **Quick preview**: Hover for basic info

### Job Card Layout
```
┌─────────────────────────────────────┐
│  🤖 AI Data Processor    [▶] [🧪]  │
│  Type: ai_agent | Health: 94% 💚   │
│  Last run: 2h ago | Cost: $12.50   │
│                                     │
│  [View] [Stats] [Duplicate] [🗑️]   │
└─────────────────────────────────────┘
```

---

## Database Migrations

### New Tables
1. `job_request_history` - Request/response storage
2. `ai_token_usage` - Per-request token tracking
3. `ai_token_daily_aggregation` - Daily spend rollups
4. `job_streaming_logs` - Real-time log chunks
5. `job_active_runs` - Currently running jobs
6. `hil_job_config` - HIL settings per job
7. `hil_approval_patterns` - Auto-approval patterns
8. `hil_escalation_log` - Escalation audit trail

### Migration Script
```sql
-- Run the schema files in order:
-- 1. shared/schema/jobs/request-history.ts
-- 2. shared/schema/jobs/token-tracking.ts
-- 3. shared/schema/jobs/streaming-logs.ts
-- 4. shared/schema/jobs/hil-enhancements.ts
```

---

## Integration Checklist

- [ ] Import new schema exports in `@shared/schema/jobs/index.ts`
- [ ] Add API routes in `@server/routes/job-enhancements.ts`
- [ ] Register routes in main server file
- [ ] Run database migrations
- [ ] Update UI components to use job type icons
- [ ] Add health score badges to job cards
- [ ] Enable inline test panels
- [ ] Configure HIL settings for approval jobs
- [ ] Set up token tracking for AI jobs

---

## Performance Considerations

- Request history: Auto-archive after 90 days
- Token tracking: Daily aggregation reduces query load
- Streaming logs: Auto-cleanup 1 minute after job completion
- Health scores: Cached for 5 minutes
- Pattern matching: Limited to top 100 historical approvals

---

## Security Notes

- All endpoints require authentication (`requireAuth`)
- Organization-scoped queries prevent data leakage
- Request bodies stored as JSONB (no sensitive data logging)
- HIL escalations logged for audit purposes
- Token usage tracked per-organization for billing

---

For questions or issues, refer to the service implementations in:
- `@domain/jobs/core/` - Backend services
- `@domain/jobs/ui/` - UI components and configuration
