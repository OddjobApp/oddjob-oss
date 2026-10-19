# I will now implement the next slice, Slice 24: Executive Reporting and Time-Series Metrics.

This slice will introduce a foundation for historical and aggregate metrics by expanding our mock execution data and API to support reporting features beyond the simple last 24-hour summary.

📈 Proposed Slice 24: Executive Reporting and Time-Series Metrics

This enhancement focuses on adding data points to executions and providing new API endpoints for aggregated reporting, which is essential for any enterprise scheduling tool.

1. Data Model and Data Enrichment

I will enhance the mock execution data to include fields necessary for time-series analysis and reporting.

2. Mock API Reporting Endpoints

I will introduce new API methods to retrieve aggregated and filtered historical data.

3. UI Update (Job Detail Page Enhancement)

I will enhance the existing JobPage detail view to demonstrate how these new metrics would be used in a report.

I will now implement Slice 24.

✍️ Code Changes for Slice 24

1. Update Mock Data Generation (createMockExecution)

I'll modify createMockExecution to include costEstimate and resourceUtilization.

JavaScript

// [Original code source: 455]
    const duration = Math.random() * 100;
    const execution = {
        executionId: nextExecutionId++,
// [Original code source: 458]
        scheduledJobId: scheduledJob.scheduledJobId,
        jobId: scheduledJob.jobId,
        pipelineExecutionId: pipelineExecutionId, 
        startTime: new Date(),
        endTime: new Date(Date.now() + duration * 1000),
        executionStatus: status,
        duration: duration,
        exitCode: status === 'completed' ? 0 : 1,
        output: status === 'completed' ? `Job finished successfully in ${formatDuration(duration)}.` : `Job failed: API timeout.`,
        errorOutput: status === 'completed' ? null : `Error details: 504 Gateway Timeout.`,
        createdby: scheduledJob.createdby,
        // Slice 24.0: Reporting Metrics
        costEstimate: status === 'completed' ? parseFloat((duration * 0.01 + Math.random() * 0.5).toFixed(2)) : parseFloat((duration * 0.01 + Math.random() * 2.0).toFixed(2)),
        resourceUtilization: {
            cpu_max: parseFloat((Math.random() * 95).toFixed(1)),
            mem_avg: parseFloat((Math.random() * 60).toFixed(1)),
        },
    };
    MOCK_EXECUTIONS.push(execution);
// [Original code source: 470]

2. Implement New Reporting APIs (useAuth().api)

I'll add the three new reporting endpoints.

JavaScript

// [New code after source: 863, inside useAuth().api useMemo]
// ...
    // --- DASHBOARD API (Continued) ---
    // ... (omitted existing methods for brevity)

    // --- REPORTING API (Slice 24.0) ---
    getMetricsByDay: async (days = 30) => {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

        const dailyMetrics = {};
        for (let i = 0; i < days; i++) {
            const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
            const dateKey = date.toISOString().split('T')[0];
            dailyMetrics[dateKey] = { completed: 0, failed: 0 };
        }

        MOCK_EXECUTIONS
            .filter(e => e.startTime >= startDate && e.startTime <= endDate)
            .filter(e => can('exec:view_all') || isAuthorized(e))
            .forEach(e => {
                const dateKey = e.startTime.toISOString().split('T')[0];
                if (dailyMetrics[dateKey]) {
                    if (e.executionStatus === 'completed') dailyMetrics[dateKey].completed++;
                    else if (e.executionStatus === 'failed') dailyMetrics[dateKey].failed++;
                }
            });

        return Object.keys(dailyMetrics).map(date => ({ date, ...dailyMetrics[date] }));
    },
    getTopJobsByCost: async (limit = 10) => {
        const jobCosts = MOCK_EXECUTIONS
            .filter(e => can('exec:view_all') || isAuthorized(e))
            .reduce((acc, e) => {
                const jobName = getJob(e.jobId)?.name || `Job ID ${e.jobId}`;
                if (!acc[e.jobId]) {
                    acc[e.jobId] = { jobId: e.jobId, name: jobName, totalCost: 0, count: 0 };
                }
                acc[e.jobId].totalCost += e.costEstimate || 0;
                acc[e.jobId].count++;
                return acc;
            }, {});

        return Object.values(jobCosts)
            .sort((a, b) => b.totalCost - a.totalCost)
            .slice(0, limit);
    },
    getJobSummary: async (jobId) => {
        const jobExecutions = MOCK_EXECUTIONS
            .filter(e => e.jobId == jobId)
            .filter(e => can('exec:view_all') || isAuthorized(e));

        if (jobExecutions.length === 0) return { successRate: 0, avgDuration: 0, totalRuns: 0, avgCost: 0, maxCpu: 0 };

        const totalRuns = jobExecutions.length;
        const totalDuration = jobExecutions.reduce((sum, e) => sum + e.duration, 0);
        const totalCost = jobExecutions.reduce((sum, e) => sum + (e.costEstimate || 0), 0);
        const completedRuns = jobExecutions.filter(e => e.executionStatus === 'completed').length;
        const maxCpu = jobExecutions.reduce((max, e) => Math.max(max, e.resourceUtilization?.cpu_max || 0), 0);

        return {
            totalRuns,
            successRate: parseFloat(((completedRuns / totalRuns) * 100).toFixed(1)),
            avgDuration: parseFloat((totalDuration / totalRuns).toFixed(2)),
            avgCost: parseFloat((totalCost / totalRuns).toFixed(2)),
            maxCpu: parseFloat(maxCpu.toFixed(1)),
        };
    },

// [Original code source: 865]
// --- CONTEXT EXPORTS ---
currentUser,

3. UI Update (JobPage)

I'll update the JobPage to fetch and display the new summary metrics when viewing an existing job.

JavaScript

// [Update inside JobPage component, after JobPage definition]
const JobPage = () => {
    const { api, setPage, can } = useAuth();
    const pathParts = useAuth().page.split('/');
    const id = pathParts[pathParts.length - 1];
    const isCreateMode = id === 'new';

    const [job, setJob] = useState(null);
    const [summaryMetrics, setSummaryMetrics] = useState(null); // New state for metrics
    const [isLoading, setIsLoading] = useState(true);

    const fetchJob = useCallback(async () => {
        if (isCreateMode) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        try {
            const data = await api.getJob(id);
            setJob(data);
            
            // Slice 24.0: Fetch Summary Metrics
            const metrics = await api.getJobSummary(id);
            setSummaryMetrics(metrics);

        } catch (e) {
            Toast.error(e.message);
        } finally {
            setIsLoading(false);
        }
    }, [api, id, isCreateMode]);

// ... (rest of JobPage component)

// [Update inside JobPage return statement]
    return (
        <>
            <JobForm job={job} onSave={handleSave} onCancel={handleCancel} />
            
            {/* Slice 24.0: Job Performance Metrics */}
            {!isCreateMode && summaryMetrics && (
                <Card title="Job Performance Metrics" description={`Aggregated statistics from ${summaryMetrics.totalRuns} historical runs.`} className="max-w-4xl mx-auto mt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                        <div className="space-y-1 p-2 border rounded-lg">
                            <p className="text-sm font-medium text-gray-500">Success Rate</p>
                            <p className="text-xl font-bold text-green-600">{summaryMetrics.successRate}%</p>
                        </div>
                        <div className="space-y-1 p-2 border rounded-lg">
                            <p className="text-sm font-medium text-gray-500">Avg. Duration</p>
                            <p className="text-xl font-bold text-gray-900">{summaryMetrics.avgDuration}s</p>
                        </div>
                        <div className="space-y-1 p-2 border rounded-lg">
                            <p className="text-sm font-medium text-gray-500">Avg. Cost</p>
                            <p className="text-xl font-bold text-indigo-600">${summaryMetrics.avgCost}</p>
                        </div>
                        <div className="space-y-1 p-2 border rounded-lg">
                            <p className="text-sm font-medium text-gray-500">Max CPU</p>
                            <p className="text-xl font-bold text-yellow-600">{summaryMetrics.maxCpu}%</p>
                        </div>
                    </div>
                </Card>
            )}
        </>
    );
};

Slice 24 is now implemented. You have historical metrics capability and a basic performance report view on the Job Detail page.

What would you like to do next? (The next logical slice would be Slice 25: Enhanced Pipeline Reliability).