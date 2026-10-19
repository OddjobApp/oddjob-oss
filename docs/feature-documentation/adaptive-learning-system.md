# Adaptive Learning System

## Overview

The Adaptive Learning System enables Oddjob to continuously improve based on real-world usage. It tracks component effectiveness, evolves prompts based on performance, clusters failures for prevention, and builds organization-specific profiles for personalized AI behavior.

## Core Capabilities

### 1. Component Success Tracking

**What it does:**
- Tracks which UI components work best in different contexts
- Records component pairings that succeed together
- Measures deployment success and runtime errors per component
- Builds recommendations for what components to use

**Key Tables:**
- `component_usage_records` — Individual component usages
- `component_effectiveness_aggregates` — Pre-computed statistics

**Usage:**
```typescript
// Track a component usage
await adaptiveLearningService.trackComponentUsage({
  organizationId: 1,
  appId: 42,
  componentName: "DataTable",
  componentCategory: "ui-data-viz",
  usedInFile: "pages/dashboard.tsx",
  deploymentSuccess: true,
});

// Get top recommendations
const topComponents = await adaptiveLearningService.getTopComponents(
  organizationId, 
  "ui-data-viz", 
  10
);
```

### 2. Prompt Evolution

**What it does:**
- Maintains multiple versions of system prompts
- Tracks performance metrics for each version
- Uses evolutionary selection to prefer high-performing prompts
- Supports A/B testing of prompt variants
- Auto-generates new variants through LLM mutation

**Key Tables:**
- `prompt_versions` — All prompt variants with fitness scores
- `prompt_ab_tests` — Formal A/B experiments
- `prompt_performance_logs` — Individual usage records

**Usage:**
```typescript
// Select best prompt for context
const version = await adaptiveLearningService.selectPromptVersion(
  organizationId,
  "code-generation",
  false // allowExperimental?
);

// Record performance
await adaptiveLearningService.logPromptPerformance({
  organizationId,
  promptVersionId: versionId,
  success: true,
  tokensUsed: 1500,
  costUsd: 0.05,
  outputQualityScore: 85,
});
```

### 3. Failure Mode Clustering

**What it does:**
- Records all failures with context
- Automatically clusters similar failures together
- Identifies recurring issues
- Creates prevention rules to avoid repeat failures
- Tracks effectiveness of prevention rules

**Key Tables:**
- `failure_incidents` — Individual failure records
- `failure_clusters` — Grouped failure patterns
- `prevention_rules` — Active prevention strategies

**Usage:**
```typescript
// Record a failure
const result = await adaptiveLearningService.recordFailure({
  organizationId,
  domain: "code-generation",
  severity: "medium",
  errorMessage: "Null pointer exception in DataTable",
  componentName: "DataTable",
  appId: 42,
});

// Get active prevention rules
const rules = await adaptiveLearningService.getActivePreventionRules(
  organizationId,
  "code-generation"
);
```

### 4. Organization Learning Profiles

**What it does:**
- Builds a profile per organization based on usage patterns
- Learns communication preferences (concise vs detailed)
- Tracks preferred UI libraries and patterns
- Identifies successful patterns specific to the org
- Avoids patterns that have caused issues

**Key Tables:**
- `org_learning_profiles` — Organization preferences
- `org_preference_events` — Raw learning events
- `cross_org_insights` — Anonymized patterns across orgs

**Usage:**
```typescript
// Get personalized context
const context = await adaptiveLearningService.getPersonalizedContext(organizationId);

// Generate personalized prompt
const personalizedPrompt = generatePersonalizedPromptContext(context);
```

## Integration Points

### App Studio / App Forge

The App Forge tracker (`app-forge-tracker.ts`) automatically:
1. **On code generation:** Parses generated files and tracks component usage
2. **On deployment:** Records build success/failure metrics
3. **On runtime errors:** Captures and categorizes errors
4. **On user feedback:** Records accept/reject/modify actions
5. **On mission completion:** Extracts success patterns

```typescript
import { 
  analyzeAppComponents,
  recordDeploymentSuccess,
  recordRuntimeError,
  recordCodeFeedback,
} from "@domain/learning/integrations/app-forge-tracker.js";

// In app builder service
await analyzeAppComponents(appId, orgId, generatedFiles);

// In deployment pipeline
await recordDeploymentSuccess(appId, orgId, deploymentMetrics);
```

### Frontend Hook

```typescript
import { 
  useTopComponents,
  usePersonalizedPrompt,
  useOrgProfile,
} from "@domain/learning/hooks/use-adaptive-learning";

function CodeGenerator() {
  const { enhancePrompt } = usePersonalizedPrompt();
  
  const generate = async () => {
    const basePrompt = "Generate a dashboard...";
    const personalized = enhancePrompt(basePrompt);
    
    // Send personalized prompt to AI
    const result = await generateCode(personalized);
  };
}
```

## API Endpoints

### Component Tracking
- `GET /api/learning/components/top?category=&limit=` — Get recommended components
- `GET /api/learning/components/:name/pairings` — Get suggested pairings

### Failure Analysis
- `GET /api/learning/failures/clusters?domain=` — View failure clusters
- `GET /api/learning/failures/prevention-rules` — Active prevention rules

### Organization Profile
- `GET /api/learning/profile` — Get org learning profile
- `POST /api/learning/profile` — Update profile settings
- `GET /api/learning/personalized-context` — Get AI prompt context

### Prompt Evolution (Admin)
- `GET /api/learning/prompts?type=` — View prompt versions
- `POST /api/learning/prompts/:versionId/activate` — Activate a version

## Configuration

Organizations can control learning behavior via their profile:

| Setting | Default | Description |
|---------|---------|-------------|
| `learningEnabled` | `true` | Enable/disable all learning |
| `autoApplyLearnings` | `false` | Auto-update prompts without approval |
| `allowCrossOrgLearning` | `false` | Learn from anonymized other orgs |
| `communicationStyle` | `"balanced"` | Preferred communication style |

## Data Privacy

- All cross-org insights are anonymized
- PII is redacted from learning events
- Organizations can opt out of learning entirely
- Prevention rules are org-specific

## Future Extensions

1. **Real-time Prompt Injection:** Automatically inject learned context into all AI calls
2. **Visual Pattern Library:** Show most effective component combinations in UI
3. **Auto-remediation:** Suggest fixes based on similar past failures
4. **Cross-org Benchmarking:** Compare your patterns to industry averages

## Schema Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    COMPONENT TRACKING                       │
├─────────────────────────────────────────────────────────────┤
│ component_usage_records ───────┬──► component_effectiveness │
│   - component usage events     │     _aggregates             │
│   - success metrics            │     - pre-computed stats    │
│   - deployment tracking        │     - trends               │
└────────────────────────────────┼────────────────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────┐
│                    PROMPT EVOLUTION                         │
├────────────────────────────────┼────────────────────────────┤
│ prompt_versions ◄─────────────┼──── prompt_performance_logs│
│   - fitness scores             │     - individual usages    │
│   - selection probability      │     - success/failure      │
│   - evolution history          │                            │
└────────────────────────────────┼────────────────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────┐
│                   FAILURE CLUSTERING                        │
├────────────────────────────────┼────────────────────────────┤
│ failure_incidents ─────────────┼──► failure_clusters         │
│   - individual failures        │     - grouped patterns     │
│   - context                    │     - root cause analysis  │
└────────────────────────────────┼──► prevention_rules         │
                                   │   - active mitigations   │
                                   └──────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 ORGANIZATION PROFILES                         │
├─────────────────────────────────────────────────────────────┤
│ org_learning_profiles ◄── org_preference_events             │
│   - learned preferences      - raw events                   │
│   - communication style      - explicit/implicit feedback   │
│   - technical preferences                                   │
└─────────────────────────────────────────────────────────────┘
```
