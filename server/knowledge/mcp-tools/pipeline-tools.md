# Pipeline MCP Tools

## Read Operations

### list_pipelines
List all pipelines.
```
list_pipelines(search?: string, limit?: number)
```

### get_pipeline_details
Get pipeline configuration and steps.
```
get_pipeline_details(pipelineId: number, includeExecutionHistory?: boolean)
```

### get_pipeline_execution_status
Check execution status.
```
get_pipeline_execution_status(executionId: number, includeStepDetails?: boolean)
```

### list_recent_executions
Get recent executions across all pipelines.
```
list_recent_executions(limit?: number, status?: string, pipelineId?: number)
```

### get_pipeline_variable_syntax
Learn how to pass data between steps.
```
get_pipeline_variable_syntax()
```
Returns: Variable syntax reference ({{steps.N.output}}, etc.)

## Write Operations (Admin Only)

### create_pipeline
Create a new pipeline.
```
create_pipeline(name: string, description?: string, steps?: array)
```

### update_pipeline
Modify pipeline settings.
```
update_pipeline(pipelineId: number, name?: string, triggerType?: string)
```

### delete_pipeline
Remove a pipeline.
```
delete_pipeline(pipelineId: number)
```

### add_pipeline_step
Add a step to a pipeline.
```
add_pipeline_step(pipelineId: number, moduleType: string, jobId?: number, config?: object)
```

### update_pipeline_step
Modify an existing step.
```
update_pipeline_step(stepId: number, config: object)
```

### delete_pipeline_step
Remove a step.
```
delete_pipeline_step(stepId: number)
```

## Execution Operations

### trigger_pipeline / run_pipeline
Execute a pipeline.
```
trigger_pipeline(pipelineId: number, input?: object)
```

## Usage Patterns

### Building a Pipeline
1. `create_pipeline(name)` - Create empty pipeline
2. `add_pipeline_step(...)` - Add steps in order
3. `get_pipeline_variable_syntax()` - Learn how to connect steps
4. `trigger_pipeline(id, {})` - Test execution
