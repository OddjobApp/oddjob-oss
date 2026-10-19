# Domain Jobs Enhancement Implementation Plan

**Version:** 1.0  
**Date:** May 25, 2026  
**Scope:** Detailed implementation steps for domain jobs enhancement recommendations

---

## Table of Contents

1. [Phase 1: Performance Optimizations](#phase-1-performance-optimizations)
2. [Phase 2: Architecture Improvements](#phase-2-architecture-improvements)
3. [Phase 3: Developer Experience](#phase-3-developer-experience)
4. [Phase 4: AI & Synthesis Enhancements](#phase-4-ai--synthesis-enhancements)
5. [Phase 5: Monitoring & Observability](#phase-5-monitoring--observability)
6. [Technical Debt Cleanup](#technical-debt-cleanup)
7. [Testing Strategy](#testing-strategy)
8. [Rollback Plan](#rollback-plan)

---

## Phase 1: Performance Optimizations

**Timeline:** 1-2 weeks  
**Risk Level:** Medium  
**Dependencies:** None

### 1.1 Supervisor Job Executor - Event-Based Triggers

**File:** `server/domain/jobs/core/executors/supervisor-job-executor.ts`  
**Current TODO:** Line 409

#### Problem Statement
The supervisor executor uses a polling loop with sleep intervals to check sub-task status, which:
- Increases latency between task completion and supervisor awareness
- Consumes unnecessary CPU resources
- Doesn't scale well with many concurrent supervisor jobs
- Creates unnecessary database load from repeated status checks

#### Solution Architecture

**Event-Driven Flow:**
```
Sub-Task Executor → Event Emitter → Redis Pub/Sub → Supervisor Event Listener → Resume Execution
```

**Components:**
1. **Event Channel Service** - Extend `streamingLogsService` for custom events
2. **Task Completion Emitter** - Hook into executor completion
3. **Supervisor Event Subscription** - Replace polling with event listeners
4. **Fallback Mechanism** - Maintain polling as backup

#### Implementation Steps

**Step 1.1.1: Extend StreamingLogsService for Custom Events**
- **File:** `server/domain/jobs/core/streaming-logs.service.ts`
- **Changes:**
  ```typescript
  // Add custom event channel support
  async createEventChannel(channelId: string, metadata?: any): Promise<void>
  async emitEvent(channelId: string, eventType: string, data: any): Promise<void>
  async subscribeToEvents(channelId: string, eventTypes: string[], callback: Function): Promise<() => void>
  ```
- **Testing:** Unit tests for event emission and subscription
- **Risk:** Low - additive changes to existing service

**Step 1.1.2: Add Task Completion Event Emission**
- **File:** `server/core/pipeline-step-runner.ts`
- **Changes:**
  ```typescript
  // After step completion, emit event if supervisor is waiting
  if (context.supervisorChannelId) {
    await streamingLogsService.emitEvent(
      context.supervisorChannelId,
      'task_completed',
      { stepId, status, output, timestamp }
    );
  }
  ```
- **Testing:** Integration test with mock supervisor
- **Risk:** Medium - affects core pipeline execution

**Step 1.1.3: Modify Supervisor to Use Event Listeners**
- **File:** `server/domain/jobs/core/executors/supervisor-job-executor.ts`
- **Changes:**
  ```typescript
  // Replace polling loop with event subscription
  const unsubscribe = await streamingLogsService.subscribeToEvents(
    supervisorChannelId,
    ['task_completed', 'task_failed'],
    (event) => {
      // Update plan state based on event
      // Resume execution if all dependencies met
    }
  );
  
  // Set timeout for fallback to polling
  const fallbackTimeout = setTimeout(() => {
    unsubscribe();
    // Fall back to polling if no events received
  }, 30000); // 30 second fallback
  ```
- **Testing:** End-to-end test with real sub-tasks
- **Risk:** High - core executor logic change

**Step 1.1.4: Add Fallback Mechanism**
- **File:** `server/domain/jobs/core/executors/supervisor-job-executor.ts`
- **Changes:**
  ```typescript
  // If event subscription fails or times out, fall back to polling
  async executeWithFallback() {
    try {
      return await this.executeEventDriven();
    } catch (error) {
      logger.warn('Event-driven execution failed, falling back to polling', error);
      return await this.executePolling();
    }
  }
  ```
- **Testing:** Test fallback scenarios (network failure, timeout)
- **Risk:** Low - safety mechanism

**Step 1.1.5: Add Configuration Toggle**
- **File:** `server/config/jobs/supervisor.config.ts`
- **Changes:**
  ```typescript
  export const SUPERVISOR_CONFIG = {
    useEventDriven: process.env.SUPERVISOR_EVENT_DRIVEN === 'true',
    eventTimeoutMs: 30000,
    pollingFallbackEnabled: true,
  };
  ```
- **Testing:** Test with both configurations
- **Risk:** Low - configuration only

#### Success Criteria
- 50% reduction in supervisor job polling overhead
- Sub-task completion detected within 100ms (vs 5s polling interval)
- No increase in failed supervisor jobs
- Fallback mechanism tested and working

#### Rollback Plan
- Feature flag to disable event-driven mode
- Revert to polling by setting environment variable
- Database migration not required

---

### 1.2 Google Drive Sync - Parallel Processing

**File:** `server/domain/jobs/core/executors/google-drive-sync-executor.ts`  
**Current TODO:** Line 71

#### Problem Statement
The Google Drive sync executor processes folders sequentially, which:
- Is slow for large folder structures
- Doesn't utilize available concurrency
- Blocks on slow individual folders
- No progress visibility during long syncs

#### Solution Architecture

**Parallel Processing Flow:**
```
Folder List → Worker Pool (concurrency: N) → Progress Aggregator → Final Report
```

**Components:**
1. **Worker Pool** - Configurable concurrency with queue
2. **Progress Reporter** - Per-folder progress via streaming logs
3. **Checkpoint System** - Resume capability for interrupted syncs
4. **Rate Limiter** - API quota management

#### Implementation Steps

**Step 1.2.1: Create Worker Pool Utility**
- **File:** `server/domain/jobs/core/utils/worker-pool.ts`
- **Changes:**
  ```typescript
  export class WorkerPool<T, R> {
    constructor(
      private concurrency: number,
      private worker: (item: T) => Promise<R>
    ) {}
    
    async execute(items: T[]): Promise<R[]> {
      // Process items with concurrency limit
      // Return results in original order
    }
    
    async executeWithProgress(
      items: T[],
      onProgress: (completed: number, total: number, item: T) => void
    ): Promise<R[]> {
      // Execute with progress callbacks
    }
  }
  ```
- **Testing:** Unit tests for concurrency, error handling, ordering
- **Risk:** Low - new utility

**Step 1.2.2: Integrate Worker Pool into Google Drive Sync**
- **File:** `server/domain/jobs/core/executors/google-drive-sync-executor.ts`
- **Changes:**
  ```typescript
  // Replace sequential loop with worker pool
  const workerPool = new WorkerPool(
    config.concurrency || 5, // Default 5 concurrent folders
    async (folderId) => {
      return await this.syncFolder(folderId, client, config);
    }
  );
  
  const results = await workerPool.executeWithProgress(
    foldersToSync,
    (completed, total, folderId) => {
      streamingLogsService.logProgress(jobId, jobRunId, (completed / total) * 100);
    }
  );
  ```
- **Testing:** Integration test with real Google Drive (mocked)
- **Risk:** Medium - core executor change

**Step 1.2.3: Add Per-Folder Progress Reporting**
- **File:** `server/domain/jobs/core/executors/google-drive-sync-executor.ts`
- **Changes:**
  ```typescript
  async syncFolder(folderId: string, client: any, config: any) {
    const folderStart = Date.now();
    
    // Log folder start
    await streamingLogsService.log({
      jobId, jobRunId,
      message: `Processing folder: ${folderId}`,
      logType: 'folder_start',
      metadata: { folderId }
    });
    
    // Process files in folder
    const fileCount = await this.processFiles(folderId, client, config);
    
    // Log folder completion
    await streamingLogsService.log({
      jobId, jobRunId,
      message: `Completed folder: ${folderId} (${fileCount} files)`,
      logType: 'folder_complete',
      metadata: { folderId, fileCount, duration: Date.now() - folderStart }
    });
  }
  ```
- **Testing:** Verify progress logs appear in streaming output
- **Risk:** Low - additive logging

**Step 1.2.4: Implement Checkpoint/Resume**
- **File:** `server/domain/jobs/core/executors/google-drive-sync-executor.ts`
- **Changes:**
  ```typescript
  interface SyncCheckpoint {
    jobId: number;
    jobRunId: number;
    completedFolders: string[];
    failedFolders: string[];
    timestamp: Date;
  }
  
  async saveCheckpoint(checkpoint: SyncCheckpoint) {
    // Save to database or Redis
    await redis.setex(
      `sync_checkpoint:${jobId}:${jobRunId}`,
      3600, // 1 hour TTL
      JSON.stringify(checkpoint)
    );
  }
  
  async loadCheckpoint(jobId: number, jobRunId: number): Promise<SyncCheckpoint | null> {
    const data = await redis.get(`sync_checkpoint:${jobId}:${jobRunId}`);
    return data ? JSON.parse(data) : null;
  }
  
  async syncFolders(folders: string[], config: any) {
    // Check for existing checkpoint
    const checkpoint = await this.loadCheckpoint(jobId, jobRunId);
    
    // Filter out already completed folders
    const remainingFolders = checkpoint 
      ? folders.filter(f => !checkpoint.completedFolders.includes(f))
      : folders;
    
    // Process remaining folders
    // Save checkpoint after each folder completion
  }
  ```
- **Testing:** Test resume after interruption
- **Risk:** Medium - adds state management

**Step 1.2.5: Add Rate Limiting**
- **File:** `server/domain/jobs/core/utils/rate-limiter.ts`
- **Changes:**
  ```typescript
  export class RateLimiter {
    private tokens: number;
    private lastRefill: Date;
    
    constructor(
      private rate: number, // requests per second
      private burst: number // max burst
    ) {
      this.tokens = burst;
      this.lastRefill = new Date();
    }
    
    async acquire(): Promise<void> {
      // Token bucket algorithm
      // Wait if rate limit exceeded
    }
  }
  
  // Integrate into file processing
  const rateLimiter = new RateLimiter(10, 50); // 10 req/s, burst 50
  await rateLimiter.acquire();
  await client.getFile(fileId);
  ```
- **Testing:** Test rate limiting with mock API
- **Risk:** Low - new utility

**Step 1.2.6: Add Cancellation Support**
- **File:** `server/domain/jobs/core/executors/google-drive-sync-executor.ts`
- **Changes:**
  ```typescript
  private cancellationRequested = false;
  
  async execute(job: Job, config: any, context: any) {
    // Listen for cancellation event
    const cancelChannel = `job_cancel:${jobId}`;
    const unsubscribe = streamingLogsService.subscribeToEvents(
      cancelChannel,
      ['cancel'],
      () => {
        this.cancellationRequested = true;
      }
    );
    
    // Check cancellation in worker
    const workerPool = new WorkerPool(concurrency, async (folderId) => {
      if (this.cancellationRequested) {
        throw new Error('Job cancelled');
      }
      return await this.syncFolder(folderId, client, config);
    });
    
    // Cleanup on completion
    unsubscribe();
  }
  ```
- **Testing:** Test cancellation mid-execution
- **Risk:** Medium - adds cancellation logic

#### Success Criteria
- 3x faster processing for 10+ folders
- Progress visible in real-time logs
- Resume works after interruption
- Rate limiting prevents API quota errors
- Cancellation stops execution within 5 seconds

#### Rollback Plan
- Feature flag to disable parallel processing
- Revert to sequential by setting concurrency to 1
- Database migration not required

---

### 1.3 Retry Policies and Circuit Breakers

**Files:** Multiple executor files  
**Risk Level:** Medium

#### Implementation Steps

**Step 1.3.1: Create Retry Policy Service**
- **File:** `server/domain/jobs/core/retry-policy.service.ts`
- **Changes:**
  ```typescript
  export interface RetryPolicy {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableErrors: string[];
  }
  
  export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
    api: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
    },
    database: {
      maxAttempts: 5,
      initialDelayMs: 500,
      maxDelayMs: 5000,
      backoffMultiplier: 1.5,
      retryableErrors: ['ConnectionError', 'TimeoutError'],
    },
  };
  
  export class RetryPolicyService {
    async executeWithRetry<T>(
      fn: () => Promise<T>,
      policy: RetryPolicy,
      context: string
    ): Promise<T> {
      let lastError: Error;
      for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error;
          if (!this.isRetryable(error, policy)) {
            throw error;
          }
          const delay = this.calculateDelay(attempt, policy);
          logger.warn(`Retry ${attempt}/${policy.maxAttempts} for ${context} after ${delay}ms`, error);
          await this.sleep(delay);
        }
      }
      throw lastError;
    }
  }
  ```
- **Testing:** Unit tests for retry logic, backoff calculation
- **Risk:** Low - new service

**Step 1.3.2: Create Circuit Breaker Service**
- **File:** `server/domain/jobs/core/circuit-breaker.service.ts`
- **Changes:**
  ```typescript
  export enum CircuitState {
    CLOSED = 'closed',
    OPEN = 'open',
    HALF_OPEN = 'half_open'
  }
  
  export class CircuitBreaker {
    private state = CircuitState.CLOSED;
    private failureCount = 0;
    private lastFailureTime: Date;
    private successCount = 0;
    
    constructor(
      private threshold: number,
      private timeoutMs: number,
      private halfOpenMaxCalls: number
    ) {}
    
    async execute<T>(fn: () => Promise<T>, service: string): Promise<T> {
      if (this.state === CircuitState.OPEN) {
        if (this.shouldAttemptReset()) {
          this.state = CircuitState.HALF_OPEN;
          this.successCount = 0;
        } else {
          throw new Error(`Circuit breaker OPEN for ${service}`);
        }
      }
      
      try {
        const result = await fn();
        this.onSuccess();
        return result;
      } catch (error) {
        this.onFailure();
        throw error;
      }
    }
    
    private onSuccess() {
      this.failureCount = 0;
      if (this.state === CircuitState.HALF_OPEN) {
        this.successCount++;
        if (this.successCount >= this.halfOpenMaxCalls) {
          this.state = CircuitState.CLOSED;
        }
      }
    }
    
    private onFailure() {
      this.failureCount++;
      this.lastFailureTime = new Date();
      if (this.failureCount >= this.threshold) {
        this.state = CircuitState.OPEN;
      }
    }
  }
  ```
- **Testing:** Unit tests for state transitions
- **Risk:** Low - new service

**Step 1.3.3: Integrate into API Executor**
- **File:** `server/domain/jobs/core/executors/api-executor.ts`
- **Changes:**
  ```typescript
  import { retryPolicyService } from '../retry-policy.service.js';
  import { circuitBreakerService } from '../circuit-breaker.service.js';
  
  async execute(job: Job, config: any, context: any) {
    const policy = DEFAULT_RETRY_POLICIES.api;
    const circuitBreaker = circuitBreakerService.getBreaker(
      config.url,
      5, // threshold
      60000, // 1 minute timeout
      3 // half-open max calls
    );
    
    return await circuitBreaker.execute(async () => {
      return await retryPolicyService.executeWithRetry(
        async () => {
          return await this.makeRequest(config);
        },
        policy,
        `API call to ${config.url}`
      );
    }, config.url);
  }
  ```
- **Testing:** Integration test with flaky API
- **Risk:** Medium - affects executor behavior

**Step 1.3.4: Add Circuit Breaker Dashboard**
- **File:** `server/domain/jobs/ui/components/CircuitBreakerStatus.tsx`
- **Changes:**
  ```typescript
  // Display circuit breaker states for all services
  // Allow manual reset
  // Show failure history
  ```
- **Testing:** UI component tests
- **Risk:** Low - UI only

#### Success Criteria
- 25% improvement in job success rate for flaky services
- Circuit breaker prevents cascading failures
- Retry policies reduce transient error impact
- Dashboard shows real-time circuit breaker status

#### Rollback Plan
- Feature flags for retry and circuit breaker
- Disable by setting maxAttempts to 1
- Database migration not required

---

### 1.4 Database Query Optimization

**File:** `server/domain/jobs/job.service.ts`  
**Risk Level:** Low

#### Implementation Steps

**Step 1.4.1: Add Indexes for Common Queries**
- **File:** `migrations/manual/job_performance_indexes.sql`
- **Changes:**
  ```sql
  -- Index for job listing with org and type filters
  CREATE INDEX IF NOT EXISTS idx_jobs_org_type_status 
  ON jobs(organization_id, type, lifecycle_status, created_at DESC);
  
  -- Index for request history queries
  CREATE INDEX IF NOT EXISTS idx_job_request_history_job_created 
  ON job_request_history(job_id, created_at DESC);
  
  -- Index for token usage queries
  CREATE INDEX IF NOT EXISTS idx_ai_token_usage_job_timestamp 
  ON ai_token_usage(job_id, request_timestamp DESC);
  ```
- **Testing:** Verify index usage with EXPLAIN ANALYZE
- **Risk:** Low - additive indexes

**Step 1.4.2: Optimize Job List Query**
- **File:** `server/domain/jobs/job.service.ts`
- **Changes:**
  ```typescript
  // Use cursor-based pagination instead of offset
  async list(orgContext: OrgContext, options: JobListOptions = {}) {
    const { limit = 50, cursor } = options;
    
    let query = db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.createdAt))
      .limit(limit + 1); // Fetch one extra to determine if more pages
    
    if (cursor) {
      query = query.where(lt(jobs.createdAt, cursor));
    }
    
    const items = await query;
    const hasMore = items.length > limit;
    const results = hasMore ? items.slice(0, -1) : items;
    const nextCursor = hasMore ? results[results.length - 1].createdAt : null;
    
    return { items: results, total: null, nextCursor, hasMore };
  }
  ```
- **Testing:** Performance test with large dataset
- **Risk:** Medium - changes pagination behavior

**Step 1.4.3: Add Query Result Caching**
- **File:** `server/domain/jobs/core/job-cache.service.ts`
- **Changes:**
  ```typescript
  export class JobCacheService {
    private cache = new Map<string, { data: any, expires: number }>();
    
    async get<T>(key: string, ttl: number): Promise<T | null> {
      const cached = this.cache.get(key);
      if (!cached) return null;
      
      if (Date.now() > cached.expires) {
        this.cache.delete(key);
        return null;
      }
      
      return cached.data as T;
    }
    
    async set(key: string, data: any, ttl: number): Promise<void> {
      this.cache.set(key, {
        data,
        expires: Date.now() + ttl
      });
    }
    
    async invalidate(pattern: string): Promise<void> {
      for (const key of this.cache.keys()) {
        if (key.match(pattern)) {
          this.cache.delete(key);
        }
      }
    }
  }
  
  // Integrate into job service
  async getById(jobId: number, orgContext: OrgContext) {
    const cacheKey = `job:${jobId}:${orgContext.organizationId}`;
    const cached = await jobCache.get(cacheKey, 300000); // 5 min TTL
    if (cached) return cached;
    
    const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    await jobCache.set(cacheKey, job, 300000);
    return job;
  }
  ```
- **Testing:** Cache hit/miss ratio tests
- **Risk:** Low - additive caching

#### Success Criteria
- 50% reduction in job list query time for 1000+ jobs
- 70% cache hit rate for frequently accessed jobs
- No stale data returned from cache

#### Rollback Plan
- Remove indexes via rollback migration
- Disable caching via feature flag
- Revert to offset-based pagination if cursor-based causes issues

---

## Phase 2: Architecture Improvements

**Timeline:** 3-4 weeks  
**Risk Level:** Medium-High  
**Dependencies:** Phase 1 complete

### 2.1 Executor Registry Auto-Discovery

**File:** `server/domain/jobs/core/executors/index.ts`  
**Risk Level:** Medium

#### Implementation Steps

**Step 2.1.1: Add Executor Metadata Interface**
- **File:** `server/domain/jobs/core/executors/executor-metadata.ts`
- **Changes:**
  ```typescript
  export interface ExecutorMetadata {
    name: string;
    version: string;
    jobTypes: string[];
    description: string;
    author?: string;
    deprecated?: boolean;
    deprecateInFavorOf?: string;
    capabilities: string[];
    requiredConfig: string[];
    optionalConfig: string[];
  }
  
  export interface ExecutorClass {
    new (): JobExecutor;
    metadata?: ExecutorMetadata;
  }
  ```
- **Testing:** Validate metadata schema
- **Risk:** Low - new interface

**Step 2.1.2: Add Metadata to Executor Classes**
- **Files:** All executor files
- **Changes:**
  ```typescript
  // Example for api-executor.ts
  export class ApiExecutor implements JobExecutor {
    static metadata: ExecutorMetadata = {
      name: 'API Executor',
      version: '1.0.0',
      jobTypes: ['api', 'curl'],
      description: 'Execute HTTP requests to external APIs',
      capabilities: ['http', 'https', 'auth', 'retry'],
      requiredConfig: ['url', 'method'],
      optionalConfig: ['headers', 'body', 'timeout'],
    };
    
    canExecute(jobType: string): boolean {
      return ['api', 'curl'].includes(jobType);
    }
    
    // ... rest of implementation
  }
  ```
- **Testing:** Verify metadata extraction
- **Risk:** Low - additive static property

**Step 2.1.3: Implement Auto-Discovery**
- **File:** `server/domain/jobs/core/executors/executor-registry.ts`
- **Changes:**
  ```typescript
  import { readdir } from 'fs/promises';
  import { join } from 'path';
  
  export class AutoDiscoveryExecutorRegistry extends JobExecutorRegistry {
    private executorDir: string;
    
    constructor(executorDir: string) {
      super();
      this.executorDir = executorDir;
    }
    
    async autoRegister(): Promise<void> {
      const files = await readdir(this.executorDir);
      const executorFiles = files.filter(f => f.endsWith('-executor.ts'));
      
      for (const file of executorFiles) {
        try {
          const modulePath = join(this.executorDir, file);
          const module = await import(modulePath);
          
          // Find exported executor classes
          for (const exportName of Object.keys(module)) {
            const ExportedClass = module[exportName];
            if (typeof ExportedClass === 'function' && 
                ExportedClass.prototype.canExecute) {
              const executor = new ExportedClass();
              this.register(executor);
              
              // Log metadata if available
              if (ExportedClass.metadata) {
                logger.info(`Registered executor: ${ExportedClass.metadata.name}`);
              }
            }
          }
        } catch (error) {
          logger.error(`Failed to load executor from ${file}`, error);
        }
      }
    }
  }
  ```
- **Testing:** Test discovery with mock directory
- **Risk:** Medium - changes registry initialization

**Step 2.1.4: Update Registry Initialization**
- **File:** `server/domain/jobs/core/executors/index.ts`
- **Changes:**
  ```typescript
  // Before: Manual registration
  jobExecutorRegistry.register(new ApiExecutor());
  jobExecutorRegistry.register(new SeleniumJobExecutor());
  // ... 40+ more registrations
  
  // After: Auto-discovery
  const executorDir = join(__dirname, 'core/executors');
  const registry = new AutoDiscoveryExecutorRegistry(executorDir);
  await registry.autoRegister();
  
  export { registry as jobExecutorRegistry };
  ```
- **Testing:** Verify all executors registered
- **Risk:** High - changes initialization

**Step 2.1.5: Add Hot-Reload Support (Development Only)**
- **File:** `server/domain/jobs/core/executors/executor-registry.ts`
- **Changes:**
  ```typescript
  if (process.env.NODE_ENV === 'development') {
    const watcher = chok.watch(executorDir);
    watcher.on('change', async (filePath) => {
      logger.info(`Executor changed: ${filePath}, reloading...`);
      
      // Clear require cache
      delete require.cache[require.resolve(filePath)];
      
      // Re-register
      await this.autoRegister();
    });
  }
  ```
- **Testing:** Test hot-reload in dev environment
- **Risk:** Low - development only

#### Success Criteria
- All executors auto-discovered and registered
- Metadata accessible via registry API
- Hot-reload works in development
- No manual registration required

#### Rollback Plan
- Keep manual registration as fallback
- Feature flag to disable auto-discovery
- Revert to manual registration if issues arise

---

### 2.2 Job Dependency Graph

**Files:** New files and schema changes  
**Risk Level:** High  
**Dependencies:** Database migration required

#### Implementation Steps

**Step 2.2.1: Create Database Schema**
- **File:** `migrations/manual/job_dependencies.sql`
- **Changes:**
  ```sql
  CREATE TABLE job_dependencies (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    depends_on_job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    dependency_type VARCHAR(20) DEFAULT 'hard', -- 'hard' or 'soft'
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(job_id, depends_on_job_id)
  );
  
  CREATE INDEX idx_job_dependencies_job_id ON job_dependencies(job_id);
  CREATE INDEX idx_job_dependencies_depends_on ON job_dependencies(depends_on_job_id);
  
  -- Add dependency status to job runs
  ALTER TABLE job_runs ADD COLUMN dependency_status VARCHAR(20);
  ALTER TABLE job_runs ADD COLUMN dependency_resolution_time TIMESTAMP;
  ```
- **Testing:** Schema validation
- **Risk:** High - database migration

**Step 2.2.2: Create Dependency Service**
- **File:** `server/domain/jobs/core/job-dependency.service.ts`
- **Changes:**
  ```typescript
  export interface JobDependency {
    jobId: number;
    dependsOnJobId: number;
    type: 'hard' | 'soft';
  }
  
  export class JobDependencyService {
    async addDependency(dependency: JobDependency): Promise<void> {
      await db.insert(jobDependencies).values(dependency);
    }
    
    async removeDependency(jobId: number, dependsOnJobId: number): Promise<void> {
      await db.delete(jobDependencies)
        .where(and(
          eq(jobDependencies.jobId, jobId),
          eq(jobDependencies.dependsOnJobId, dependsOnJobId)
        ));
    }
    
    async getDependencies(jobId: number): Promise<JobDependency[]> {
      return await db.select().from(jobDependencies)
        .where(eq(jobDependencies.jobId, jobId));
    }
    
    async getDependents(jobId: number): Promise<JobDependency[]> {
      return await db.select().from(jobDependencies)
        .where(eq(jobDependencies.dependsOnJobId, jobId));
    }
    
    async detectCircularDependency(jobId: number, dependsOnJobId: number): Promise<boolean> {
      // DFS to detect cycles
      const visited = new Set<number>();
      const stack = [dependsOnJobId];
      
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current === jobId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        
        const deps = await this.getDependencies(current);
        for (const dep of deps) {
          stack.push(dep.dependsOnJobId);
        }
      }
      
      return false;
    }
    
    async resolveDependencies(jobId: number): Promise<{
      ready: boolean;
      blocking: number[];
      softBlocking: number[];
    }> {
      const dependencies = await this.getDependencies(jobId);
      const hardBlocking: number[] = [];
      const softBlocking: number[] = [];
      
      for (const dep of dependencies) {
        const lastRun = await this.getLastSuccessfulRun(dep.dependsOnJobId);
        if (!lastRun) {
          if (dep.type === 'hard') {
            hardBlocking.push(dep.dependsOnJobId);
          } else {
            softBlocking.push(dep.dependsOnJobId);
          }
        }
      }
      
      return {
        ready: hardBlocking.length === 0,
        blocking: hardBlocking,
        softBlocking,
      };
    }
  }
  ```
- **Testing:** Unit tests for cycle detection, resolution
- **Risk:** Medium - new service

**Step 2.2.3: Integrate into Job Execution**
- **File:** `server/core/pipeline-executor.ts`
- **Changes:**
  ```typescript
  async executeJob(jobId: number, context: any) {
    // Check dependencies before execution
    const resolution = await jobDependencyService.resolveDependencies(jobId);
    
    if (!resolution.ready) {
      logger.info(`Job ${jobId} blocked by dependencies: ${resolution.blocking}`);
      return {
        status: 'blocked',
        blockingDependencies: resolution.blocking,
        softBlockingDependencies: resolution.softBlocking,
      };
    }
    
    // Proceed with execution
    return await this.executeJobInternal(jobId, context);
  }
  ```
- **Testing:** Integration test with dependent jobs
- **Risk:** High - affects job execution flow

**Step 2.2.4: Create Dependency Graph Visualization**
- **File:** `server/domain/jobs/ui/components/DependencyGraph.tsx`
- **Changes:**
  ```typescript
  import ReactFlow from 'reactflow';
  
  export function DependencyGraph({ jobId }: { jobId: number }) {
    const { data: dependencies } = useQuery({
      queryKey: ['job-dependencies', jobId],
      queryFn: () => fetch(`/api/jobs/${jobId}/dependencies`).then(r => r.json()),
    });
    
    const nodes = dependencies.map(dep => ({
      id: dep.dependsOnJobId.toString(),
      data: { label: `Job ${dep.dependsOnJobId}` },
    }));
    
    const edges = dependencies.map(dep => ({
      id: `${dep.dependsOnJobId}-${dep.jobId}`,
      source: dep.dependsOnJobId.toString(),
      target: dep.jobId.toString(),
      animated: dep.type === 'hard',
      style: { stroke: dep.type === 'hard' ? '#ef4444' : '#f59e0b' },
    }));
    
    return <ReactFlow nodes={nodes} edges={edges} fitView />;
  }
  ```
- **Testing:** UI component tests
- **Risk:** Low - UI only

**Step 2.2.5: Add Dependency Management API**
- **File:** `server/routes/job-dependencies.ts`
- **Changes:**
  ```typescript
  router.post('/jobs/:id/dependencies', requireAuth, async (req, res) => {
    const { dependsOnJobId, type } = req.body;
    
    // Check for circular dependency
    const isCircular = await jobDependencyService.detectCircularDependency(
      parseInt(req.params.id),
      dependsOnJobId
    );
    
    if (isCircular) {
      return res.status(400).json({ error: 'Circular dependency detected' });
    }
    
    await jobDependencyService.addDependency({
      jobId: parseInt(req.params.id),
      dependsOnJobId,
      type: type || 'hard',
    });
    
    res.json({ success: true });
  });
  
  router.get('/jobs/:id/dependencies', requireAuth, async (req, res) => {
    const dependencies = await jobDependencyService.getDependencies(parseInt(req.params.id));
    res.json(dependencies);
  });
  ```
- **Testing:** API integration tests
- **Risk:** Medium - new endpoints

#### Success Criteria
- Dependencies prevent execution until upstream jobs complete
- Circular dependencies detected and prevented
- Dependency graph visualizes relationships
- Soft dependencies allow execution with warnings

#### Rollback Plan
- Database migration rollback
- Remove dependency checks from execution flow
- Feature flag to disable dependency resolution

---

### 2.3 Enhanced Error Handling & Recovery

**Files:** Multiple service files  
**Risk Level:** Medium  
**Dependencies:** Phase 1 retry policies

#### Implementation Steps

**Step 2.3.1: Create Error Classification Service**
- **File:** `server/domain/jobs/core/error-classification.service.ts`
- **Changes:**
  ```typescript
  export enum ErrorCategory {
    TRANSIENT = 'transient',
    PERMANENT = 'permanent',
    RATE_LIMIT = 'rate_limit',
    AUTHENTICATION = 'authentication',
    AUTHORIZATION = 'authorization',
    VALIDATION = 'validation',
    UNKNOWN = 'unknown',
  }
  
  export class ErrorClassificationService {
    classify(error: Error): ErrorCategory {
      const message = error.message.toLowerCase();
      const name = error.constructor.name;
      
      // Network errors
      if (message.includes('timeout') || message.includes('etimedout')) {
        return ErrorCategory.TRANSIENT;
      }
      if (message.includes('econnrefused') || message.includes('econnreset')) {
        return ErrorCategory.TRANSIENT;
      }
      
      // Rate limiting
      if (message.includes('rate limit') || message.includes('429')) {
        return ErrorCategory.RATE_LIMIT;
      }
      
      // Authentication
      if (message.includes('unauthorized') || message.includes('401')) {
        return ErrorCategory.AUTHENTICATION;
      }
      
      // Authorization
      if (message.includes('forbidden') || message.includes('403')) {
        return ErrorCategory.AUTHORIZATION;
      }
      
      // Validation
      if (message.includes('validation') || message.includes('invalid')) {
        return ErrorCategory.VALIDATION;
      }
      
      // Permanent errors
      if (message.includes('not found') || message.includes('404')) {
        return ErrorCategory.PERMANENT;
      }
      
      return ErrorCategory.UNKNOWN;
    }
    
    shouldRetry(category: ErrorCategory): boolean {
      return [
        ErrorCategory.TRANSIENT,
        ErrorCategory.RATE_LIMIT,
      ].includes(category);
    }
    
    getRecoveryAction(category: ErrorCategory): string {
      switch (category) {
        case ErrorCategory.TRANSIENT:
          return 'Retry with exponential backoff';
        case ErrorCategory.RATE_LIMIT:
          return 'Wait and retry with longer delay';
        case ErrorCategory.AUTHENTICATION:
          return 'Refresh credentials and retry';
        case ErrorCategory.AUTHORIZATION:
          return 'Check permissions and retry';
        case ErrorCategory.VALIDATION:
          return 'Fix input data and retry';
        case ErrorCategory.PERMANENT:
          return 'Manual intervention required';
        default:
          return 'Investigate and retry';
      }
    }
  }
  ```
- **Testing:** Unit tests for error classification
- **Risk:** Low - new service

**Step 2.3.2: Extend Job Health Service**
- **File:** `server/domain/jobs/core/job-health.service.ts`
- **Changes:**
  ```typescript
  async calculateHealthScore(jobId: number): Promise<HealthScoreComponents> {
    // ... existing logic ...
    
    // Add error categorization
    const errorCategories = await this.getErrorCategories(jobId);
    const transientErrorRate = errorCategories.transient / totalRuns;
    const permanentErrorRate = errorCategories.permanent / totalRuns;
    
    // Adjust health score based on error types
    if (permanentErrorRate > 0.1) {
      overall -= 20; // Penalize permanent errors heavily
    }
    if (transientErrorRate > 0.3) {
      overall -= 10; // Penalize high transient error rate
    }
    
    return {
      ...existingComponents,
      errorCategories,
      recoverySuggestions: errorCategories.map(cat => 
        errorClassificationService.getRecoveryAction(cat.category)
      ),
    };
  }
  
  async getErrorCategories(jobId: number): Promise<any[]> {
    const recentRuns = await db.select().from(jobRequestHistory)
      .where(eq(jobRequestHistory.jobId, jobId))
      .limit(100);
    
    return recentRuns
      .filter(r => r.responseStatus >= 400)
      .map(r => ({
        category: errorClassificationService.classify(
          new Error(r.responseBody?.error || 'Unknown error')
        ),
        timestamp: r.createdAt,
        message: r.responseBody?.error,
      }));
  }
  ```
- **Testing:** Integration test with error history
- **Risk:** Low - additive to existing service

**Step 2.3.3: Create Error Recovery Service**
- **File:** `server/domain/jobs/core/error-recovery.service.ts`
- **Changes:**
  ```typescript
  export class ErrorRecoveryService {
    async attemptRecovery(jobId: number, error: Error, context: any): Promise<{
      recovered: boolean;
      action: string;
      result?: any;
    }> {
      const category = errorClassificationService.classify(error);
      
      switch (category) {
        case ErrorCategory.AUTHENTICATION:
          return await this.handleAuthError(jobId, context);
        case ErrorCategory.RATE_LIMIT:
          return await this.handleRateLimit(jobId, context);
        case ErrorCategory.TRANSIENT:
          return await this.handleTransientError(jobId, error, context);
        default:
          return {
            recovered: false,
            action: errorClassificationService.getRecoveryAction(category),
          };
      }
    }
    
    private async handleAuthError(jobId: number, context: any) {
      // Try to refresh credentials
      const job = await jobService.getById(jobId, context.orgContext);
      if (job.config?.credentialId) {
        const refreshed = await credentialService.refresh(job.config.credentialId);
        if (refreshed) {
          return {
            recovered: true,
            action: 'Refreshed credentials',
          };
        }
      }
      
      return {
        recovered: false,
        action: 'Manual credential refresh required',
      };
    }
    
    private async handleRateLimit(jobId: number, context: any) {
      // Calculate wait time based on rate limit headers
      const waitTime = this.calculateRateLimitWait(context.responseHeaders);
      await this.sleep(waitTime);
      
      return {
        recovered: true,
        action: `Waited ${waitTime}ms for rate limit`,
      };
    }
    
    private async handleTransientError(jobId: number, error: Error, context: any) {
      // Retry with exponential backoff
      const retryPolicy = DEFAULT_RETRY_POLICIES.api;
      return await retryPolicyService.executeWithRetry(
        async () => {
          return await this.retryJob(jobId, context);
        },
        retryPolicy,
        `Transient error recovery for job ${jobId}`
      );
    }
  }
  ```
- **Testing:** Unit tests for each recovery strategy
- **Risk:** Medium - new service with side effects

**Step 2.3.4: Integrate Recovery into Pipeline Executor**
- **File:** `server/core/pipeline-executor.ts`
- **Changes:**
  ```typescript
  async executeStep(job: Job, context: any) {
    try {
      return await this.executeStepInternal(job, context);
    } catch (error) {
      // Attempt automatic recovery
      const recovery = await errorRecoveryService.attemptRecovery(
        job.id,
        error,
        context
      );
      
      if (recovery.recovered) {
        logger.info(`Job ${job.id} recovered: ${recovery.action}`);
        return await this.executeStepInternal(job, context);
      }
      
      // If recovery failed, escalate to HIL
      if (job.type === 'human_approval') {
        throw error; // Let HIL handle it
      }
      
      // Log recovery suggestion
      logger.warn(`Job ${job.id} failed, recovery action: ${recovery.action}`);
      
      // Create HIL request for manual intervention
      await hilEnhancementsService.createEscalation({
        jobId: job.id,
        error: error.message,
        suggestedAction: recovery.action,
      });
      
      throw error;
    }
  }
  ```
- **Testing:** Integration test with recovery scenarios
- **Risk:** High - affects execution flow

#### Success Criteria
- Error classification accuracy > 90%
- Automatic recovery succeeds for 60% of transient errors
- Health score includes error categorization
- Recovery suggestions displayed in UI

#### Rollback Plan
- Feature flag to disable automatic recovery
- Remove recovery logic from executor
- Keep error classification for health scoring only

---

### 2.4 Configuration Validation Framework

**Files:** New validation service  
**Risk Level:** Medium

#### Implementation Steps

**Step 2.4.1: Create JSON Schema Validation Service**
- **File:** `server/domain/jobs/core/config-validation.service.ts`
- **Changes:**
  ```typescript
  import Ajv from 'ajv';
  
  export class ConfigValidationService {
    private ajv: Ajv;
    
    constructor() {
      this.ajv = new Ajv({ allErrors: true });
    }
    
    validate(config: any, schema: any): {
      valid: boolean;
      errors: string[];
      suggestions: string[];
    } {
      const validate = this.ajv.compile(schema);
      const valid = validate(config);
      
      if (valid) {
        return { valid: true, errors: [], suggestions: [] };
      }
      
      const errors = validate.errors?.map(err => 
        `${err.instancePath}: ${err.message}`
      ) || [];
      
      const suggestions = this.generateSuggestions(validate.errors);
      
      return { valid: false, errors, suggestions };
    }
    
    private generateSuggestions(errors: any[]): string[] {
      const suggestions: string[] = [];
      
      for (const err of errors) {
        if (err.keyword === 'required') {
          suggestions.push(`Add missing required field: ${err.params.missingProperty}`);
        } else if (err.keyword === 'type') {
          suggestions.push(`Change field type to ${err.params.type}`);
        } else if (err.keyword === 'enum') {
          suggestions.push(`Use one of: ${err.params.allowedValues.join(', ')}`);
        }
      }
      
      return suggestions;
    }
  }
  ```
- **Testing:** Unit tests for various schema violations
- **Risk:** Low - new service

**Step 2.4.2: Define Executor Config Schemas**
- **File:** `server/domain/jobs/core/executors/config-schemas.ts`
- **Changes:**
  ```typescript
  export const EXECUTOR_CONFIG_SCHEMAS: Record<string, any> = {
    api: {
      type: 'object',
      required: ['url', 'method'],
      properties: {
        url: { type: 'string', format: 'uri' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
        headers: { type: 'object' },
        body: { type: 'object' },
        timeout: { type: 'number', minimum: 0 },
      },
    },
    ai_agent: {
      type: 'object',
      required: ['goal', 'systemPrompt'],
      properties: {
        goal: { type: 'string', minLength: 10 },
        systemPrompt: { type: 'string', minLength: 20 },
        model: { type: 'string' },
        provider: { type: 'string', enum: ['openai', 'anthropic', 'google'] },
        allowedTools: { type: 'array', items: { type: 'string' } },
      },
    },
    // ... schemas for all executors
  };
  ```
- **Testing:** Validate all executor schemas
- **Risk:** Low - schema definitions

**Step 2.4.3: Add Validation Endpoint**
- **File:** `server/routes/job-validation.ts`
- **Changes:**
  ```typescript
  router.post('/jobs/validate-config', requireAuth, async (req, res) => {
    const { type, config } = req.body;
    
    const schema = EXECUTOR_CONFIG_SCHEMAS[type];
    if (!schema) {
      return res.status(400).json({ error: 'Unknown job type' });
    }
    
    const validation = configValidationService.validate(config, schema);
    
    res.json(validation);
  });
  
  router.post('/jobs/:id/validate', requireAuth, async (req, res) => {
    const job = await jobService.getById(parseInt(req.params.id), req.orgContext);
    
    const config = typeof job.config === 'string' 
      ? JSON.parse(job.config) 
      : job.config;
    
    const schema = EXECUTOR_CONFIG_SCHEMAS[job.type];
    const validation = configValidationService.validate(config, schema);
    
    res.json(validation);
  });
  ```
- **Testing:** API integration tests
- **Risk:** Low - new endpoints

**Step 2.4.4: Integrate into Job Save**
- **File:** `server/domain/jobs/job.service.ts`
- **Changes:**
  ```typescript
  async create(input: CreateJobInput, orgContext: OrgContext): Promise<Job> {
    // Validate config before saving
    if (input.config) {
      const schema = EXECUTOR_CONFIG_SCHEMAS[input.type];
      if (schema) {
        const validation = configValidationService.validate(input.config, schema);
        if (!validation.valid) {
          throw new ValidationError(
            'Invalid job configuration',
            validation.errors
          );
        }
      }
    }
    
    // ... rest of create logic
  }
  
  async update(id: number, input: UpdateJobInput, orgContext: OrgContext): Promise<Job> {
    // Validate config on update
    if (input.config) {
      const job = await this.getById(id, orgContext);
      const schema = EXECUTOR_CONFIG_SCHEMAS[job.type];
      if (schema) {
        const validation = configValidationService.validate(input.config, schema);
        if (!validation.valid) {
          throw new ValidationError(
            'Invalid job configuration',
            validation.errors
          );
        }
      }
    }
    
    // ... rest of update logic
  }
  ```
- **Testing:** Integration test with invalid configs
- **Risk:** Medium - affects job creation/update

**Step 2.4.5: Add Auto-Fix Suggestions**
- **File:** `server/domain/jobs/core/config-validation.service.ts`
- **Changes:**
  ```typescript
  autoFix(config: any, schema: any): any {
    const fixed = { ...config };
    const validate = this.ajv.compile(schema);
    validate(fixed);
    
    if (validate.errors) {
      for (const err of validate.errors) {
        if (err.keyword === 'required' && err.params.missingProperty) {
          fixed[err.params.missingProperty] = this.getDefaultValue(err.params.missingProperty, schema);
        } else if (err.keyword === 'type' && err.params.type === 'string') {
          fixed[err.instancePath.replace(/^\./, '')] = String(fixed[err.instancePath.replace(/^\./, '')]);
        }
      }
    }
    
    return fixed;
  }
  
  private getDefaultValue(property: string, schema: any): any {
    const propSchema = schema.properties[property];
    if (propSchema.default !== undefined) {
      return propSchema.default;
    }
    
    // Provide sensible defaults
    switch (property) {
      case 'timeout': return 30000;
      case 'method': return 'GET';
      case 'provider': return 'google';
      default: return null;
    }
  }
  ```
- **Testing:** Test auto-fix with various invalid configs
- **Risk:** Low - additive feature

#### Success Criteria
- Configuration validation prevents invalid job saves
- Validation errors are clear and actionable
- Auto-fix resolves 50% of common validation issues
- Schema versioning supports config evolution

#### Rollback Plan
- Feature flag to disable validation
- Remove validation from job save/update
- Keep validation endpoint for manual use

---

## Phase 3: Developer Experience

**Timeline:** 2-3 weeks  
**Risk Level:** Low-Medium  
**Dependencies:** Phase 2 complete

### 3.1 Executor Testing Framework

**Files:** New testing utilities  
**Risk Level:** Low

#### Implementation Steps

**Step 3.1.1: Create Mock Executor Context Builder**
- **File:** `server/domain/jobs/tests/services/executors/test-utils.ts`
- **Changes:**
  ```typescript
  export interface MockExecutorContext {
    job: Job;
    pipeline: Pipeline;
    variables: VariableContext;
    traceContext: TraceContext;
    data: Record<string, any>;
  }
  
  export class MockExecutorContextBuilder {
    private context: Partial<MockExecutorContext> = {};
    
    withJob(job: Partial<Job>): this {
      this.context.job = {
        id: 1,
        name: 'Test Job',
        type: 'api',
        config: {},
        organizationId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...job,
      };
      return this;
    }
    
    withPipeline(pipeline: Partial<Pipeline>): this {
      this.context.pipeline = {
        id: 1,
        name: 'Test Pipeline',
        organizationId: 1,
        ...pipeline,
      };
      return this;
    }
    
    withVariables(variables: Record<string, any>): this {
      this.context.variables = variables;
      return this;
    }
    
    withTraceContext(): this {
      this.context.traceContext = {
        traceId: 'test-trace-123',
        spanId: 'test-span-456',
        parentSpanId: null,
      };
      return this;
    }
    
    withData(data: Record<string, any>): this {
      this.context.data = data;
      return this;
    }
    
    build(): MockExecutorContext {
      return {
        job: this.context.job || this.createDefaultJob(),
        pipeline: this.context.pipeline || this.createDefaultPipeline(),
        variables: this.context.variables || {},
        traceContext: this.context.traceContext || this.createDefaultTrace(),
        data: this.context.data || {},
      };
    }
    
    private createDefaultJob(): Job {
      return {
        id: 1,
        name: 'Test Job',
        type: 'api',
        config: {},
        organizationId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Job;
    }
    
    private createDefaultPipeline(): Pipeline {
      return {
        id: 1,
        name: 'Test Pipeline',
        organizationId: 1,
      } as Pipeline;
    }
    
    private createDefaultTrace(): TraceContext {
      return {
        traceId: 'test-trace-123',
        spanId: 'test-span-456',
        parentSpanId: null,
      };
    }
  }
  ```
- **Testing:** Test the builder itself
- **Risk:** Low - testing utility

**Step 3.1.2: Create Standard Test Fixtures**
- **File:** `server/domain/jobs/tests/services/executors/fixtures.ts`
- **Changes:**
  ```typescript
  export const EXECUTOR_FIXTURES = {
    api: {
      valid: {
        url: 'https://api.example.com/test',
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
      invalid: {
        url: 'not-a-url',
        method: 'INVALID',
      },
    },
    ai_agent: {
      valid: {
        goal: 'Process customer data',
        systemPrompt: 'You are a data processing agent',
        model: 'gpt-4',
        provider: 'openai',
      },
      invalid: {
        goal: 'too short',
        systemPrompt: 'too short',
      },
    },
    shell: {
      valid: {
        command: 'echo "hello"',
        timeout: 5000,
      },
      invalid: {
        command: '', // empty command
        timeout: -1, // negative timeout
      },
    },
  };
  
  export const MOCK_RESPONSES = {
    api: {
      success: {
        status: 200,
        data: { result: 'success' },
      },
      timeout: {
        error: 'ETIMEDOUT',
      },
      rateLimit: {
        status: 429,
        headers: { 'Retry-After': '60' },
      },
    },
  };
  ```
- **Testing:** Validate fixtures
- **Risk:** Low - test data

**Step 3.1.3: Create Executor Assertion Helpers**
- **File:** `server/domain/jobs/tests/services/executors/assertions.ts`
- **Changes:**
  ```typescript
  export class ExecutorAssertions {
    static assertSuccess(result: StepExecutionResult): void {
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    }
    
    static assertFailure(result: StepExecutionResult, expectedError?: string): void {
      expect(result.success).toBe(false);
      if (expectedError) {
        expect(result.error).toContain(expectedError);
      }
    }
    
    static assertOutputStructure(result: StepExecutionResult, schema: any): void {
      const output = JSON.parse(result.output);
      const validate = new Ajv().compile(schema);
      const valid = validate(output);
      expect(valid, JSON.stringify(validate.errors)).toBe(true);
    }
    
    static assertOutputContains(result: StepExecutionResult, key: string): void {
      const output = JSON.parse(result.output);
      expect(output).toHaveProperty(key);
    }
    
    static assertExecutionTime(result: StepExecutionResult, maxMs: number): void {
      expect(result.executionTimeMs).toBeLessThan(maxMs);
    }
    
    static assertRetryAttempted(result: StepExecutionResult, attempts: number): void {
      expect(result.retryCount).toBe(attempts);
    }
  }
  ```
- **Testing:** Test assertions with mock data
- **Risk:** Low - testing utility

**Step 3.1.4: Create Performance Benchmarking Tools**
- **File:** `server/domain/jobs/tests/services/executors/benchmark.ts`
- **Changes:**
  ```typescript
  export class ExecutorBenchmark {
    static async benchmark(
      executor: JobExecutor,
      config: any,
      iterations: number = 100
    ): Promise<{
      avgTimeMs: number;
      minTimeMs: number;
      maxTimeMs: number;
      p50TimeMs: number;
      p95TimeMs: number;
      p99TimeMs: number;
      successRate: number;
    }> {
      const times: number[] = let successes = 0;
      
      const context = new MockExecutorContextBuilder()
        .withJob({ type: executor.constructor.name })
        .build();
      
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        try {
          await executor.execute(
            context.job,
            config,
            context.pipeline,
            context.variables
          );
          successes++;
        } catch (error) {
          // Count failures
        }
        times.push(Date.now() - start);
      }
      
      times.sort((a, b) => a - b);
      
      return {
        avgTimeMs: times.reduce((a, b) => a + b) / times.length,
        minTimeMs: times[0],
        maxTimeMs: times[times.length - 1],
        p50TimeMs: times[Math.floor(times.length * 0.5)],
        p95TimeMs: times[Math.floor(times.length * 0.95)],
        p99TimeMs: times[Math.floor(times.length * 0.99)],
        successRate: (successes / iterations) * 100,
      };
    }
  }
  ```
- **Testing:** Benchmark with sample executor
- **Risk:** Low - testing utility

**Step 3.1.5: Create Integration Test Templates**
- **File:** `server/domain/jobs/tests/services/executors/integration-template.test.ts`
- **Changes:**
  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { MockExecutorContextBuilder } from './test-utils';
  import { EXECUTOR_FIXTURES } from './fixtures';
  import { ExecutorAssertions } from './assertions';
  
  export function createExecutorTestSuite(
    executorName: string,
    executor: JobExecutor,
    validConfig: any,
    invalidConfig: any
  ) {
    describe(`${executorName} Executor`, () => {
      let context: MockExecutorContext;
      
      beforeEach(() => {
        context = new MockExecutorContextBuilder()
          .withJob({ type: executorName })
          .build();
      });
      
      it('should execute successfully with valid config', async () => {
        const result = await executor.execute(
          context.job,
          validConfig,
          context.pipeline,
          context.variables
        );
        
        ExecutorAssertions.assertSuccess(result);
      });
      
      it('should fail with invalid config', async () => {
        await expect(
          executor.execute(
            context.job,
            invalidConfig,
            context.pipeline,
            context.variables
          )
        ).rejects.toThrow();
      });
      
      it('should complete within timeout', async () => {
        const start = Date.now();
        await executor.execute(
          context.job,
          validConfig,
          context.pipeline,
          context.variables
        );
        const duration = Date.now() - start;
        
        ExecutorAssertions.assertExecutionTime({ executionTimeMs: duration } as any, 30000);
      });
      
      // Add more standard tests as needed
    });
  }
  
  // Usage example:
  // createExecutorTestSuite(
  //   'api',
  //   new ApiExecutor(),
  //   EXECUTOR_FIXTURES.api.valid,
  //   EXECUTOR_FIXTURES.api.invalid
  // );
  ```
- **Testing:** Test the template itself
- **Risk:** Low - testing template

#### Success Criteria
- All executors can use standard test utilities
- Test setup time reduced by 50%
- Consistent test structure across executors
- Performance benchmarks available for all executors

#### Rollback Plan
- Keep old tests alongside new framework
- Gradual migration of existing tests
- No production impact

---

### 3.2 Schema-Based Job Configuration Validation

**Note:** This was implemented in Phase 2.4, but additional developer experience enhancements can be added.

#### Additional Steps

**Step 3.2.1: Create VS Code Schema Validation**
- **File:** `server/config/jobs/job-config.schema.json`
- **Changes:**
  ```json
  {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Job Configuration",
    "type": "object",
    "properties": {
      "type": {
        "type": "string",
        "enum": ["api", "ai_agent", "shell", "python", "curl", "openapi"]
      },
      "config": {
        "type": "object",
        "if": { "properties": { "type": { "const": "api" } } },
        "then": { "$ref": "#/definitions/apiConfig" },
        "else": { "type": "object" }
      }
    },
    "definitions": {
      "apiConfig": {
        "type": "object",
        "required": ["url", "method"],
        "properties": {
          "url": { "type": "string", "format": "uri" },
          "method": { "type": "string", "enum": ["GET", "POST", "PUT", "DELETE"] }
        }
      }
    }
  }
  ```
- **Testing:** Validate schema in VS Code
- **Risk:** Low - IDE integration

**Step 3.2.2: Add Schema to Package.json**
- **File:** `package.json`
- **Changes:**
  ```json
  {
    "jsonValidation": [
      {
        "fileMatch": ["**/job-config.json"],
        "url": "./server/config/jobs/job-config.schema.json"
      }
    ]
  }
  ```
- **Testing:** Open job config files in VS Code
- **Risk:** Low - configuration

#### Success Criteria
- VS Code provides real-time validation
- Auto-completion for job config fields
- Error highlighting in IDE

#### Rollback Plan
- Remove schema from package.json
- No production impact

---

### 3.3 Executor Documentation Generator

**Files:** New documentation generator  
**Risk Level:** Low

#### Implementation Steps

**Step 3.3.1: Extract Metadata from Executors**
- **File:** `scripts/generate-executor-docs.ts`
- **Changes:**
  ```typescript
  import { readdir } from 'fs/promises';
  import { join } from 'path';
  
  interface ExecutorDoc {
    name: string;
    version: string;
    description: string;
    jobTypes: string[];
    configSchema: any;
    examples: any[];
    capabilities: string[];
  }
  
  async function extractExecutorDocs(): Promise<ExecutorDoc[]> {
    const executorDir = 'server/domain/jobs/core/executors';
    const files = await readdir(executorDir);
    const executorFiles = files.filter(f => f.endsWith('-executor.ts'));
    
    const docs: ExecutorDoc[] = [];
    
    for (const file of executorFiles) {
      const modulePath = join(executorDir, file);
      const module = await import(modulePath);
      
      for (const exportName of Object.keys(module)) {
        const ExportedClass = module[exportName];
        if (ExportedClass.metadata) {
          docs.push({
            name: ExportedClass.metadata.name,
            version: ExportedClass.metadata.version,
            description: ExportedClass.metadata.description,
            jobTypes: ExportedClass.metadata.jobTypes,
            configSchema: EXECUTOR_CONFIG_SCHEMAS[ExportedClass.metadata.jobTypes[0]],
            examples: extractExamples(ExportedClass),
            capabilities: ExportedClass.metadata.capabilities,
          });
        }
      }
    }
    
    return docs;
  }
  ```
- **Testing:** Run generator and verify output
- **Risk:** Low - script

**Step 3.3.2: Generate Markdown Documentation**
- **File:** `scripts/generate-executor-docs.ts` (continued)
- **Changes:**
  ```typescript
  function generateMarkdown(docs: ExecutorDoc[]): string {
    let markdown = '# Executors Documentation\n\n';
    
    for (const doc of docs) {
      markdown += `## ${doc.name}\n\n`;
      markdown += `**Version:** ${doc.version}\n\n`;
      markdown += `**Description:** ${doc.description}\n\n`;
      markdown += `**Job Types:** ${doc.jobTypes.join(', ')}\n\n`;
      markdown += `**Capabilities:** ${doc.capabilities.join(', ')}\n\n`;
      
      markdown += '### Configuration Schema\n\n';
      markdown += '```json\n';
      markdown += JSON.stringify(doc.configSchema, null, 2);
      markdown += '\n```\n\n';
      
      markdown += '### Examples\n\n';
      for (const example of doc.examples) {
        markdown += '```json\n';
        markdown += JSON.stringify(example, null, 2);
        markdown += '\n```\n\n';
      }
      
      markdown += '---\n\n';
    }
    
    return markdown;
  }
  ```
- **Testing:** Verify generated markdown
- **Risk:** Low - documentation

**Step 3.3.3: Generate OpenAPI Spec**
- **File:** `scripts/generate-executor-docs.ts` (continued)
- **Changes:**
  ```typescript
  function generateOpenAPI(docs: ExecutorDoc[]): any {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: 'Oddjob Executors',
        version: '1.0.0',
      },
      paths: {},
      components: {
        schemas: {},
      },
    };
    
    for (const doc of docs) {
      for (const jobType of doc.jobTypes) {
        spec.paths[`/jobs/${jobType}`] = {
          post: {
            summary: `Execute ${doc.name}`,
            requestBody: {
              content: {
                'application/json': {
                  schema: doc.configSchema,
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        output: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        };
        
        spec.components.schemas[jobType] = doc.configSchema;
      }
    }
    
    return spec;
  }
  ```
- **Testing:** Validate OpenAPI spec
- **Risk:** Low - documentation

**Step 3.3.4: Add NPM Script**
- **File:** `package.json`
- **Changes:**
  ```json
  {
    "scripts": {
      "generate-executor-docs": "ts-node scripts/generate-executor-docs.ts"
    }
  }
  ```
- **Testing:** Run script
- **Risk:** Low - build script

#### Success Criteria
- Documentation auto-generated from metadata
- OpenAPI spec available for all executors
- Documentation stays in sync with code
- Run via npm script

#### Rollback Plan
- Remove npm script
- Keep manual documentation
- No production impact

---

## Phase 4: AI & Synthesis Enhancements

**Timeline:** 2-3 weeks  
**Risk Level:** Medium  
**Dependencies:** Phase 3 complete

### 4.1 Multi-Turn Job Synthesis

**File:** `server/domain/jobs/job-synthesis.service.ts`  
**Risk Level:** Medium

#### Implementation Steps

**Step 4.1.1: Add Conversation State Management**
- **File:** `server/domain/jobs/job-synthesis.service.ts`
- **Changes:**
  ```typescript
  interface SynthesisConversation {
    id: string;
    userId: string;
    organizationId: number;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: Date;
    }>;
    currentJobDefinition: any;
    status: 'in_progress' | 'completed' | 'abandoned';
    createdAt: Date;
    updatedAt: Date;
  }
  
  export class JobSynthesisService {
    private conversations = new Map<string, SynthesisConversation>();
    
    async startConversation(
      userId: string,
      organizationId: number,
      initialPrompt: string
    ): Promise<string> {
      const conversationId = randomUUID();
      const conversation: SynthesisConversation = {
        id: conversationId,
        userId,
        organizationId,
        messages: [{
          role: 'user',
          content: initialPrompt,
          timestamp: new Date(),
        }],
        currentJobDefinition: null,
        status: 'in_progress',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      this.conversations.set(conversationId, conversation);
      
      // Generate initial job definition
      const jobDef = await this.synthesizeJob(initialPrompt, organizationId, userId);
      conversation.currentJobDefinition = jobDef;
      conversation.messages.push({
        role: 'assistant',
        content: JSON.stringify(jobDef, null, 2),
        timestamp: new Date(),
      });
      
      return conversationId;
    }
    
    async continueConversation(
      conversationId: string,
      userMessage: string
    ): Promise<any> {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      // Add user message
      conversation.messages.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      });
      
      // Generate refined job definition
      const refinedDef = await this.refineJobDefinition(
        conversation.currentJobDefinition,
        userMessage,
        conversation.organizationId,
        conversation.userId
      );
      
      conversation.currentJobDefinition = refinedDef;
      conversation.messages.push({
        role: 'assistant',
        content: JSON.stringify(refinedDef, null, 2),
        timestamp: new Date(),
      });
      
      conversation.updatedAt = new Date();
      
      return refinedDef;
    }
    
    async completeConversation(conversationId: string): Promise<Job> {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      conversation.status = 'completed';
      
      // Create the job from final definition
      const job = await jobService.create(
        conversation.currentJobDefinition,
        { organizationId: conversation.organizationId, userId: conversation.userId }
      );
      
      // Clean up conversation after 24 hours
      setTimeout(() => {
        this.conversations.delete(conversationId);
      }, 24 * 60 * 60 * 1000);
      
      return job;
    }
  }
  ```
- **Testing:** Test multi-turn conversation flow
- **Risk:** Medium - adds state management

**Step 4.1.2: Implement Refinement Logic**
- **File:** `server/domain/jobs/job-synthesis.service.ts`
- **Changes:**
  ```typescript
  private async refineJobDefinition(
    currentDef: any,
    userFeedback: string,
    organizationId: number,
    userId: string
  ): Promise<any> {
    const aiConfig = await systemAiService.getAiConfig('copilot');
    const aiClient = AIClientFactory.getClient(aiConfig);
    
    const systemPrompt = `You are a Job Refinement Specialist.
Your task is to refine an existing job definition based on user feedback.

CURRENT JOB DEFINITION:
${JSON.stringify(currentDef, null, 2)}

USER FEEDBACK:
${userFeedback}

INSTRUCTIONS:
1. Analyze the user feedback and identify what needs to be changed
2. Modify the job definition accordingly
3. Ensure the modified definition is still valid
4. Return ONLY the modified job definition as JSON

Return valid JSON only, no markdown.`;

    const response = await aiClient.execute({
      userPrompt: 'Refine the job definition based on the feedback',
      systemPrompt,
      model: aiConfig.model,
      requestType: 'json',
      temperature: 0.5,
      useCache: false,
    }, 'job-refinement', aiConfig.apiKey);

    if (!response.success) {
      throw new Error(`Refinement failed: ${response.error}`);
    }

    return JSON.parse(response.output);
  }
  ```
- **Testing:** Test refinement with various feedback
- **Risk:** Medium - AI-dependent

**Step 4.1.3: Add Synthesis Templates**
- **File:** `server/domain/jobs/synthesis-templates.ts`
- **Changes:**
  ```typescript
  export const SYNTHESIS_TEMPLATES = {
    data_pipeline: {
      name: 'Data Pipeline Job',
      description: 'A job that processes data through multiple stages',
      template: {
        type: 'dataset',
        config: {
          transformations: [
            { type: 'filter', condition: '{{condition}}' },
            { type: 'transform', mapping: '{{mapping}}' },
            { type: 'enrich', source: '{{source}}' },
          ],
        },
      },
    },
    api_integration: {
      name: 'API Integration Job',
      description: 'A job that integrates with an external API',
      template: {
        type: 'api',
        config: {
          url: '{{apiUrl}}',
          method: '{{method}}',
          headers: { 'Authorization': 'Bearer {{token}}' },
          body: '{{body}}',
        },
      },
    },
    ai_processing: {
      name: 'AI Processing Job',
      description: 'A job that uses AI to process data',
      template: {
        type: 'ai_agent',
        config: {
          goal: '{{goal}}',
          systemPrompt: '{{systemPrompt}}',
          model: 'gemini-2.0-flash',
          provider: 'google',
        },
      },
    },
  };
  
  export class SynthesisTemplateService {
    getTemplate(templateName: string): any {
      return SYNTHESIS_TEMPLATES[templateName];
    }
    
    listTemplates(): string[] {
      return Object.keys(SYNTHESIS_TEMPLATES);
    }
    
    applyTemplate(templateName: string, variables: Record<string, any>): any {
      const template = this.getTemplate(templateName);
      const config = JSON.stringify(template.config);
      
      // Replace variables
      let result = config;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
      }
      
      return {
        ...template,
        config: JSON.parse(result),
      };
    }
  }
  ```
- **Testing:** Test template application
- **Risk:** Low - template system

**Step 4.1.4: Track Synthesis Success Rates**
- **File:** `server/domain/jobs/synthesis-analytics.service.ts`
- **Changes:**
  ```typescript
  export class SynthesisAnalyticsService {
    async recordSynthesisAttempt(data: {
      userId: string;
      organizationId: number;
      prompt: string;
      templateUsed?: string;
      turns: number;
      success: boolean;
      jobId?: number;
      error?: string;
    }): Promise<void> {
      await db.insert(synthesisAttempts).values({
        ...data,
        timestamp: new Date(),
      });
    }
    
    async getSuccessStats(organizationId: number, days: number = 30): Promise<{
      totalAttempts: number;
      successfulAttempts: number;
      successRate: number;
      avgTurns: number;
      mostUsedTemplates: Array<{ template: string; count: number }>;
    }> {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      
      const attempts = await db.select().from(synthesisAttempts)
        .where(and(
          eq(synthesisAttempts.organizationId, organizationId),
          gte(synthesisAttempts.timestamp, startDate)
        ));
      
      const successful = attempts.filter(a => a.success);
      const templateCounts = attempts.reduce((acc, a) => {
        if (a.templateUsed) {
          acc[a.templateUsed] = (acc[a.templateUsed] || 0) + 1;
        }
        return acc;
      }, {});
      
      return {
        totalAttempts: attempts.length,
        successfulAttempts: successful.length,
        successRate: attempts.length > 0 ? (successful.length / attempts.length) * 100 : 0,
        avgTurns: attempts.reduce((sum, a) => sum + a.turns, 0) / attempts.length,
        mostUsedTemplates: Object.entries(templateCounts)
          .map(([template, count]) => ({ template, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      };
    }
  }
  ```
- **Testing:** Test analytics queries
- **Risk:** Low - analytics service

**Step 4.1.5: Add A/B Testing Support**
- **File:** `server/domain/jobs/synthesis-ab-testing.service.ts`
- **Changes:**
  ```typescript
  export class SynthesisABTestingService {
    async createABTest(data: {
      organizationId: number;
      name: string;
      prompt: string;
      variantA: { systemPrompt: string; model: string };
      variantB: { systemPrompt: string; model: string };
    }): Promise<string> {
      const testId = randomUUID();
      await db.insert(synthesisABTests).values({
        id: testId,
        ...data,
        status: 'running',
        createdAt: new Date(),
      });
      return testId;
    }
    
    async recordABTestResult(testId: string, variant: 'A' | 'B', result: {
      success: boolean;
      jobId?: number;
      executionTimeMs?: number;
      qualityScore?: number;
    }): Promise<void> {
      await db.insert(synthesisABTestResults).values({
        testId,
        variant,
        ...result,
        timestamp: new Date(),
      });
    }
    
    async getABTestResults(testId: string): Promise<{
      variantA: { successRate: number; avgExecutionTime: number; avgQualityScore: number };
      variantB: { successRate: number; avgExecutionTime: number; avgQualityScore: number };
      winner: 'A' | 'B' | 'tie';
    }> {
      const results = await db.select().from(synthesisABTestResults)
        .where(eq(synthesisABTestResults.testId, testId));
      
      const variantAResults = results.filter(r => r.variant === 'A');
      const variantBResults = results.filter(r => r.variant === 'B');
      
      const variantAStats = this.calculateStats(variantAResults);
      const variantBStats = this.calculateStats(variantBResults);
      
      // Determine winner based on success rate
      const winner = variantAStats.successRate > variantBStats.successRate ? 'A' :
                    variantBStats.successRate > variantAStats.successRate ? 'B' : 'tie';
      
      return {
        variantA: variantAStats,
        variantB: variantBStats,
        winner,
      };
    }
  }
  ```
- **Testing:** Test A/B test creation and analysis
- **Risk:** Medium - adds complexity

#### Success Criteria
- Multi-turn synthesis improves job quality by 30%
- Templates reduce synthesis time by 40%
- Synthesis success rate tracked and visible
- A/B testing identifies best prompts

#### Rollback Plan
- Feature flag to disable multi-turn
- Keep single-turn synthesis as fallback
- Database migration not required

---

### 4.2 Skill Marketplace Integration

**Files:** New marketplace service  
**Risk Level:** Medium  
**Dependencies:** Skill import service

#### Implementation Steps

**Step 4.2.1: Extend Skill Schema**
- **File:** `migrations/manual/skill_marketplace.sql`
- **Changes:**
  ```sql
  ALTER TABLE skills ADD COLUMN rating DECIMAL(3, 2);
  ALTER TABLE skills ADD COLUMN rating_count INTEGER DEFAULT 0;
  ALTER TABLE skills ADD COLUMN downloads INTEGER DEFAULT 0;
  ALTER TABLE skills ADD COLUMN author VARCHAR(255);
  ALTER TABLE skills ADD COLUMN tags TEXT[];
  ALTER TABLE skills ADD COLUMN dependencies JSONB;
  ALTER TABLE skills ADD COLUMN version VARCHAR(20);
  ALTER TABLE skills ADD COLUMN published_at TIMESTAMP;
  ALTER TABLE skills ADD COLUMN updated_at TIMESTAMP;
  
  CREATE TABLE skill_reviews (
    id SERIAL PRIMARY KEY,
    skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
    user_id VARCHAR(255),
    organization_id INTEGER,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  
  CREATE TABLE skill_versions (
    id SERIAL PRIMARY KEY,
    skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
    version VARCHAR(20),
    content TEXT,
    changelog TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```
- **Testing:** Schema validation
- **Risk:** High - database migration

**Step 4.2.2: Create Skill Marketplace Service**
- **File:** `server/domain/jobs/skill-marketplace.service.ts`
- **Changes:**
  ```typescript
  export class SkillMarketplaceService {
    async publishSkill(data: {
      userId: string;
      organizationId: number;
      skill: AnalyzedSkill;
      metadata: {
        author: string;
        tags: string[];
        version: string;
      };
    }): Promise<number> {
      const [skill] = await db.insert(skills).values({
        name: data.skill.name,
        description: data.skill.description,
        content: JSON.stringify(data.skill),
        author: data.metadata.author,
        tags: data.metadata.tags,
        version: data.metadata.version,
        rating: 0,
        rating_count: 0,
        downloads: 0,
        published_at: new Date(),
        updated_at: new Date(),
      }).returning();
      
      return skill.id;
    }
    
    async rateSkill(skillId: number, data: {
      userId: string;
      organizationId: number;
      rating: number;
      comment?: string;
    }): Promise<void> {
      await db.insert(skillReviews).values({
        skill_id: skillId,
        ...data,
        created_at: new Date(),
      });
      
      // Update skill rating
      await this.updateSkillRating(skillId);
    }
    
    private async updateSkillRating(skillId: number): Promise<void> {
      const reviews = await db.select().from(skillReviews)
        .where(eq(skillReviews.skill_id, skillId));
      
      const avgRating = reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;
      
      await db.update(skills)
        .set({
          rating: avgRating,
          rating_count: reviews.length,
          updated_at: new Date(),
        })
        .where(eq(skills.id, skillId));
    }
    
    async downloadSkill(skillId: number): Promise<AnalyzedSkill> {
      const [skill] = await db.select().from(skills)
        .where(eq(skills.id, skillId))
        .limit(1);
      
      if (!skill) {
        throw new Error('Skill not found');
      }
      
      // Increment download count
      await db.update(skills)
        .set({ downloads: skill.downloads + 1 })
        .where(eq(skills.id, skillId));
      
      return JSON.parse(skill.content);
    }
    
    async searchSkills(query: string, filters?: {
      tags?: string[];
      minRating?: number;
      author?: string;
    }): Promise<Skill[]> {
      let conditions = [sql`name ILIKE ${'%' + query + '%'}`];
      
      if (filters?.tags?.length) {
        conditions.push(sql`${skills.tags} && ${filters.tags}`);
      }
      
      if (filters?.minRating) {
        conditions.push(sql`${skills.rating} >= ${filters.minRating}`);
      }
      
      if (filters?.author) {
        conditions.push(eq(skills.author, filters.author));
      }
      
      return await db.select().from(skills)
        .where(and(...conditions))
        .orderBy(desc(skills.rating))
        .limit(50);
    }
  }
  ```
- **Testing:** Unit tests for marketplace operations
- **Risk:** Medium - new service

**Step 4.2.3: Implement Skill Dependency Resolution**
- **File:** `server/domain/jobs/skill-dependency.service.ts`
- **Changes:**
  ```typescript
  export class SkillDependencyService {
    async resolveDependencies(skill: AnalyzedSkill): Promise<{
      resolved: string[];
      missing: string[];
      conflicts: string[];
    }> {
      const dependencies = skill.dependencies || [];
      const resolved: string[] = [];
      const missing: string[] = [];
      const conflicts: string[] = [];
      
      for (const dep of dependencies) {
        // Check if dependency is available
        const available = await this.checkDependencyAvailable(dep);
        
        if (available) {
          resolved.push(dep);
        } else {
          missing.push(dep);
        }
      }
      
      // Check for conflicts
      const conflictsCheck = await this.checkConflicts(skill);
      conflicts.push(...conflictsCheck);
      
      return { resolved, missing, conflicts };
    }
    
    private async checkDependencyAvailable(dependency: string): Promise<boolean> {
      // Check if tool is available
      const toolAvailable = await isToolAvailable(dependency);
      if (toolAvailable) return true;
      
      // Check if skill is available in marketplace
      const skill = await db.select().from(skills)
        .where(eq(skills.name, dependency))
        .limit(1);
      
      return skill.length > 0;
    }
    
    private async checkConflicts(skill: AnalyzedSkill): Promise<string[]> {
      const conflicts: string[] = [];
      
      // Check for tool conflicts
      for (const tool of skill.tools) {
        const toolMetadata = getToolMetadata(tool);
        if (toolMetadata?.adminOnly) {
          conflicts.push(`${tool} requires admin access`);
        }
      }
      
      return conflicts;
    }
  }
  ```
- **Testing:** Test dependency resolution
- **Risk:** Low - dependency checker

**Step 4.2.4: Add Skill Versioning**
- **File:** `server/domain/jobs/skill-versioning.service.ts`
- **Changes:**
  ```typescript
  export class SkillVersioningService {
    async createVersion(skillId: number, data: {
      version: string;
      content: string;
      changelog: string;
    }): Promise<number> {
      const [version] = await db.insert(skillVersions).values({
        skill_id: skillId,
        ...data,
        created_at: new Date(),
      }).returning();
      
      // Update skill version
      await db.update(skills)
        .set({ version: data.version, updated_at: new Date() })
        .where(eq(skills.id, skillId));
      
      return version.id;
    }
    
    async getVersions(skillId: number): Promise<any[]> {
      return await db.select().from(skillVersions)
        .where(eq(skillVersions.skill_id, skillId))
        .orderBy(desc(skillVersions.created_at));
    }
    
    async rollbackToVersion(skillId: number, versionId: number): Promise<void> {
      const [version] = await db.select().from(skillVersions)
        .where(eq(skillVersions.id, versionId))
        .limit(1);
      
      if (!version) {
        throw new Error('Version not found');
      }
      
      await db.update(skills)
        .set({
          content: version.content,
          version: version.version,
          updated_at: new Date(),
        })
        .where(eq(skills.id, skillId));
    }
  }
  ```
- **Testing:** Test versioning operations
- **Risk:** Medium - version management

**Step 4.2.5: Create Skill Analytics Dashboard**
> **Removed 2026-09-20.** This component was written and never mounted — nothing imported
> it — so it was deleted with `VisualJobBuilder`. This plan step is unbuilt, not shipped.
- **File:** `server/domain/jobs/ui/components/SkillAnalyticsDashboard.tsx` (deleted)
- **Changes:**
  ```typescript
  export function SkillAnalyticsDashboard({ skillId }: { skillId: number }) {
    const { data: analytics } = useQuery({
      queryKey: ['skill-analytics', skillId],
      queryFn: () => fetch(`/api/skills/${skillId}/analytics`).then(r => r.json()),
    });
    
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Download Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <DownloadsChart data={analytics?.downloadsOverTime} />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <RatingDistribution data={analytics?.ratingDistribution} />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Usage by Organization</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageByOrg data={analytics?.usageByOrg} />
          </CardContent>
        </Card>
      </div>
    );
  }
  ```
- **Testing:** UI component tests
- **Risk:** Low - UI only

#### Success Criteria
- Skills can be published and discovered
- Rating system provides quality signals
- Dependency resolution prevents broken imports
- Versioning allows safe updates
- Analytics show skill usage patterns

#### Rollback Plan
- Database migration rollback
- Feature flag to disable marketplace
- Keep existing skill import functionality

---

## Phase 5: Monitoring & Observability

**Timeline:** 2-3 weeks  
**Risk Level:** Low-Medium  
**Dependencies:** Phase 4 complete

### 5.1 Distributed Tracing Integration

**Files:** Infrastructure and service files  
**Risk Level:** Medium

#### Implementation Steps

**Step 5.1.1: Install OpenTelemetry Dependencies**
- **File:** `package.json`
- **Changes:**
  ```json
  {
    "dependencies": {
      "@opentelemetry/api": "^1.7.0",
      "@opentelemetry/sdk-node": "^0.45.0",
      "@opentelemetry/auto-instrumentations": "^0.38.0",
      "@opentelemetry/exporter-trace-jaeger": "^1.20.0",
      "@opentelemetry/exporter-metrics-otlp-grpc": "^0.45.0",
      "@opentelemetry/resources": "^1.18.0",
      "@opentelemetry/semantic-conventions": "^1.22.0"
    }
  }
  ```
- **Testing:** Verify installation
- **Risk:** Low - dependencies

**Step 5.1.2: Configure OpenTelemetry**
- **File:** `server/tracing.ts`
- **Changes:**
  ```typescript
  import { NodeSDK } from '@opentelemetry/sdk-node';
  import { Resource } from '@opentelemetry/resources';
  import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
  import { JaegerExporter } from '@opentelemetry/exporter-trace-jaeger';
  
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'oddjob-server',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
    }),
    traceExporter: new JaegerExporter({
      endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    }),
    autoInstrumentations: [
      'http',
      'https',
      'express',
      'mongodb',
      'postgresql',
      'redis',
      'ioredis',
    ],
  });
  
  sdk.start();
  
  export { sdk as tracingSDK };
  ```
- **Testing:** Verify traces appear in Jaeger
- **Risk:** Medium - infrastructure change

**Step 5.1.3: Add Custom Spans to Job Services**
- **File:** `server/domain/jobs/job.service.ts`
- **Changes:**
  ```typescript
  import { trace } from '@opentelemetry/api';
  
  const tracer = trace.getTracer('job-service');
  
  export const jobService = {
    async list(orgContext: OrgContext, options: JobListOptions = {}) {
      return tracer.startActiveSpan('job.list', async (span) => {
        span.setAttribute('org_id', orgContext.organizationId || 'null');
        span.setAttribute('limit', options.limit || 50);
        
        try {
          const result = await withQueryTracking('jobService.list', async () => {
            // ... existing logic
          });
          
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
          throw error;
        }
      });
    },
    
    // ... other methods with tracing
  };
  ```
- **Testing:** Verify spans appear in traces
- **Risk:** Low - additive instrumentation

**Step 5.1.4: Add Executor Execution Tracing**
- **File:** `server/core/pipeline-step-runner.ts`
- **Changes:**
  ```typescript
  import { trace, SpanStatusCode } from '@opentelemetry/api';
  
  const tracer = trace.getTracer('pipeline-executor');
  
  async executeStep(job: Job, context: any) {
    return tracer.startActiveSpan('step.execute', {
      attributes: {
        'job.id': job.id,
        'job.type': job.type,
        'job.name': job.name,
        'pipeline.id': context.pipeline?.id,
      },
    }, async (span) => {
      const startTime = Date.now();
      
      try {
        const result = await this.executeStepInternal(job, context);
        
        span.setAttribute('execution_time_ms', Date.now() - startTime);
        span.setAttribute('success', result.success);
        span.setStatus({ code: SpanStatusCode.OK });
        
        return result;
      } catch (error) {
        span.setAttribute('execution_time_ms', Date.now() - startTime);
        span.setAttribute('success', false);
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      }
    });
  }
  ```
- **Testing:** Verify executor spans
- **Risk:** Low - additive instrumentation

**Step 5.1.5: Integrate with Mach 3 Tracing**
- **File:** `server/domain/core/infrastructure/tracing/trace-context.service.ts`
- **Changes:**
  ```typescript
  import { trace, context as otelContext, propagation } from '@opentelemetry/api';
  
  export class TraceContextService {
    static fromHeaders(headers: Record<string, string>): TraceContext {
      const carrier = propagation.extract(otelContext.active(), headers);
      const spanContext = trace.getSpan(carrier)?.context();
      
      return {
        traceId: spanContext?.traceId,
        spanId: spanContext?.spanId,
        parentSpanId: spanContext?.parentSpanId,
      };
    }
    
    static toHeaders(traceContext: TraceContext): Record<string, string> {
      const headers = {};
      propagation.inject(otelContext.active(), headers);
      return headers;
    }
  }
  ```
- **Testing:** Test header propagation
- **Risk:** Low - integration layer

#### Success Criteria
- All job executions traced end-to-end
- Spans include relevant attributes
- Traces visible in Jaeger/Tempo
- Header propagation across pods works

#### Rollback Plan
- Disable tracing via environment variable
- Remove instrumentation if performance impact
- No database changes required

---

### 5.2 Job Performance Profiling

**Files:** New profiling service  
**Risk Level:** Low

#### Implementation Steps

**Step 5.2.1: Extend Job Health Service with Performance Metrics**
- **File:** `server/domain/jobs/core/job-health.service.ts`
- **Changes:**
  ```typescript
  async calculateHealthScore(jobId: number): Promise<HealthScoreComponents> {
    // ... existing logic ...
    
    // Add performance metrics
    const performanceMetrics = await this.getPerformanceMetrics(jobId);
    
    return {
      ...existingComponents,
      performance: {
        avgExecutionTimeMs: performanceMetrics.avgExecutionTimeMs,
        p50ExecutionTimeMs: performanceMetrics.p50ExecutionTimeMs,
        p95ExecutionTimeMs: performanceMetrics.p95ExecutionTimeMs,
        p99ExecutionTimeMs: performanceMetrics.p99ExecutionTimeMs,
        memoryUsageMB: performanceMetrics.avgMemoryUsageMB,
        dbQueryTimeMs: performanceMetrics.avgDbQueryTimeMs,
        externalApiTimeMs: performanceMetrics.avgExternalApiTimeMs,
      },
    };
  }
  
  private async getPerformanceMetrics(jobId: number): Promise<any> {
    const recentRuns = await db.select().from(jobRequestHistory)
      .where(and(
        eq(jobRequestHistory.jobId, jobId),
        gte(jobRequestHistory.createdAt, thirtyDaysAgo)
      ))
      .limit(100);
    
    const executionTimes = recentRuns.map(r => r.responseTimeMs || 0);
    executionTimes.sort((a, b) => a - b);
    
    return {
      avgExecutionTimeMs: executionTimes.reduce((a, b) => a + b) / executionTimes.length,
      p50ExecutionTimeMs: executionTimes[Math.floor(executionTimes.length * 0.5)],
      p95ExecutionTimeMs: executionTimes[Math.floor(executionTimes.length * 0.95)],
      p99ExecutionTimeMs: executionTimes[Math.floor(executionTimes.length * 0.99)],
      avgMemoryUsageMB: this.calculateAvgMemory(recentRuns),
      avgDbQueryTimeMs: this.calculateAvgDbQueryTime(recentRuns),
      avgExternalApiTimeMs: this.calculateAvgExternalApiTime(recentRuns),
    };
  }
  ```
- **Testing:** Test performance metric calculation
- **Risk:** Low - additive to existing service

**Step 5.2.2: Create Profiling Service**
- **File:** `server/domain/jobs/core/profiling.service.ts`
- **Changes:**
  ```typescript
  export class ProfilingService {
    private profiles = new Map<number, JobProfile>();
    
    async startProfiling(jobId: number): Promise<void> {
      this.profiles.set(jobId, {
        jobId,
        startTime: Date.now(),
        samples: [],
      });
    }
    
    async recordSample(jobId: number, sample: {
      timestamp: number;
      memoryUsageMB: number;
      cpuUsagePercent: number;
      dbQueries: number;
      externalApiCalls: number;
    }): Promise<void> {
      const profile = this.profiles.get(jobId);
      if (!profile) return;
      
      profile.samples.push(sample);
    }
    
    async stopProfiling(jobId: number): Promise<JobProfile> {
      const profile = this.profiles.get(jobId);
      if (!profile) {
        throw new Error('No active profile for job');
      }
      
      profile.endTime = Date.now();
      profile.duration = profile.endTime - profile.startTime;
      
      // Calculate aggregates
      profile.aggregates = this.calculateAggregates(profile.samples);
      
      this.profiles.delete(jobId);
      return profile;
    }
    
    private calculateAggregates(samples: any[]): any {
      return {
        avgMemoryMB: samples.reduce((sum, s) => sum + s.memoryUsageMB, 0) / samples.length,
        maxMemoryMB: Math.max(...samples.map(s => s.memoryUsageMB)),
        avgCpuPercent: samples.reduce((sum, s) => sum + s.cpuUsagePercent, 0) / samples.length,
        maxCpuPercent: Math.max(...samples.map(s => s.cpuUsagePercent)),
        totalDbQueries: samples.reduce((sum, s) => sum + s.dbQueries, 0),
        totalExternalApiCalls: samples.reduce((sum, s) => sum + s.externalApiCalls, 0),
      };
    }
  }
  ```
- **Testing:** Test profiling lifecycle
- **Risk:** Low - new service

**Step 5.2.3: Add Sampling to Pipeline Executor**
- **File:** `server/core/pipeline-executor.ts`
- **Changes:**
  ```typescript
  async executeJob(jobId: number, context: any) {
    // Sample 10% of jobs for profiling
    const shouldProfile = Math.random() < 0.1;
    
    if (shouldProfile) {
      await profilingService.startProfiling(jobId);
    }
    
    try {
      const result = await this.executeJobInternal(jobId, context);
      
      if (shouldProfile) {
        const profile = await profilingService.stopProfiling(jobId);
        await this.saveProfile(jobId, profile);
      }
      
      return result;
    } catch (error) {
      if (shouldProfile) {
        await profilingService.stopProfiling(jobId);
      }
      throw error;
    }
  }
  ```
- **Testing:** Test sampling and profiling
- **Risk:** Low - additive profiling

**Step 5.2.4: Create Performance Dashboard**
- **File:** `server/domain/jobs/ui/components/PerformanceDashboard.tsx`
- **Changes:**
  ```typescript
  export function PerformanceDashboard({ jobId }: { jobId: number }) {
    const { data: health } = useQuery({
      queryKey: ['job-health', jobId],
      queryFn: () => fetch(`/api/jobs/${jobId}/health`).then(r => r.json()),
    });
    
    const { data: profiles } = useQuery({
      queryKey: ['job-profiles', jobId],
      queryFn: () => fetch(`/api/jobs/${jobId}/profiles`).then(r => r.json()),
    });
    
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Execution Time Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ExecutionTimeChart data={health?.performance} />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Resource Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <ResourceUsageChart data={profiles} />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Database & API Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <DbApiPerformance data={health?.performance} />
          </CardContent>
        </Card>
      </div>
    );
  }
  ```
- **Testing:** UI component tests
- **Risk:** Low - UI only

#### Success Criteria
- Performance metrics collected for 10% of jobs
- Health scores include performance data
- Dashboard shows resource usage trends
- No significant performance overhead from profiling

#### Rollback Plan
- Disable sampling via feature flag
- Remove profiling instrumentation
- No database changes required

---

## Technical Debt Cleanup

### 1. Deprecated Job Type Migration

**File:** Migration script  
**Risk Level:** Medium

#### Implementation Steps

**Step 1: Create Migration Script**
- **File:** `scripts/migrate-deprecated-job-types.ts`
- **Changes:**
  ```typescript
  import { db } from '@server/database_service.js';
  import { jobs } from '@shared/schema/index.js';
  import { eq } from 'drizzle-orm';
  
  async function migrateDeprecatedJobTypes() {
    const deprecatedJobs = await db.select().from(jobs)
      .where(eq(jobs.type, 'api'));
    
    console.log(`Found ${deprecatedJobs.length} deprecated jobs`);
    
    for (const job of deprecatedJobs) {
      const config = typeof job.config === 'string' 
        ? JSON.parse(job.config) 
        : job.config;
      
      // Migrate to curl type
      await db.update(jobs)
        .set({
          type: 'curl',
          config: {
            ...config,
            // Ensure curl-specific fields
            url: config.url,
            method: config.method || 'GET',
          },
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      
      console.log(`Migrated job ${job.id}: ${job.name}`);
    }
    
    console.log('Migration complete');
  }
  
  migrateDeprecatedJobTypes().catch(console.error);
  ```
- **Testing:** Test migration on backup database
- **Risk:** Medium - data migration

**Step 2: Add Validation to Prevent New Deprecated Jobs**
- **File:** `server/domain/jobs/job.service.ts`
- **Changes:**
  ```typescript
  async create(input: CreateJobInput, orgContext: OrgContext): Promise<Job> {
    // Check for deprecated types
    const deprecatedTypes = ['api'];
    if (deprecatedTypes.includes(input.type)) {
      throw new ValidationError(
        `Job type '${input.type}' is deprecated. Use '${JOB_TYPE_CONFIG[input.type].migrateTo}' instead.`
      );
    }
    
    // ... rest of create logic
  }
  ```
- **Testing:** Test validation
- **Risk:** Low - validation

#### Success Criteria
- All existing 'api' jobs migrated to 'curl'
- New 'api' jobs rejected with clear error
- No data loss during migration

#### Rollback Plan
- Database backup before migration
- Revert migration script if needed
- Remove validation if issues arise

---

## Testing Strategy

### Unit Testing
- All new services have unit tests
- Test coverage > 80% for new code
- Mock external dependencies

### Integration Testing
- Test service interactions
- Use test database
- Mock external APIs

### End-to-End Testing
- Test complete job execution flows
- Use Playwright for UI tests
- Test with real services in staging

### Performance Testing
- Benchmark critical paths
- Load test with concurrent jobs
- Profile memory usage

### Security Testing
- Validate input sanitization
- Test authentication/authorization
- Check for SQL injection

---

## Rollback Plan

### Database Migrations
- All migrations include rollback scripts
- Test rollback in development
- Document rollback procedures

### Feature Flags
- All major features behind flags
- Can disable without code deployment
- Monitor feature usage

### Code Rollbacks
- Git revert for breaking changes
- Keep previous version deployed
- Blue-green deployment strategy

### Monitoring
- Alert on error rate increase
- Monitor performance metrics
- Set up dashboards for new features

---

## Success Metrics

### Phase 1: Performance Optimizations
- 50% reduction in supervisor job polling overhead
- 3x faster Google Drive sync for 10+ folders
- 25% improvement in job success rate
- 50% reduction in job list query time

### Phase 2: Architecture Improvements
- Zero manual executor registration required
- Dependency graph prevents execution issues
- Error classification accuracy > 90%
- Configuration validation prevents invalid jobs

### Phase 3: Developer Experience
- Test setup time reduced by 50%
- VS Code provides real-time validation
- Documentation auto-generated
- Consistent test structure across executors

### Phase 4: AI & Synthesis
- Multi-turn synthesis improves quality by 30%
- Templates reduce synthesis time by 40%
- Skill marketplace adoption > 20%
- Synthesis success rate tracked

### Phase 5: Observability
- 100% of job executions traced
- Performance metrics for 10% of jobs
- Dashboard shows real-time metrics
- Tracing overhead < 5%

---

## Conclusion

This implementation plan provides a detailed roadmap for enhancing the Oddjob domain jobs system. Each phase includes specific implementation steps, testing strategies, and rollback plans. The plan prioritizes performance optimizations first, followed by architecture improvements, developer experience enhancements, AI capabilities, and observability.

The phased approach ensures that each enhancement builds on the previous ones, minimizing risk and maximizing value. All changes include comprehensive testing and rollback strategies to ensure safe deployment.
