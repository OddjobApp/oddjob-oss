# Phase 3: Advanced Job-Tools Integration (Comprehensive)

## Overview

Building on Phases 1 and 2, Phase 3 creates a bidirectional, intelligent, and observable job-tools ecosystem. This enables seamless conversion between Jobs and Tools, intelligent discovery, and deep analytics.

## Components

### 1. Dynamic Schema Generation
**Goal**: Auto-generate tool parameter schemas from job config schemas

**Implementation**:
```typescript
// server/domain/tools/v1/schema-generator.service.ts
export class SchemaGenerator {
  /**
   * Convert Zod job config schema to tool parameter schema
   */
  static generateFromJobConfig(
    jobType: string, 
    configSchema: z.ZodSchema
  ): z.ZodSchema {
    // Extract shape from config schema
    // Add descriptions from JOB_SCHEMAS metadata
    // Handle optional vs required fields
    // Transform job-specific fields to tool-friendly names
  }
}
```

**Key Features**:
- Parse Zod schemas at runtime
- Extract field types, descriptions, defaults
- Handle nested objects and arrays
- Support discriminated unions (e.g., different auth types)
- Cache generated schemas for performance

**Files to Modify**:
- `@server/domain/tools/v1/schema-generator.service.ts` (new)
- `@server/domain/tools/v1/job-to-tool-mapper.ts` (integrate)
- `@server/config/jobs/schemas.ts` (add metadata)

---

### 2. Tool Composition System
**Goal**: Chain multiple jobs into composite tools

**Implementation**:
```typescript
// server/domain/tools/v1/tool-composition.service.ts
export interface CompositeTool {
  name: string;
  description: string;
  steps: Array<{
    jobId: number;
    inputMapping: Record<string, string>; // Map previous outputs to next inputs
    condition?: string; // Conditional execution
  }>;
  parallel?: boolean; // Execute steps in parallel
}

export class ToolCompositionService {
  /**
   * Execute a composite tool by running jobs in sequence
   */
  async executeComposite(
    composite: CompositeTool,
    initialInput: any,
    context: ToolContext
  ): Promise<any> { }
  
  /**
   * Create composite from natural language description
   */
  async synthesizeFromDescription(
    description: string,
    availableJobs: Job[]
  ): Promise<CompositeTool> { }
}
```

**Use Cases**:
- "Fetch data from API, transform it, save to database" (curl → transformer → sql_query)
- "Scrape website, extract entities, notify team" (selenium → transformer → slack_post)
- "Run analysis and email report" (python → email_send)

**Key Features**:
- Visual pipeline builder for composites
- Data mapping between steps
- Error handling (stop vs continue on failure)
- Parallel execution where safe
- Conditional branching

---

### 3. Job Discovery & Capability Matching
**Goal**: Let agents discover and select jobs by capability, not just name

**Implementation**:
```typescript
// server/domain/tools/v1/job-discovery.service.ts
export interface JobCapability {
  category: string;           // "http", "database", "ai", "automation"
  actions: string[];        // ["read", "write", "delete", "transform"]
  inputTypes: string[];     // ["json", "csv", "sql"]
  outputTypes: string[];    // ["json", "text", "file"]
  sideEffects: boolean;     // Does it mutate external state?
  authentication: boolean;  // Does it need credentials?
}

export class JobDiscoveryService {
  /**
   * Index all jobs by their capabilities
   */
  async indexJobs(organizationId: number): Promise<void> { }
  
  /**
   * Find jobs matching capability requirements
   */
  async findByCapability(
    requirements: Partial<JobCapability>,
    options: { limit?: number; matchThreshold?: number }
  ): Promise<Array<Job & { matchScore: number }>> { }
  
  /**
   * Natural language job search
   */
  async semanticSearch(
    query: string,
    organizationId: number
  ): Promise<Array<Job & { relevance: number }>> { }
  
  /**
   * Suggest jobs based on current context
   */
  async suggestForContext(
    context: {
      currentJobType?: string;
      previousOutput?: any;
      goal: string;
    },
    organizationId: number
  ): Promise<Job[]> { }
}
```

**MCP Tools to Add**:
- `search_jobs_by_capability` - Capability-based search
- `find_job_for_task` - Natural language matching
- `get_job_capabilities` - Get capability metadata for a job
- `suggest_next_job` - Contextual suggestions

---

### 4. Tool Usage Analytics & Insights
**Goal**: Track, analyze, and optimize tool usage patterns

**Implementation**:
```typescript
// server/domain/tools/v1/tool-analytics.service.ts
export interface ToolUsageMetrics {
  jobId: number;
  toolName: string;
  totalInvocations: number;
  successRate: number;
  avgExecutionTime: number;
  commonInputs: Array<{ field: string; sampleValues: any[] }>;
  commonErrors: Array<{ error: string; count: number; lastOccurred: Date }>;
  peakUsageHours: number[];
  usedByAgents: string[];
}

export class ToolAnalyticsService {
  /**
   * Record tool invocation
   */
  async recordInvocation(
    jobId: number,
    params: any,
    result: any,
    metadata: {
      agentId?: string;
      missionId?: number;
      executionTimeMs: number;
      success: boolean;
      error?: string;
    }
  ): Promise<void> { }
  
  /**
   * Get usage metrics for a job
   */
  async getMetrics(
    jobId: number,
    timeRange: { start: Date; end: Date }
  ): Promise<ToolUsageMetrics> { }
  
  /**
   * Get organization-wide analytics
   */
  async getOrganizationAnalytics(
    organizationId: number,
    options: {
      groupBy?: 'job' | 'category' | 'agent';
      topN?: number;
    }
  ): Promise<any> { }
  
  /**
   * Generate optimization recommendations
   */
  async generateRecommendations(
    jobId: number
  ): Promise<Array<{
    type: 'performance' | 'reliability' | 'usability';
    severity: 'low' | 'medium' | 'high';
    description: string;
    suggestedAction: string;
  }>> { }
}
```

**Dashboard Components**:
- Tool popularity rankings
- Success/failure rate trends
- Common parameter patterns
- Agent usage patterns
- Performance bottlenecks
- Error hotspots

---

### 5. Bidirectional Job ↔ Tool Bridge
**Goal**: Seamless conversion between Job definitions and Tool definitions

**Implementation**:
```typescript
// server/domain/tools/v1/job-tool-bridge.service.ts
export class JobToolBridge {
  /**
   * Convert a Job to a Tool (existing, enhanced)
   */
  static jobToTool(job: Job): ToolDefinition {
    // Use JobToToolMapper (from Phase 2)
    // Add dynamic schema generation (from component #1)
  }
  
  /**
   * Convert a Tool back to a Job template
   */
  static toolToJob(tool: ToolDefinition, options: {
    organizationId: number;
    category: JobType;
    name?: string;
  }): Partial<InsertJob> {
    // Infer job type from tool parameters
    // Generate default config from parameter schema
    // Create job template ready for customization
  }
  
  /**
   * Sync changes between Job and its Tool representation
   */
  static syncJobToTool(
    job: Job,
    existingTool?: ToolDefinition
  ): { updated: boolean; changes: string[] } {
    // Detect config changes
    // Update tool schema if needed
    // Track version changes
  }
  
  /**
   * Get all tools exposed from jobs in an organization
   */
  static async getExposedTools(
    organizationId: number,
    options: { includePrivate?: boolean; category?: string }
  ): Promise<ToolDefinition[]> { }
}
```

**Features**:
- Tool → Job: "I found this cool tool, make it a reusable job"
- Job → Tool: Expose any job as an agent-usable tool
- Auto-sync: When job config changes, update exposed tool
- Versioning: Track tool versions as jobs evolve

---

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent / MCP Layer                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Tool Interface Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Tool       │  │   Tool       │  │   Composite      │  │
│  │   Registry   │  │   Composition│  │   Tools          │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Bidirectional Bridge                        │
│         JobToolBridge ↔ JobToToolMapper                     │
│         SchemaGenerator (dynamic schemas)                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Job Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Job        │  │   Job        │  │   Job            │  │
│  │   Discovery  │  │   Executor   │  │   Registry       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Analytics & Insights                        │
│         ToolAnalyticsService + Dashboard                     │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Order

### Sprint 1: Foundation (Week 1)
1. Create `SchemaGenerator` service
2. Integrate with existing `JobToToolMapper`
3. Add unit tests for schema generation

### Sprint 2: Composition (Week 2)
1. Create `ToolCompositionService`
2. Build composite tool execution engine
3. Add MCP tools for composition management
4. Create visual composition builder (optional UI)

### Sprint 3: Discovery (Week 3)
1. Create `JobDiscoveryService`
2. Build capability indexing system
3. Implement semantic search
4. Add discovery MCP tools

### Sprint 4: Analytics (Week 4)
1. Create `ToolAnalyticsService`
2. Add instrumentation to tool execution
3. Build analytics dashboard
4. Generate recommendations

### Sprint 5: Bidirectional Bridge (Week 5)
1. Complete `JobToolBridge` implementation
2. Add tool-to-job conversion
3. Implement sync detection
4. Add versioning support

## Files to Create/Modify

### New Files:
```
server/domain/tools/v1/schema-generator.service.ts
server/domain/tools/v1/tool-composition.service.ts
server/domain/tools/v1/job-discovery.service.ts
server/domain/tools/v1/tool-analytics.service.ts
server/domain/tools/v1/job-tool-bridge.service.ts
server/domain/tools/v1/tests/schema-generator.test.ts
server/domain/tools/v1/tests/tool-composition.test.ts
server/domain/tools/v1/tests/job-discovery.test.ts
server/domain/tools/v1/tests/tool-analytics.test.ts
server/domain/tools/v1/tests/job-tool-bridge.test.ts
server/domain/tools/v1/handlers/composition-handlers.ts
server/domain/tools/v1/handlers/discovery-handlers.ts
server/domain/tools/v1/handlers/analytics-handlers.ts
docs/PHASE3_IMPLEMENTATION_GUIDE.md
```

### Modified Files:
```
server/domain/tools/v1/job-to-tool-mapper.ts (integrate SchemaGenerator)
server/domain/tools/v1/tool-executor.service.ts (add analytics instrumentation)
server/domain/tools/v1/tool-registry.service.ts (add discovery integration)
server/config/jobs/schemas.ts (add capability metadata)
shared/schema/jobs/types.ts (add capability types)
```

## Success Metrics

1. **Schema Coverage**: 100% of job types have dynamic schema support
2. **Composite Tools**: Support for 10+ step compositions
3. **Discovery Accuracy**: 90%+ relevance for semantic job search
4. **Analytics Coverage**: 100% of tool invocations tracked
5. **Conversion Success**: 95%+ success rate for tool↔job conversion

## Migration Notes

- Phase 3 is additive - existing Phase 1 & 2 functionality remains
- Analytics service can be enabled gradually (opt-in per org)
- Discovery indexing runs as background job
- Bidirectional bridge has no breaking changes
