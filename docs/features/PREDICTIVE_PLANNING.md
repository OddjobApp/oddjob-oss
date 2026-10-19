# Predictive Mission Planning

## Overview

The Predictive Mission Planning Service uses AI and historical data to suggest optimal mission structures, recommend tools, estimate completion times, and assess risks before mission execution.

## Purpose

- **AI-powered planning** - Generate optimal mission plans from objectives
- **Tool recommendations** - Suggest best tools based on historical effectiveness
- **Time estimation** - Predict completion times with confidence intervals
- **Risk assessment** - Identify potential issues before they occur
- **Pattern matching** - Leverage known successful mission patterns

## Architecture

### Planning Flow

```
User Objective
    ↓
Pattern Matching → Known pattern? → Use pattern template
    ↓
No match
    ↓
Keyword Analysis → Infer tools
    ↓
Historical Analysis → Tool effectiveness scores
    ↓
Pipeline Generation → Tool sequence
    ↓
Risk Assessment → Identify risks
    ↓
Time Estimation → Duration prediction
    ↓
Complete Plan → Recommendations + Estimates + Risks
```

## MCP Tools

### generate_mission_plan
Generate a complete AI-powered mission plan.

**Input:**
```json
{
  "objective": "Process customer data CSV and generate monthly report",
  "orgId": 123,
  "considerHistory": true,
  "maxSuggestions": 5
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "objective": "Process customer data CSV and generate monthly report",
    "recommendedPipeline": ["file_read", "data_transform", "analysis", "content_generation", "export"],
    "toolRecommendations": [
      {
        "tool": "file_read",
        "score": 0.95,
        "reason": "Used in 95% of similar missions",
        "avgExecutionTime": 2000,
        "successRate": 0.98,
        "alternativeTools": ["http_get", "api_call"]
      }
    ],
    "estimatedCompletion": {
      "estimatedMinutes": 45,
      "confidenceInterval": { "min": 35, "max": 55 },
      "confidence": 0.82,
      "breakdown": [
        { "phase": "file_read", "estimatedMinutes": 5, "toolCalls": 1 },
        { "phase": "data_transform", "estimatedMinutes": 12, "toolCalls": 2 },
        { "phase": "analysis", "estimatedMinutes": 15, "toolCalls": 3 },
        { "phase": "content_generation", "estimatedMinutes": 8, "toolCalls": 1 },
        { "phase": "export", "estimatedMinutes": 5, "toolCalls": 1 }
      ]
    },
    "riskAssessment": {
      "overallRisk": "medium",
      "score": 35,
      "factors": [
        {
          "factor": "large_file_size",
          "severity": "medium",
          "probability": 0.3,
          "mitigation": "Consider chunked processing for files >100MB"
        }
      ],
      "estimatedSuccessRate": 0.85
    },
    "similarMissions": [
      {
        "missionId": 45,
        "name": "Q3 Customer Analysis",
        "similarity": 0.85,
        "outcome": "succeeded"
      }
    ],
    "suggestions": [
      "Consider breaking into smaller missions if file is very large",
      "Add validation step after data transformation"
    ]
  }
}
```

### get_mission_patterns
Get known mission patterns for common use cases.

**Output:**
```json
{
  "success": true,
  "data": {
    "patterns": [
      {
        "id": "pattern_data_processing",
        "name": "Data Processing Pipeline",
        "objectivePattern": "process|transform|analyze.*data",
        "pipelineSequence": ["file_read", "data_transform", "analysis", "file_write"],
        "estimatedDuration": 45,
        "successRate": 0.85,
        "avgToolCalls": 12,
        "commonTools": [
          { "tool": "file_read", "frequency": 0.95 },
          { "tool": "data_transform", "frequency": 0.80 }
        ],
        "riskFactors": ["large_file_size", "complex_transformations"],
        "metadata": {
          "sampleSize": 150,
          "confidence": 0.82
        }
      }
    ],
    "total": 3
  }
}
```

### get_tool_recommendations
Get AI-recommended tools for a mission objective.

**Input:**
```json
{
  "objective": "Generate API documentation from codebase"
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "recommendations": [
      {
        "tool": "code_analysis",
        "score": 0.92,
        "reason": "Suggested based on objective keywords",
        "avgExecutionTime": 3500,
        "successRate": 0.88,
        "alternativeTools": ["file_scan", "ast_parse"]
      }
    ],
    "total": 5,
    "topRecommendation": { ... }
  }
}
```

### estimate_mission_completion
Estimate completion time for a specific pipeline.

**Input:**
```json
{
  "objective": "Generate sales report",
  "pipeline": ["file_read", "data_transform", "analysis", "export"]
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "estimatedMinutes": 38,
    "confidenceInterval": { "min": 30, "max": 46 },
    "confidence": 0.78,
    "breakdown": [
      { "phase": "file_read", "estimatedMinutes": 5, "toolCalls": 1 },
      { "phase": "data_transform", "estimatedMinutes": 10, "toolCalls": 2 },
      { "phase": "analysis", "estimatedMinutes": 15, "toolCalls": 3 },
      { "phase": "export", "estimatedMinutes": 8, "toolCalls": 1 }
    ]
  }
}
```

### assess_mission_risk
Assess risk factors for a mission.

**Input:**
```json
{
  "objective": "Deploy microservices to production with database migration",
  "pipeline": ["validate", "backup", "migrate", "deploy", "verify"]
}
```

**Output:**
```json
{
  "success": true,
  "data": {
    "overallRisk": "high",
    "score": 65,
    "factors": [
      {
        "factor": "External dependency: deploy",
        "severity": "medium",
        "probability": 0.25,
        "mitigation": "Use circuit breaker and retry mechanisms"
      },
      {
        "factor": "High complexity",
        "severity": "high",
        "probability": 0.4,
        "mitigation": "Consider breaking into smaller missions"
      }
    ],
    "estimatedSuccessRate": 0.65
  }
}
```

### find_similar_missions
Find historically similar missions.

**Input:**
```json
{
  "objective": "Process monthly sales data",
  "orgId": 123,
  "limit": 5
}
```

## Usage

### Generate Complete Plan

```typescript
import { predictivePlanningService } from "./predictive-planning.service.js";

const plan = await predictivePlanningService.generatePlan(
    "Process customer feedback CSV and generate insights report",
    {
        orgId: 123,
        considerHistory: true,
        maxSuggestions: 5,
    }
);

console.log(`Estimated time: ${plan.estimatedCompletion.estimatedMinutes} minutes`);
console.log(`Risk level: ${plan.riskAssessment.overallRisk}`);
console.log(`Recommended tools: ${plan.toolRecommendations.map(r => r.tool).join(', ')}`);
```

### Get Tool Recommendations

```typescript
const recommendations = await predictivePlanningService.recommendTools(
    "Generate API documentation from code"
);

for (const rec of recommendations) {
    console.log(`${rec.tool}: ${rec.score} - ${rec.reason}`);
}
```

### Match Against Patterns

```typescript
const pattern = predictivePlanningService.matchPattern("Process CSV data");

if (pattern) {
    console.log(`Using pattern: ${pattern.name}`);
    console.log(`Expected pipeline: ${pattern.pipelineSequence.join(' → ')}`);
}
```

### Estimate Completion

```typescript
const estimate = predictivePlanningService.estimateCompletion(
    "Generate report",
    ["file_read", "data_transform", "analysis", "export"],
    matchedPattern
);

console.log(`Best case: ${estimate.confidenceInterval.min} min`);
console.log(`Worst case: ${estimate.confidenceInterval.max} min`);
console.log(`Confidence: ${Math.round(estimate.confidence * 100)}%`);
```

### Assess Risk

```typescript
const risk = predictivePlanningService.assessRisk(
    "Deploy production system",
    ["validate", "backup", "deploy", "verify"]
);

if (risk.overallRisk === 'high') {
    console.log('⚠️ High risk mission!');
    for (const factor of risk.factors) {
        console.log(`- ${factor.factor}: ${factor.mitigation}`);
    }
}
```

## Mission Patterns

Built-in patterns for common use cases:

### Data Processing Pipeline
- **Matches**: "process", "transform", "analyze data"
- **Tools**: file_read → data_transform → analysis → file_write
- **Duration**: ~45 minutes
- **Success Rate**: 85%

### API Integration Workflow
- **Matches**: "integrate", "connect", "API", "endpoint"
- **Tools**: api_auth → api_call → data_mapping → validation
- **Duration**: ~60 minutes
- **Success Rate**: 72%

### Document Generation
- **Matches**: "generate", "create doc", "report", "PDF"
- **Tools**: data_gather → content_generation → formatting → export
- **Duration**: ~30 minutes
- **Success Rate**: 91%

## Risk Factors

### Detected Automatically
- Large file sizes
- Complex transformations
- External API dependencies
- Multiple integration points
- Time-sensitive requirements
- Novel/untested approaches

### Risk Scoring
- **0-25**: Low risk
- **26-50**: Medium risk
- **51-75**: High risk
- **76-100**: Critical risk

## Time Estimation

### Factors Affecting Estimates
- Number of tools in pipeline
- Historical data from similar missions
- Objective complexity indicators
- Pattern confidence levels
- Tool execution times

### Confidence Intervals
Estimates include min/max bounds based on:
- Historical variance
- Pattern confidence
- Complexity multipliers
- Tool reliability

## Historical Data

### Tool Effectiveness Scoring
Based on:
- Success rate (0-1)
- Average execution time
- Frequency of use in similar missions
- User feedback scores

### Learning from History
The system improves through:
- Mission outcome tracking
- Tool effectiveness updates
- Pattern refinement
- Success rate adjustments

## Testing

Test file: `server/domain/mission/tests/predictive-planning.service.test.ts`

```bash
npm test -- predictive-planning.service.test.ts
```

### Manual Testing

```typescript
// Test pattern matching
const pattern = predictivePlanningService.matchPattern("Process CSV data");
console.log(pattern?.name); // "Data Processing Pipeline"

// Test tool recommendations
const tools = await predictivePlanningService.recommendTools("API integration");
console.log(tools[0].tool); // "api_call"

// Test risk assessment
const risk = predictivePlanningService.assessRisk("Simple file read", ["file_read"]);
console.log(risk.overallRisk); // "low"
```

## Best Practices

1. **Use specific objectives** - "Process customer CSV" > "Do something with data"
2. **Consider history** - Similar past missions improve recommendations
3. **Review risk factors** - Address mitigations before starting
4. **Validate estimates** - Compare predictions with actuals
5. **Learn from outcomes** - Feed results back to improve models

## Future Enhancements

- [ ] ML model training on mission outcomes
- [ ] Real-time estimate adjustments during execution
- [ ] Cost estimation (tokens, API calls, etc.)
- [ ] Collaborative filtering (what similar orgs do)
- [ ] A/B testing for planning strategies
- [ ] Integration with external analytics
- [ ] Custom pattern creation UI
- [ ] Predictive failure detection
