# Pipelines Feature

## Overview
Pipelines are multi-step workflows that connect jobs in sequence or parallel, passing data between steps.

## Pipeline Structure

```
[Start] → [Step 1: Fetch Data] → [Step 2: Transform] → [Decision] → [End]
                                                           ↓
                                                    [Step 3: Alert]
```

## Step Types

| Type | Purpose | Config |
|------|---------|--------|
| `job` | Execute a job | `jobId`, `order`, `outputName` |
| `decision` | Conditional branch | `condition`, `trueStepId`, `falseStepId` |
| `iterator` | Loop over items | `inputArray`, `targetJobId`, `itemVarName` |
| `start` | Pipeline entry | Auto-generated |
| `end` | Pipeline exit | Auto-generated |

## Variable Syntax

### Accessing Step Outputs
```
{{steps.0.output}}           # First step's full output
{{steps.1.output.items}}     # Nested field from step 2
{{steps.2.output[0].id}}     # Array access
```

### Special Variables
```
{{input}}                    # Pipeline trigger input
{{context.userId}}           # Execution context
{{env.API_KEY}}              # Environment variable
```

## Common Patterns

### File Processing
```
folder_import → transformer → file_export
```
1. Import files from directory
2. Parse/transform data
3. Export to destination

### API Integration
```
curl (fetch) → transformer → knowledge graph
```
1. Fetch data from API
2. Extract entities
3. Store in knowledge graph

### Batch Processing
```
curl (get list) → iterator → (job per item)
```
1. Fetch list of items
2. Loop over each item
3. Process individually

### Conditional Flow
```
curl → decision → (success path) or (failure path)
```

## Step Configuration Examples

### Job Step
```json
{
  "moduleType": "job",
  "jobId": 5,
  "order": 1,
  "outputName": "api_data"
}
```

### Decision Step
```json
{
  "moduleType": "decision",
  "order": 2,
  "decisionNodeConfig": {
    "condition": "steps.1.output.count > 0",
    "trueStepId": 3,
    "falseStepId": 4
  }
}
```

### Iterator Step
```json
{
  "moduleType": "iterator",
  "order": 3,
  "iteratorConfig": {
    "inputArray": "{{steps.1.output.items}}",
    "targetJobId": 7,
    "itemVarName": "item"
  }
}
```

## User Help Scenarios

| Scenario | Response |
|----------|----------|
| User building first pipeline | Explain step flow, show variable syntax |
| Steps not connecting | Check output names and variable references |
| Pipeline failing mid-execution | Get execution status, check step outputs |
