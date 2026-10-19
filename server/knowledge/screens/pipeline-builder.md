# Pipeline Builder Screen

**Route**: `/pipelines/:id`

## Overview
Visual editor for building multi-step automation workflows.

## Components

### Step Canvas
- Drag-and-drop step arrangement
- Visual connections between steps
- Step configuration panels

### Step Types Available
- Job steps (execute a job)
- Decision nodes (conditional branching)
- Iterator (loop over collections)

### Variable Reference Panel
- Shows available variables per step
- Syntax help for `{{steps.N.output}}`

## Common Tasks

### Adding a Step
1. Click "Add Step"
2. Select step type (job, decision, iterator)
3. Configure step settings
4. Set order position

### Connecting Steps
- Use `{{steps.N.output}}` to reference previous outputs
- Decision nodes automatically branch to true/false paths

### Testing Pipeline
- "Dry Run" validates without executing
- "Run" triggers full execution

## Help Scenarios

| Behavior | Likely Need | Response |
|----------|-------------|----------|
| Idle on builder | Unsure how to proceed | Explain step flow |
| Adding first step | Starting pipeline | Suggest common patterns |
| Looking at decision node | Setting up branching | Show condition syntax |
| Pipeline failing | Debugging | Get execution status |

## MCP Tools for This Screen
- `get_pipeline_details` - Current pipeline config
- `add_pipeline_step` - Add new step
- `update_pipeline_step` - Modify existing step
- `get_pipeline_variable_syntax` - Variable reference
- `trigger_pipeline` - Run the pipeline
