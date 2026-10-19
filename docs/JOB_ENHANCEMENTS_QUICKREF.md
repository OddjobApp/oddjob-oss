# Job Enhancements Quick Reference

Quick reference for implementing and using the 10 job type enhancements.

---

## Installation

### 1. Database Migration

```bash
# Run the new schema files
psql -d oddjob < server/migrations/001_job_enhancements.sql
```

Or using drizzle:
```bash
npm run db:push
```

### 2. Register Routes

```typescript
// server/app.ts
import jobEnhancementsRouter from "./routes/job-enhancements.js";

app.use("/api", jobEnhancementsRouter);
```

### 3. Import Schema Exports

Already configured in `@shared/schema/jobs/index.ts`:
```typescript
// New exports added:
export * from "./request-history.js";
export * from "./token-tracking.js";
export * from "./streaming-logs.js";
export * from "./hil-enhancements.js";
```

---

## 1. Request History & Replay

### Record a Request
```typescript
import { requestHistoryService } from "@domain/jobs/core/request-history.service.js";

await requestHistoryService.recordRequest({
    jobId: 100,
    requestMethod: "POST",
    requestUrl: "https://api.example.com/test",
    requestBody: { name: "test" },
    responseStatus: 200,
    responseTimeMs: 150,
    triggeredBy: "manual",
    isReplayable: true,
});
```

### Replay a Request
```typescript
const result = await requestHistoryService.replayRequest(123, {
    modifyParams: { userId: "new-id" },
    dryRun: false,
});
```

### Frontend Hook
```typescript
const useRequestHistory = (jobId: number) => {
    const { data: history } = useQuery({
        queryKey: ["/api/jobs", jobId, "history"],
        queryFn: () => fetch(`/api/jobs/${jobId}/history`).then(r => r.json()),
    });
    
    const replay = useMutation({
        mutationFn: (requestId: number) =>
            fetch(`/api/jobs/${jobId}/replay`, {
                method: "POST",
                body: JSON.stringify({ requestId }),
            }).then(r => r.json()),
    });
    
    return { history, replay };
};
```

---

## 2. Live Output Streaming

### Stream Job Execution
```typescript
import { streamingLogsService } from "@domain/jobs/core/streaming-logs.service.js";

// Start job run
const { jobRunId, sseChannelId } = await streamingLogsService.startJobRun({
    jobId: 100,
    organizationId: 1,
    context: { missionId: 5 },
});

// Log messages
await streamingLogsService.log({
    jobId: 100,
    jobRunId,
    message: "Processing started",
    logLevel: "info",
});

// Stream AI chunks
await streamingLogsService.streamTextChunk(jobId, jobRunId, "Hello", false);
await streamingLogsService.streamTextChunk(jobId, jobRunId, " world!", true);

// Complete
await streamingLogsService.completeJobRun(jobId, jobRunId, "completed");
```

### Frontend SSE Hook
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

## 3. Cost & Token Tracking

### Record Token Usage
```typescript
import { tokenTrackingService } from "@domain/jobs/core/token-tracking.service.js";

await tokenTrackingService.recordUsage({
    jobId: 100,
    jobRunId: 1,
    modelProvider: "openai",
    modelName: "gpt-4",
    inputTokens: 2000,
    outputTokens: 500,
    latencyMs: 1200,
});
```

### Get Cost Estimate
```typescript
const estimate = tokenTrackingService.getCostEstimate("gpt-4", 2000, 500);
// { inputCost: 0.06, outputCost: 0.03, totalCost: 0.09 }
```

### Display Cost Component
```tsx
function TokenUsageDisplay({ jobId }: { jobId: number }) {
    const { data } = useQuery({
        queryKey: ["/api/jobs", jobId, "tokens"],
        queryFn: () => fetch(`/api/jobs/${jobId}/tokens`).then(r => r.json()),
    });
    
    if (!data?.totalCost) return null;
    
    return (
        <Badge variant="outline">
            ${data.totalCost.toFixed(2)} ({data.totalTokens.toLocaleString()} tokens)
        </Badge>
    );
}
```

---

## 4. Data Preview & Validation

### Preview Dataset
```typescript
import { dataPreviewService } from "@domain/jobs/core/data-preview.service.js";

const preview = await dataPreviewService.previewDataset(1, { limit: 10 });
// { rows: [...], columns: [...], totalCount: 1000 }
```

### Validate Dataset
```typescript
const validation = await dataPreviewService.validateDataset(1);
// { isValid: false, errors: [...], stats: {...} }
```

### Preview Component
```tsx
function DatasetPreview({ datasetId }: { datasetId: number }) {
    const { data } = useQuery({
        queryKey: ["dataset-preview", datasetId],
        queryFn: () => fetch(`/api/datasets/${datasetId}/preview`).then(r => r.json()),
    });
    
    return (
        <Table>
            <TableHeader>
                {data?.columns.map(col => <TableHead key={col}>{col}</TableHead>)}
            </TableHeader>
            <TableBody>
                {data?.rows.map((row, i) => (
                    <TableRow key={i}>
                        {data.columns.map(col => (
                            <TableCell key={col}>{row[col]}</TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
```

---

## 5. Human Approval Enhancements

### Configure HIL
```typescript
import { hilEnhancementsService } from "@domain/integrations/core/hil-enhancements.service.js";

// Update config
await hilEnhancementsService.updateConfig(100, {
    escalationEnabled: true,
    escalationTimeoutMinutes: 60,
    autoApprovalEnabled: true,
    similarityThreshold: 90,
    businessHoursOnly: true,
    businessHoursStart: 9,
    businessHoursEnd: 17,
});
```

### Check Escalation
```typescript
const check = await hilEnhancementsService.checkEscalation(approvalRequestId);
if (check.shouldEscalate) {
    await hilEnhancementsService.escalateRequest(
        approvalRequestId,
        "timeout",
        [adminId],
        "admin",
        "Request pending too long"
    );
}
```

### Record Pattern (after decision)
```typescript
// After approval/rejection
await hilEnhancementsService.recordPattern(approvalRequestId, "approved");
```

---

## 6. Visual Job Builder

### Usage
> **Removed 2026-09-20.** `VisualJobBuilder` was written but never mounted — no route, no
> importer and no save path — so this example could not have worked. Pipelines are
> assembled step by step in the pipeline domain; there is no node editor.
typescript
import { getJobTypeConfig, getJobTypeIcon, getHealthScoreStyle } from "@domain/jobs/ui/job-type-config";

const config = getJobTypeConfig("ai_agent");
const Icon = getJobTypeIcon("ai_agent");

// Usage
<Icon style={{ color: config.color }} />
```

### Health Score Badge
```tsx
function HealthBadge({ jobId }: { jobId: number }) {
    const { data } = useQuery({
        queryKey: ["/api/jobs", jobId, "health"],
        queryFn: () => fetch(`/api/jobs/${jobId}/health`).then(r => r.json()),
    });
    
    if (!data) return null;
    
    const style = getHealthScoreStyle(data.overall);
    
    return (
        <Badge style={{ backgroundColor: style.bg, color: style.color }}>
            {data.overall}% {style.label}
        </Badge>
    );
}
```

---

## 8. Inline Test Panel

### Quick Test Button
```tsx
function QuickTestButton({ job }: { job: Job }) {
    const [isTesting, setIsTesting] = useState(false);
    const [result, setResult] = useState(null);
    
    const test = async () => {
        setIsTesting(true);
        const res = await fetch(`/api/jobs/${job.id}/test`, {
            method: "POST",
        }).then(r => r.json());
        setResult(res);
        setIsTesting(false);
    };
    
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Play className="w-4 h-4 mr-1" />
                    Quick Test
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
                <SplitView>
                    <div>Config Panel</div>
                    <TestResults result={result} isLoading={isTesting} />
                </SplitView>
            </DialogContent>
        </Dialog>
    );
}
```

---

## 9. Job Health Score

### Get Health Score
```typescript
const health = await jobHealthService.calculateHealthScore(jobId);
// { overall: 85, successRate: 90, avgResponseTimeScore: 80, errorRateTrend: 95, recencyScore: 85 }
```

### Get Trend
```typescript
const trend = await jobHealthService.getHealthTrend(jobId, 14);
// { direction: "improving", changePercent: 15, periodDays: 14 }
```

### Display Component
```tsx
function HealthDisplay({ jobId }: { jobId: number }) {
    const { data: health } = useQuery({
        queryKey: ["/api/jobs", jobId, "health"],
        queryFn: () => fetch(`/api/jobs/${jobId}/health`).then(r => r.json()),
    });
    
    const { data: trend } = useQuery({
        queryKey: ["/api/jobs", jobId, "health", "trend"],
        queryFn: () => fetch(`/api/jobs/${jobId}/health/trend`).then(r => r.json()),
    });
    
    if (!health) return null;
    
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    {health.status.label}
                    <Badge style={{ backgroundColor: health.status.color }}>
                        {health.overall}%
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-4">
                    <div>Success Rate: {health.successRate}%</div>
                    <div>Response Time: {health.avgResponseTimeScore}%</div>
                    <div>Error Trend: {health.errorRateTrend}%</div>
                    <div>Recency: {health.recencyScore}%</div>
                </div>
                {trend && (
                    <div className="mt-4 text-sm text-muted-foreground">
                        Trend: {trend.direction} ({trend.changePercent > 0 ? "+" : ""}{trend.changePercent}%)
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
```

---

## 10. Quick Actions from Library

### Job Card with Quick Actions
```tsx
function JobCard({ job }: { job: Job }) {
    const queryClient = useQueryClient();
    
    const runJob = useMutation({
        mutationFn: () => fetch(`/api/jobs/${job.id}/run`, { method: "POST" }),
        onSuccess: () => {
            toast({ title: "Job started" });
            queryClient.invalidateQueries(["/api/jobs", job.id, "runs"]);
        },
    });
    
    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <JobTypeIcon type={job.type} />
                        <CardTitle className="text-base">{job.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => runJob.mutate()}
                            disabled={runJob.isPending}
                        >
                            <Play className="w-4 h-4" />
                        </Button>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="ghost" size="sm">
                                    <Activity className="w-4 h-4" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <JobStatsDialog jobId={job.id} />
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <HealthBadge jobId={job.id} />
                <TokenUsageDisplay jobId={job.id} />
            </CardContent>
        </Card>
    );
}
```

---

## Testing

### Run All Tests
```bash
npm test -- tests/job-enhancements/
```

### Run Specific Test
```bash
npm test -- tests/job-enhancements/request-history.test.ts
```

---

## Environment Variables

```env
# Optional: Configure default thresholds
JOB_HEALTH_HISTORY_DAYS=30
TOKEN_TRACKING_ENABLED=true
STREAMING_LOGS_RETENTION_MINUTES=60
HIL_DEFAULT_TIMEOUT_MINUTES=60
```

---

## Troubleshooting

### Issues and Solutions

| Issue | Solution |
|-------|----------|
| Request history not recording | Check `isReplayable` flag and triggeredBy field |
| Token costs not calculating | Verify model name matches pricing table |
| Streaming logs not appearing | Confirm SSE connection and channel ID |
| Health score is 0 | Ensure job has run at least once in 30 days |
| HIL not escalating | Check config `escalationEnabled` and timeout |

---

For full documentation, see `docs/JOB_ENHANCEMENTS.md`
