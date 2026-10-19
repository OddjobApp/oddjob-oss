# Dynamic Tool Discovery & Creation

## Overview

The Tool Discovery System enables agents to intelligently discover existing tools and dynamically create new tools when existing ones don't meet their needs.

## Key Capabilities

- **Semantic Tool Matching**: Find tools based on capability descriptions
- **Dynamic Composition**: Combine existing tools into new workflows
- **Prompt-Based Tool Generation**: Create tools using AI prompt templates
- **Tool Validation**: Ensure created tools work correctly
- **Performance Tracking**: Monitor tool effectiveness over time

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Agent Needs Tool                         │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌──────────────┐       ┌──────────┐
   │ Search  │      │  Compose     │       │  Create  │
   │ Existing│      │  Tools      │       │  New     │
   └─────────┘       └──────────────┘       └──────────┘
        │                  │                      │
        └──────────────────┴──────────────────────┘
                           │
                    ┌──────────────┐
                    │ Tool Index  │
                    │ (semantic)  │
                    └──────────────┘
```

## Quick Start

### Finding Tools

```typescript
import { toolCapabilityIndex } from "@domain/agents/core/tool-discovery";

// Find tools for a task
const matches = await toolCapabilityIndex.findTools({
  description: "Analyze customer feedback sentiment",
  requiredCapabilities: ["sentiment_analysis", "text_processing", "classification"]
}, 5);

// Best match
const best = matches[0];
console.log(best.tool.name);           // "Sentiment Analyzer"
console.log(best.relevanceScore);      // 0.92
console.log(best.matchReasoning);      // "High semantic match. Covers all capabilities."
console.log(best.estimatedSuccess);    // 0.88
```

### Creating Dynamic Tools

```typescript
import { dynamicToolCreator } from "@domain/agents/core/tool-discovery";

// Request a new tool when existing ones don't work
const result = await dynamicToolCreator.createTool({
  agentId: "agent-1",
  name: "Sales Trend Analyzer",
  description: "Analyze sales trends and predict future performance",
  requiredCapabilities: ["trend_analysis", "prediction", "time_series"],
  inputDescription: "Historical sales data with dates and amounts",
  outputDescription: "Trend analysis with predictions",
  examples: [{
    input: { data: [{ date: "2024-01", amount: 1000 }] },
    expectedOutput: { trend: "up", prediction: 1200 },
    explanation: "Analyzes monthly data"
  }],
  existingToolsTried: ["basic-analyzer"],
  failureReasons: ["Doesn't handle time series"]
});

if (result.success) {
  console.log(`Created: ${result.tool!.name}`);
  console.log(`Type: ${result.tool!.implementation.type}`);
  console.log(`Reasoning: ${result.reasoning}`);
}
```

### Validating New Tools

```typescript
// Validate before using
const validation = await dynamicToolCreator.validateTool(
  toolId,
  "validator-agent-id",
  [
    { input: { data: [1, 2, 3] }, expectedOutput: { sum: 6 } },
    { input: { data: [] }, expectedOutput: { sum: 0 } }
  ]
);

console.log(`Passed: ${validation.passed}/${validation.passed + validation.failed}`);
```

## Tool Creation Strategies

### 1. Composition (Preferred)
Combines 2-3 existing tools into a workflow.

**When Used**: When existing tools together cover the requirements.

**Advantages**: 
- Uses proven, tested components
- Low risk
- Fast creation

### 2. Prompt Template
Creates an AI-powered tool using a prompt template.

**When Used**: For generation, transformation, or analysis tasks.

**Example**:
```typescript
implementation: {
  type: "prompt_template",
  promptTemplate: `Analyze the following text and extract key entities:
  {{input}}
  
  Output JSON with: entities, types, relationships`
}
```

### 3. Code Generation (Restricted)
Generates executable code for data transformations.

**When Used**: For well-defined, safe operations (filter, sort, calculate).

**Safety**: Requires validation and runs in sandbox (not yet implemented).

## Semantic Matching

Tools are matched using:

1. **Embedding Similarity**: Semantic similarity between task and tool descriptions
2. **Capability Coverage**: Percentage of required capabilities matched
3. **Performance History**: Past success rates and quality scores
4. **Personalization**: Agent's preferred tools

### Capability Taxonomy

Common capabilities:
- `search`, `query`, `filter`, `retrieve`
- `create`, `generate`, `build`
- `update`, `modify`, `edit`
- `delete`, `remove`
- `analyze`, `examine`, `assess`
- `transform`, `convert`, `process`
- `validate`, `verify`, `check`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tool-discovery/find` | Find matching tools |
| GET | `/api/tool-discovery/tools` | List all tools |
| GET | `/api/tool-discovery/tools/:id` | Get tool details |
| POST | `/api/tool-discovery/compositions` | Find tool compositions |
| POST | `/api/tool-discovery/tools` | Create dynamic tool |
| GET | `/api/tool-discovery/dynamic-tools` | List dynamic tools |
| POST | `/api/tool-discovery/dynamic-tools/:id/validate` | Validate tool |
| POST | `/api/tool-discovery/dynamic-tools/:id/execute` | Execute tool |
| GET | `/api/tool-discovery/stats` | Get statistics |

## React Hooks

```typescript
import { 
  useToolDiscovery, 
  useDynamicTools,
  useSmartToolSelector 
} from "@/modules/agents/hooks/use-tool-discovery";

// Basic discovery
const { search, results, isSearching } = useToolDiscovery();

// Create and manage dynamic tools
const { tools, createTool, validateTool } = useDynamicTools();

// Smart selection with auto-creation
const { findAndSelect, selectedTool } = useSmartToolSelector();

// Usage
const result = await findAndSelect(
  "Summarize customer feedback",
  ["summarization", "text_processing"],
  { minScore: 0.8, autoCreate: true, agentId: "agent-1" }
);
```

## Tool Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Need   │────►│  Create  │────►│ Validate │────►│   Use   │
│ Identified    │ (compose/  │     │  (tests)  │     │         │
│               │  prompt)   │     │           │     │         │
└──────────┘     └──────────┘     └────┬─────┘     └────┬────┘
                                         │                │
                                         ▼                ▼
                                   ┌──────────┐     ┌──────────┐
                                   │  Deprecate│    │  Learn  │
                                   │ (if bad)  │    │ (metrics)│
                                   └──────────┘     └──────────┘
```

## Performance Tracking

Each tool tracks:
- `usageCount`: How often it's been used
- `successRate`: % of successful invocations
- `avgLatencyMs`: Average response time
- `qualityScore`: User/AI rated quality

## Best Practices

1. **Prefer Composition**: Use existing tools when possible
2. **Provide Examples**: Good examples improve tool creation
3. **Validate Thoroughly**: Test edge cases before deployment
4. **Monitor Performance**: Watch success rates and latency
5. **Version Control**: Track changes to dynamic tools

## Safety Considerations

- **Code Tools**: Run in sandbox with restricted permissions
- **Prompt Tools**: Monitor for prompt injection attempts
- **Validation**: All dynamic tools require validation before use
- **Escalation**: Failed validations escalate to human review

## Future Enhancements

- Machine learning for better matching
- Automatic tool improvement from feedback
- Tool marketplace for sharing
- Visual tool composition UI
- A/B testing for tool variants
