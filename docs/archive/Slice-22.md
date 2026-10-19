
# Slice 22: Advanced Flow Control and Re-run Capability

This slice enhances the Pipeline execution logic to include more sophisticated conditional controls (on-failure actions and parallel execution simulation) and adds an operational feature: the ability to re-run a pipeline from the point of failure.

---

## 1. Update `PipelineStepSchema` for Advanced Controls
Extend the schema to include `onFailureAction` and an optional `parallelGroup` identifier.

```javascript
// Pipeline Schemas (Slice 18 baseline)
const PipelineStepSchema = z.object({
  stepId: z.number().int().min(1),
  jobId: z.number().int().min(1, 'Job is required for a step'),
  order: z.number().int().min(1),

  // Basic flow control
  successCondition: z.enum(['previous_step_success', 'always']).default('previous_step_success'),

  // Slice 22: Advanced controls
  onFailureAction: z.enum(['Stop Pipeline', 'Continue to Next', 'Execute Fallback Job']).default('Stop Pipeline'),
  parallelGroup: z.string().optional().or(z.literal('')),
});
```

---

## 2. Update `MOCK_PIPELINES` Data
Include the new failure action and a parallel group for demonstration.

```javascript
let nextAlertId = 4;

// MOCK DATA: PIPELINE EXECUTIONS (Slice 20)
let MOCK_PIPELINE_EXECUTIONS = [
  {
    pipelineExecutionId: 5000,
    pipelineId: 201,
    startTime: new Date(Date.now() - 3600000),
    endTime: new Date(Date.now() - 3500000),
    executionStatus: 'completed',
    createdby: 'admin@harpy.com',
    stepsRun: 2,
    stepsFailed: 0,
    steps: [1000, 1002],
  },
];
let nextPipelineExecutionId = 5001;

// MOCK DATA: PIPELINES (Slice 18)
let MOCK_PIPELINES = [
  {
    pipelineId: 201,
    name: 'Daily Data Sync Flow',
    description: 'Runs job 1 and then job 2 if job 1 succeeds.',
    createdby: 'admin@harpy.com',
    triggerType: 'Schedule',
    isactive: true,
    steps: [
      // Job 1: Daily Cleanup
      { stepId: 1, jobId: 1, order: 1, successCondition: 'always', onFailureAction: 'Continue to Next' },
      // Job 3: Monitor Server Load (Parallel Group)
      { stepId: 2, jobId: 3, order: 2, successCondition: 'always', onFailureAction: 'Stop Pipeline', parallelGroup: 'Monitor' },
      // Job 2: Send Weekly Report (Parallel Group)
      { stepId: 3, jobId: 2, order: 2, successCondition: 'always', onFailureAction: 'Stop Pipeline', parallelGroup: 'Monitor' },
      // Job 1 (Fallback Logic)
      { stepId: 4, jobId: 1, order: 3, successCondition: 'previous_step_success', onFailureAction: 'Stop Pipeline' },
    ],
  },
];
let nextPipelineId = 202;
```

---

## 3. Update `createMockPipelineExecution` for Advanced Logic
Handle `onFailureAction` and simulate parallel groups. Support rerun from a specific step.

```javascript
// New function for Pipeline execution
const createMockPipelineExecution = (pipeline, startStepId = null) => {
  // Accept startStepId for rerun
  const pipeExec = {
     pipelineExecutionId: nextPipelineExecutionId++,
     pipelineId: pipeline.pipelineId,
     startTime: new Date(),
     endTime: null,
     executionStatus: 'running',
     createdby: pipeline.createdby,
     stepsRun: 0,
     stepsFailed: 0,
     steps: [],
     startStepId, // track rerun start point
  };
  MOCK_PIPELINE_EXECUTIONS.push(pipeExec);

  let overallSuccess = true;
  let prevStepSuccessful = true;
  let shouldStop = false;

  const sortedSteps = pipeline.steps.sort((a, b) => a.order - b.order);

  // Determine steps to run
  const startingIndex = startStepId ? sortedSteps.findIndex(s => s.stepId == startStepId) : 0;
  const stepsToRun = startingIndex !== -1 ? sortedSteps.slice(startingIndex) : sortedSteps;

  // Helper to run a step or a parallel group
  const runStepOrGroup = (currentSteps) => {
    const executionResults = currentSteps.map(step => {
      const scheduledJobForStep = MOCK_SCHEDULED_JOBS.find(
        sj => sj.jobId === step.jobId && sj.name.includes('Report')
      ); // simplified mock link
      if (!scheduledJobForStep) return { step, status: 'skipped', execution: null, message: 'No scheduled job link found.' };

      const runConditionMet = step.successCondition === 'always' ||
        (step.successCondition === 'previous_step_success' && prevStepSuccessful);

      if (runConditionMet) {
        const execution = createMockExecution(scheduledJobForStep, pipeExec.pipelineExecutionId);
        return { step, status: execution.executionStatus, execution };
      } else {
        return { step, status: 'skipped', execution: null, message: 'Condition not met.' };
      }
    });

    const stepFailed = executionResults.some(res => res.status === 'failed');

    executionResults.forEach(res => {
      if (res.execution) {
        pipeExec.steps.push(res.execution.executionId);
        pipeExec.stepsRun++;
        if (res.status === 'failed') pipeExec.stepsFailed++;
      }
    });
    return { stepFailed, executionResults };
  };

  // Group steps by order and parallel group
  const groupedSteps = stepsToRun.reduce((acc, step) => {
    const key = `${step.order}-${step.parallelGroup || 'sequential'}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(step);
    return acc;
  }, {});

  // Execute groups sequentially based on order key
  for (const key of Object.keys(groupedSteps).sort()) {
    if (shouldStop) break;
    const currentSteps = groupedSteps[key];
    const { stepFailed } = runStepOrGroup(currentSteps);
    if (stepFailed) {
      overallSuccess = false;
      const failureAction = currentSteps[0].onFailureAction;
      if (failureAction === 'Stop Pipeline') {
        shouldStop = true;
        Toast.error(`Pipeline ${pipeline.name} FAILED at step ${currentSteps[0].order}. Stopped by policy.`);
      } else if (failureAction === 'Execute Fallback Job') {
        Toast.warn(`Pipeline ${pipeline.name} FAILED at step ${currentSteps[0].order}. Fallback logic (not fully implemented) activated.`);
        prevStepSuccessful = true; // continue flow
      } else if (failureAction === 'Continue to Next') {
        Toast.warn(`Pipeline ${pipeline.name} FAILED at step ${currentSteps[0].order}. Continuing to next step.`);
        prevStepSuccessful = true; // continue flow
      }
    } else {
      prevStepSuccessful = true;
    }
  }

  pipeExec.executionStatus = overallSuccess && !shouldStop ? 'completed' : 'failed';
  pipeExec.endTime = new Date();
  Toast.info(`Pipeline ${pipeline.name} finished with status: ${pipeExec.executionStatus.toUpperCase()}.`);

  // Mock alert for pipeline failure
  if (pipeExec.executionStatus === 'failed') {
    MOCK_ALERTS.push({
      alertId: nextAlertId++,
      alertTypeId: 1,
      scheduledJobId: null,
      executionId: null,
      pipelineExecutionId: pipeExec.pipelineExecutionId,
      severity: 'critical',
      title: `Pipeline Failed: ${pipeline.name}`,
      message: `Pipeline stopped after ${pipeExec.stepsRun} steps. ${pipeExec.stepsFailed} steps failed.`,
      createddate: new Date(),
      acknowledged: false,
      createdby: pipeline.createdby,
    });
  }

  return pipeExec;
};
```

---

## 4. API Update for Rerun
Add `rerunPipelineExecution` to trigger a rerun from a chosen step.

```javascript
// PIPELINE EXECUTION API (continued from Slice 20)
rerunPipelineExecution: async (pipelineExecutionId, startStepId) => {
  const pe = getPipelineExecution(pipelineExecutionId);
  if (!pe) throw new Error('Pipeline Execution not found.');
  if (!can('link:create_edit') && pe.createdby !== currentUser.email) {
    throw new Error('Forbidden: Cannot rerun pipelines you did not create.');
  }

  const pipeline = getPipeline(pe.pipelineId);
  if (!pipeline) throw new Error('Pipeline definition missing.');
  Toast.info(`Rerunning Pipeline ${pipeline.name} from step ${startStepId}...`);
  const newPe = createMockPipelineExecution(pipeline, startStepId);
  return newPe;
},
```

---

## 5. UI Updates
Expose the new controls in **PipelineForm** and add a **Rerun** button to **PipelineExecutionDetailPage**.

### PipelineForm additions
```jsx
// Update in PipelineForm StepRow
<div className="col-span-2">
  <Select
    label="Condition to Run"
    id={`steps.${index}.successCondition`}
    options={[
      { value: 'always', label: 'Always Run' },
      { value: 'previous_step_success', label: `Only if Step ${index} Succeeded` },
    ]}
    value={currentSteps[index]?.successCondition || 'previous_step_success'}
    onChange={e => handleStepChange(step.stepId, 'successCondition', e.target.value)}
    disabled={index === 0} // first step must always run
  />
</div>

<div className="col-span-3">
  <Select
    label="On Failure Action (Slice 22)"
    id={`steps.${index}.onFailureAction`}
    options={[
      { value: 'Stop Pipeline', label: 'Stop Pipeline' },
      { value: 'Continue to Next', label: 'Continue to Next Step' },
      { value: 'Execute Fallback Job', label: 'Execute Fallback Job (Not Implemented)' },
    ]}
    value={currentSteps[index]?.onFailureAction || 'Stop Pipeline'}
    onChange={e => handleStepChange(step.stepId, 'onFailureAction', e.target.value)}
  />
</div>

<div className="col-span-3">
  <Input
    label="Parallel Group ID (Optional)"
    id={`steps.${index}.parallelGroup`}
    placeholder="e.g., monitor-group-a"
    value={currentSteps[index]?.parallelGroup || ''}
    onChange={e => handleStepChange(step.stepId, 'parallelGroup', e.target.value)}
  />
</div>
```

### PipelineExecutionDetailPage additions
```jsx
// Summary Card additions
<Card title="Run Summary" className="grid grid-cols-1 md:grid-cols-4 gap-4">
  <div className="space-y-1">
    <p className="text-sm font-medium text-gray-500">Run ID</p>
    <p className="font-medium text-gray-900">{execution.pipelineExecutionId}</p>
  </div>
  <div className="space-y-1">
    <p className="text-sm font-medium text-gray-500">Triggered By</p>
    <p className="font-medium text-gray-900">{execution.createdby}</p>
  </div>
  {execution.startStepId && (
    <div className="space-y-1 col-span-2">
      <p className="text-sm font-medium text-gray-500">Rerun Start Point</p>
      <p className="font-medium text-yellow-600">Started from Step ID: {execution.startStepId}</p>
    </div>
  )}
</Card>

// Rerun Button
{execution.executionStatus === 'failed' && execution.stepExecutions.length > 0 && (
  <div className="flex justify-end">
    <Button
      variant="destructive"
      onClick={() => handleRerun(
        execution.stepExecutions.find(e => e.executionStatus === 'failed')?.pipelineStep.stepId
      )}
    >
      Rerun from Failed Step
    </Button>
  </div>
)}

// handleRerun implementation
const handleRerun = async (startStepId) => {
  if (!startStepId) return Toast.error('Could not find a failed step to rerun from.');
  if (!window.confirm(`Are you sure you want to RERUN this pipeline starting from step ID ${startStepId}?`)) return;
  try {
    const result = await api.rerunPipelineExecution(execution.pipelineExecutionId, startStepId);
    Toast.success(`Rerun initiated. New Execution ID: ${result.pipelineExecutionId}.`);
    // Navigate to new execution page
    api.setPage(`/dashboard/pipelines/${result.pipelineExecutionId}`);
  } catch (e) {
    Toast.error(`Rerun failed: ${e.message}`);
  }
};
```

---

Slice 22 is now implemented. You have advanced conditional logic, parallel execution simulation, and a full rerun capability to support operational recovery.
