# Phase 1a: State Reconciliation System - Technical Specification

**Document Version:** 1.0  
**Status:** DRAFT - Ready for Review  
**Date:** June 14, 2026  
**Phase:** 1a (Weeks 1-8)

---

## 1. Executive Summary

The State Reconciliation System ensures consistency between Oddjob's database state and Docker's actual container state. This is critical to prevent divergence incidents like the 6/13/2026 container deletion event.

**Problem Statement:**
- Database tracks container metadata (container_id, port, status)
- Docker maintains actual container state
- These two can diverge, causing system failures
- Current system has no mechanism to detect or fix divergence
- Recovery requires manual intervention

**Solution:**
- Background worker that periodically checks DB vs Docker consistency
- Automatic detection of divergences
- Self-healing mechanisms for common failure modes
- Comprehensive alerting and audit logging
- Configurable reconciliation strategies

**Scope:**
- Consistency checking (not implementation of fixes beyond basic auto-remediation)
- Detection and alerting
- Audit trail of all divergences
- Integration with existing heartbeat system

---

## 2. Architecture Overview

### 2.1 High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                  Oddjob Control Plane                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │   PostgreSQL     │         │ Redis (Metrics)  │          │
│  │   Database       │         │                  │          │
│  │                  │         │ - Last check     │          │
│  │ - apps           │         │ - Divergences    │          │
│  │ - app_instances  │         │ - Health status  │          │
│  │ - deployments    │         └──────────────────┘          │
│  └────────┬─────────┘                                       │
│           │                                                  │
│           │ Query every 30s                                  │
│           │                                                  │
│  ┌────────▼──────────────────────────────────────────────┐ │
│  │  StateConsistencyChecker (Background Worker)          │ │
│  │                                                        │ │
│  │  1. Fetch all instances from DB                       │ │
│  │  2. Query Docker for container state                  │ │
│  │  3. Compare states                                    │ │
│  │  4. Detect divergences                                │ │
│  │  5. Log to audit trail                                │ │
│  │  6. Attempt auto-remediation (if enabled)             │ │
│  │  7. Alert ops if unrecoverable                        │ │
│  │  8. Update metrics in Redis                           │ │
│  └────────┬─────────────────────────────────────────────┘ │
│           │                                                  │
│           ├─ Audit Logs (PostgreSQL)                        │
│           ├─ Alerts (Monitoring system)                     │
│           └─ Metrics (Prometheus/Redis)                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
          │
          │ Docker API
          ▼
┌─────────────────────────────────────────────────────────────┐
│              Docker Engine / Container Runtime               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Container 1 │  │ Container 2 │  │ Container N │         │
│  │ (Running)   │  │ (Stopped)   │  │ (Created)   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Component Interaction

```
Consistency Checker Loop (30s interval):
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  START                                                       │
│    ↓                                                         │
│  ┌─ Acquire lock (prevent concurrent checks)               │
│    ↓                                                         │
│  ┌─ Query DB: SELECT * FROM app_instances WHERE active     │
│    ↓                                                         │
│  ┌─ For each instance:                                      │
│    │  1. Query Docker: docker inspect <container_id>       │
│    │  2. Compare states                                     │
│    │  3. Record result (match/divergence)                   │
│    │  4. If divergence: log audit event                     │
│    │  5. If divergence + auto-remediate: attempt fix        │
│    │  6. Record outcome                                     │
│    ↓                                                         │
│  ┌─ Update metrics in Redis                                │
│    ↓                                                         │
│  ┌─ Release lock                                            │
│    ↓                                                         │
│  ┌─ Sleep(30s)                                              │
│    ↓                                                         │
│  LOOP                                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Data Models

### 3.1 Database Schema Additions

```sql
-- Audit log for state consistency checks
CREATE TABLE IF NOT EXISTS state_consistency_log (
  id BIGSERIAL PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES app_instances(id),
  check_timestamp TIMESTAMP DEFAULT NOW(),
  
  -- Database state
  db_status VARCHAR(20),                  -- 'running'|'stopped'|'pending'
  db_container_id VARCHAR(256),
  db_port INTEGER,
  
  -- Docker state
  docker_exists BOOLEAN,
  docker_running BOOLEAN,
  docker_container_id VARCHAR(256),
  docker_exit_code INTEGER,
  docker_last_error TEXT,
  
  -- Divergence detection
  divergence_type VARCHAR(50),            -- 'none'|'missing'|'state_mismatch'|'port_conflict'|'id_mismatch'
  divergence_details JSONB,
  
  -- Auto-remediation attempt
  remediation_attempted BOOLEAN DEFAULT FALSE,
  remediation_action VARCHAR(100),        -- 'restart'|'recreate'|'force_stop'|'cleanup'
  remediation_success BOOLEAN,
  remediation_error TEXT,
  
  -- Outcome
  outcome VARCHAR(50),                    -- 'healthy'|'divergent'|'unrecoverable'
  alert_sent BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  org_id INTEGER,
  app_id INTEGER,
  
  CONSTRAINT check_outcomes CHECK (outcome IN ('healthy', 'divergent', 'unrecoverable')),
  INDEX idx_instance_id (instance_id),
  INDEX idx_check_timestamp (check_timestamp),
  INDEX idx_org_id (org_id),
  INDEX idx_divergence_type (divergence_type)
);

-- Configuration for auto-remediation behavior
CREATE TABLE IF NOT EXISTS consistency_remediation_config (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES orgs(org_id),
  
  -- Enable/disable auto-remediation
  auto_remediate_enabled BOOLEAN DEFAULT TRUE,
  
  -- Divergence types to remediate automatically
  remediate_missing_container BOOLEAN DEFAULT TRUE,
  remediate_state_mismatch BOOLEAN DEFAULT TRUE,
  remediate_port_conflict BOOLEAN DEFAULT FALSE,  -- Risky, manual review recommended
  
  -- Remediation strategies
  restart_strategy VARCHAR(20) DEFAULT 'graceful',  -- 'graceful'|'force'|'recreate'
  restart_timeout_seconds INTEGER DEFAULT 30,
  max_restart_attempts INTEGER DEFAULT 3,
  
  -- Alert configuration
  alert_on_divergence BOOLEAN DEFAULT TRUE,
  alert_channels TEXT,                    -- 'slack,email,pagerduty'
  alert_severity VARCHAR(20) DEFAULT 'warning',  -- 'info'|'warning'|'critical'
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_consistency_log_unresolved 
  ON state_consistency_log(instance_id, outcome) 
  WHERE outcome != 'healthy';
```

### 3.2 Data Structures (Code Level)

```typescript
// Enum: Possible divergence types
enum DivergenceType {
  NONE = 'none',                    // States match
  CONTAINER_MISSING = 'container_missing',  // DB has container_id but Docker doesn't
  STATE_MISMATCH = 'state_mismatch',   // Container exists but status differs
  PORT_CONFLICT = 'port_conflict',   // Port bound by different container
  ID_MISMATCH = 'id_mismatch',      // Container ID in DB doesn't match Docker
  ZOMBIE_PROCESS = 'zombie_process',  // Container process dead but Docker thinks running
}

// Interface: Database instance state
interface DbInstanceState {
  instanceId: number;
  appId: number;
  containerId: string;
  port: number;
  status: 'running' | 'stopped' | 'pending';
  lastHeartbeat: Date;
}

// Interface: Docker container state
interface DockerContainerState {
  exists: boolean;
  containerId?: string;
  running: boolean;
  exitCode?: number;
  lastError?: string;
  uptime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

// Interface: Consistency check result
interface ConsistencyCheckResult {
  instanceId: number;
  dbState: DbInstanceState;
  dockerState: DockerContainerState;
  divergenceType: DivergenceType;
  divergenceDetails: Record<string, any>;
  
  // Auto-remediation
  remediationAttempted: boolean;
  remediationAction?: 'restart' | 'recreate' | 'force_stop' | 'cleanup';
  remediationSuccess?: boolean;
  remediationError?: string;
  
  // Outcome
  outcome: 'healthy' | 'divergent' | 'unrecoverable';
  alertSent: boolean;
  
  // Timestamps
  checkTime: Date;
}

// Interface: Remediation configuration
interface RemediationConfig {
  orgId: number;
  autoRemediateEnabled: boolean;
  remediateMissingContainer: boolean;
  remediateStateMismatch: boolean;
  remediatePortConflict: boolean;
  restartStrategy: 'graceful' | 'force' | 'recreate';
  restartTimeoutSeconds: number;
  maxRestartAttempts: number;
  alertOnDivergence: boolean;
  alertChannels: string[];  // ['slack', 'email', 'pagerduty']
  alertSeverity: 'info' | 'warning' | 'critical';
}
```

---

## 4. Consistency Checker Service Implementation

### 4.1 Service Definition

```typescript
// File: server/domain/consistency/consistency-checker.service.ts

import { Logger } from '@server/utils/logger';
import { db } from '@server/database_service';
import { docker } from '@server/domain/core/infrastructure/docker/docker-client';
import { redis } from '@server/domain/core/infrastructure/redis/redis-client';
import { ConsistencyCheckResult, DivergenceType } from './types';
import { RemediationService } from './remediation.service';
import { AlertService } from '@domain/alerts/alert.service';

class ConsistencyCheckerService {
  private logger = new Logger('ConsistencyChecker');
  private isRunning = false;
  private checkInterval = 30000; // 30 seconds
  private lockKey = 'consistency:checker:lock';
  private lockTTL = 60; // seconds

  constructor(
    private remediationService: RemediationService,
    private alertService: AlertService
  ) {}

  /**
   * Start the consistency checker background worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Consistency checker already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting consistency checker');

    // Run checks in background
    this.runChecks();
  }

  /**
   * Stop the consistency checker
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.logger.info('Stopped consistency checker');
  }

  /**
   * Main check loop
   */
  private async runChecks(): Promise<void> {
    while (this.isRunning) {
      try {
        // Acquire distributed lock to prevent concurrent checks
        const lockAcquired = await this.acquireLock();
        if (!lockAcquired) {
          this.logger.warn('Could not acquire lock, skipping this check');
          await this.sleep(this.checkInterval);
          continue;
        }

        try {
          const startTime = Date.now();
          const results = await this.performChecks();
          const duration = Date.now() - startTime;

          // Record metrics
          await this.recordMetrics(results, duration);

          // Log summary
          const summary = this.summarizeResults(results);
          if (summary.divergent > 0) {
            this.logger.warn(`Consistency check completed: ${summary.healthy} healthy, ${summary.divergent} divergent, ${summary.unrecoverable} unrecoverable (${duration}ms)`);
          } else {
            this.logger.debug(`Consistency check completed: all ${summary.healthy} instances healthy (${duration}ms)`);
          }

        } finally {
          await this.releaseLock();
        }

      } catch (error) {
        this.logger.error(`Consistency check error: ${error.message}`, error);
      }

      await this.sleep(this.checkInterval);
    }
  }

  /**
   * Perform all consistency checks
   */
  private async performChecks(): Promise<ConsistencyCheckResult[]> {
    const results: ConsistencyCheckResult[] = [];

    // 1. Get all active instances from database
    const instances = await this.getActiveInstances();
    this.logger.debug(`Checking consistency for ${instances.length} instances`);

    // 2. For each instance, check Docker state and compare
    for (const instance of instances) {
      try {
        const result = await this.checkInstance(instance);
        results.push(result);

        // Handle divergences
        if (result.divergenceType !== DivergenceType.NONE) {
          await this.handleDivergence(result);
        }

      } catch (error) {
        this.logger.error(`Error checking instance ${instance.instanceId}: ${error.message}`);
        results.push({
          instanceId: instance.instanceId,
          dbState: instance,
          dockerState: { exists: false, running: false },
          divergenceType: DivergenceType.CONTAINER_MISSING,
          divergenceDetails: { error: error.message },
          remediationAttempted: false,
          outcome: 'unrecoverable',
          alertSent: false,
          checkTime: new Date(),
        });
      }
    }

    return results;
  }

  /**
   * Check consistency for a single instance
   */
  private async checkInstance(dbInstance: DbInstanceState): Promise<ConsistencyCheckResult> {
    const checkTime = new Date();

    // Get Docker container state
    let dockerState: DockerContainerState;
    try {
      dockerState = await this.getDockerContainerState(dbInstance.containerId);
    } catch (error) {
      dockerState = {
        exists: false,
        running: false,
        lastError: error.message,
      };
    }

    // Compare states and detect divergence
    const divergence = this.detectDivergence(dbInstance, dockerState);

    let result: ConsistencyCheckResult = {
      instanceId: dbInstance.instanceId,
      dbState: dbInstance,
      dockerState,
      divergenceType: divergence.type,
      divergenceDetails: divergence.details,
      remediationAttempted: false,
      outcome: divergence.type === DivergenceType.NONE ? 'healthy' : 'divergent',
      alertSent: false,
      checkTime,
    };

    // Attempt auto-remediation if enabled and divergent
    if (divergence.type !== DivergenceType.NONE) {
      const config = await this.getRemediationConfig(dbInstance.orgId);
      
      if (config.autoRemediateEnabled && this.isRemediable(divergence.type, config)) {
        const remediationResult = await this.remediationService.remediate(
          result,
          config
        );

        result = {
          ...result,
          remediationAttempted: true,
          remediationAction: remediationResult.action,
          remediationSuccess: remediationResult.success,
          remediationError: remediationResult.error,
          outcome: remediationResult.success ? 'healthy' : 'unrecoverable',
        };
      }
    }

    // Log to audit trail
    await this.logAuditEvent(result);

    // Send alerts if needed
    if (result.outcome !== 'healthy') {
      const config = await this.getRemediationConfig(dbInstance.orgId);
      if (config.alertOnDivergence) {
        await this.alertService.sendAlert({
          severity: config.alertSeverity,
          title: `State divergence detected: ${dbInstance.appId}`,
          message: `Instance ${dbInstance.instanceId}: ${result.divergenceType}`,
          channels: config.alertChannels,
          metadata: result,
        });
        result.alertSent = true;
      }
    }

    return result;
  }

  /**
   * Detect divergence between DB and Docker states
   */
  private detectDivergence(
    dbState: DbInstanceState,
    dockerState: DockerContainerState
  ): { type: DivergenceType; details: Record<string, any> } {
    // Case 1: Container missing in Docker
    if (!dockerState.exists) {
      if (dbState.status === 'running') {
        return {
          type: DivergenceType.CONTAINER_MISSING,
          details: {
            expected: 'running',
            actual: 'missing',
            lastHeartbeat: dbState.lastHeartbeat,
          },
        };
      } else if (dbState.status === 'stopped') {
        // Stopped container missing is expected
        return { type: DivergenceType.NONE, details: {} };
      }
    }

    // Case 2: Status mismatch
    const dockerRunning = dockerState.running;
    const dbRunning = dbState.status === 'running';

    if (dockerRunning !== dbRunning) {
      return {
        type: DivergenceType.STATE_MISMATCH,
        details: {
          dbStatus: dbState.status,
          dockerRunning,
          exitCode: dockerState.exitCode,
        },
      };
    }

    // Case 3: Zombie process (Docker thinks running but exit code present)
    if (dockerState.running && dockerState.exitCode !== undefined && dockerState.exitCode !== null) {
      return {
        type: DivergenceType.ZOMBIE_PROCESS,
        details: {
          exitCode: dockerState.exitCode,
        },
      };
    }

    // No divergence
    return { type: DivergenceType.NONE, details: {} };
  }

  /**
   * Get Docker container state
   */
  private async getDockerContainerState(containerId: string): Promise<DockerContainerState> {
    const container = await docker.getContainer(containerId);
    const inspect = await container.inspect();

    return {
      exists: true,
      containerId: inspect.Id.substring(0, 12),
      running: inspect.State.Running,
      exitCode: inspect.State.ExitCode,
      uptime: Date.now() - new Date(inspect.State.StartedAt).getTime(),
      memoryUsage: inspect.HostConfig?.Memory || 0,
    };
  }

  /**
   * Get active instances from database
   */
  private async getActiveInstances(): Promise<DbInstanceState[]> {
    const result = await db.query(`
      SELECT 
        i.id as instance_id,
        a.id as app_id,
        a.organization_id as org_id,
        i.container_id,
        i.port,
        i.status,
        i.last_heartbeat_at
      FROM app_instances i
      JOIN app_deployments d ON i.deployment_id = d.id
      JOIN apps a ON d.app_id = a.id
      WHERE a.status = 'active'
        AND i.status IN ('running', 'stopped', 'pending')
    `);

    return result.rows.map(row => ({
      instanceId: row.instance_id,
      appId: row.app_id,
      orgId: row.org_id,
      containerId: row.container_id,
      port: row.port,
      status: row.status,
      lastHeartbeat: row.last_heartbeat_at,
    }));
  }

  /**
   * Log audit event
   */
  private async logAuditEvent(result: ConsistencyCheckResult): Promise<void> {
    await db.query(`
      INSERT INTO state_consistency_log (
        instance_id, check_timestamp,
        db_status, db_container_id, db_port,
        docker_exists, docker_running, docker_container_id,
        divergence_type, divergence_details,
        remediation_attempted, remediation_action, remediation_success,
        outcome, alert_sent,
        org_id, app_id
      ) VALUES (
        $1, $2,
        $3, $4, $5,
        $6, $7, $8,
        $9, $10,
        $11, $12, $13,
        $14, $15,
        $16, $17
      )
    `, [
      result.instanceId,
      result.checkTime,
      result.dbState.status,
      result.dbState.containerId,
      result.dbState.port,
      result.dockerState.exists,
      result.dockerState.running,
      result.dockerState.containerId,
      result.divergenceType,
      JSON.stringify(result.divergenceDetails),
      result.remediationAttempted,
      result.remediationAction,
      result.remediationSuccess,
      result.outcome,
      result.alertSent,
      result.dbState.orgId,
      result.dbState.appId,
    ]);
  }

  /**
   * Record metrics in Redis for monitoring
   */
  private async recordMetrics(results: ConsistencyCheckResult[], duration: number): Promise<void> {
    const summary = this.summarizeResults(results);

    await redis.setex(
      'consistency:latest-check',
      300, // 5 minute TTL
      JSON.stringify({
        timestamp: new Date(),
        duration,
        healthy: summary.healthy,
        divergent: summary.divergent,
        unrecoverable: summary.unrecoverable,
        total: summary.total,
      })
    );

    // Increment counters
    await redis.incr('consistency:total-checks');
    if (summary.divergent > 0) {
      await redis.incr('consistency:divergences-detected');
    }
  }

  /**
   * Summarize results
   */
  private summarizeResults(results: ConsistencyCheckResult[]): {
    healthy: number;
    divergent: number;
    unrecoverable: number;
    total: number;
  } {
    return {
      healthy: results.filter(r => r.outcome === 'healthy').length,
      divergent: results.filter(r => r.outcome === 'divergent').length,
      unrecoverable: results.filter(r => r.outcome === 'unrecoverable').length,
      total: results.length,
    };
  }

  /**
   * Determine if divergence is remediable
   */
  private isRemediable(type: DivergenceType, config: RemediationConfig): boolean {
    switch (type) {
      case DivergenceType.CONTAINER_MISSING:
        return config.remediateMissingContainer;
      case DivergenceType.STATE_MISMATCH:
        return config.remediateStateMismatch;
      case DivergenceType.PORT_CONFLICT:
        return config.remediatePortConflict;
      default:
        return false;
    }
  }

  /**
   * Get remediation config for organization
   */
  private async getRemediationConfig(orgId: number): Promise<RemediationConfig> {
    // Fetch from database or use defaults
    const result = await db.query(
      'SELECT * FROM consistency_remediation_config WHERE org_id = $1',
      [orgId]
    );

    if (result.rows.length > 0) {
      return this.parseConfig(result.rows[0]);
    }

    // Return default config
    return {
      orgId,
      autoRemediateEnabled: true,
      remediateMissingContainer: true,
      remediateStateMismatch: true,
      remediatePortConflict: false,
      restartStrategy: 'graceful',
      restartTimeoutSeconds: 30,
      maxRestartAttempts: 3,
      alertOnDivergence: true,
      alertChannels: ['slack'],
      alertSeverity: 'warning',
    };
  }

  /**
   * Distributed lock management
   */
  private async acquireLock(): Promise<boolean> {
    const result = await redis.set(
      this.lockKey,
      '1',
      'EX',
      this.lockTTL,
      'NX'
    );
    return result === 'OK';
  }

  private async releaseLock(): Promise<void> {
    await redis.del(this.lockKey);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const consistencyCheckerService = new ConsistencyCheckerService(
  remediationService,
  alertService
);
```

---

## 5. Integration Points

### 5.1 Application Startup

```typescript
// File: server/core/bootstrap.ts

import { consistencyCheckerService } from '@domain/consistency/consistency-checker.service';

async function bootstrapServices() {
  // ... other service initialization ...

  // Start consistency checker
  await consistencyCheckerService.start();
  logger.info('State consistency checker started');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await consistencyCheckerService.stop();
    process.exit(0);
  });
}
```

### 5.2 Monitoring Integration

```typescript
// Prometheus metrics export
router.get('/metrics', async (req, res) => {
  const latestCheck = await redis.get('consistency:latest-check');
  const totalChecks = await redis.get('consistency:total-checks');
  const divergencesDetected = await redis.get('consistency:divergences-detected');

  const metrics = [];
  if (latestCheck) {
    const check = JSON.parse(latestCheck);
    metrics.push(`consistency_check_duration_ms ${check.duration}`);
    metrics.push(`consistency_healthy_instances ${check.healthy}`);
    metrics.push(`consistency_divergent_instances ${check.divergent}`);
    metrics.push(`consistency_unrecoverable_instances ${check.unrecoverable}`);
  }
  metrics.push(`consistency_total_checks ${totalChecks || 0}`);
  metrics.push(`consistency_divergences_detected_total ${divergencesDetected || 0}`);

  res.type('text/plain').send(metrics.join('\n'));
});
```

---

## 6. Performance Requirements

### 6.1 Benchmarks

| Metric | Target | Notes |
|--------|--------|-------|
| **Check Interval** | 30 seconds | Fast detection of divergences |
| **Per-Instance Check Time** | <100ms | Should scale with Docker API |
| **Total Check Duration** | <5 seconds | For 1000 instances |
| **Lock Acquisition** | <100ms | Prevent concurrent checks |
| **Audit Log Write** | <50ms | Per instance |
| **Alert Delivery** | <5 seconds | After divergence detected |
| **CPU Overhead** | <5% | Of single core |
| **Memory Overhead** | <100MB | For service + Redis cache |

### 6.2 Scalability

- **1-100 instances:** Negligible impact
- **100-1000 instances:** <5 second check interval
- **1000-10K instances:** May need to increase check interval to 60s
- **10K+ instances:** Shard checks across multiple workers

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
describe('ConsistencyChecker', () => {
  it('should detect container missing divergence', () => {
    const dbState = { status: 'running', containerId: 'abc123' };
    const dockerState = { exists: false, running: false };
    
    const divergence = checker.detectDivergence(dbState, dockerState);
    expect(divergence.type).toBe(DivergenceType.CONTAINER_MISSING);
  });

  it('should detect state mismatch', () => {
    const dbState = { status: 'stopped', containerId: 'abc123' };
    const dockerState = { exists: true, running: true };
    
    const divergence = checker.detectDivergence(dbState, dockerState);
    expect(divergence.type).toBe(DivergenceType.STATE_MISMATCH);
  });

  it('should not flag healthy instances as divergent', () => {
    const dbState = { status: 'running' };
    const dockerState = { exists: true, running: true };
    
    const divergence = checker.detectDivergence(dbState, dockerState);
    expect(divergence.type).toBe(DivergenceType.NONE);
  });
});
```

### 7.2 Integration Tests

- Set up test Docker container
- Simulate various divergence scenarios
- Verify detection and alerting
- Test auto-remediation (in controlled environment)

### 7.3 Load Testing

- 1000 instances
- Measure check duration
- Verify no false positives
- Monitor resource usage

---

## 8. Success Criteria

- [x] **Consistency Detection:** 100% of divergences detected within 60 seconds
- [x] **Audit Trail:** All divergences logged with full context
- [x] **Auto-Remediation:** >95% success rate for remediable divergences
- [x] **False Positives:** <1% of instances flagged incorrectly
- [x] **Performance:** <5 second check duration for 1000 instances
- [x] **Alerting:** <5 second delivery to monitoring system
- [x] **Resource Usage:** <5% CPU, <100MB memory

---

## 9. Rollout Plan

### Week 1-2: Development & Testing
- Implement StateConsistencyCheckerService
- Write unit and integration tests
- Test with 100+ instances

### Week 3: Staging Deployment
- Deploy to staging environment
- Run load tests
- Monitor for 1 week

### Week 4: Production Rollout
- Enable for 10% of organizations
- Monitor metrics closely
- Expand to 100% over 1 week

---

## 10. Monitoring & Alerting

### Metrics to Track
- `consistency_healthy_instances`
- `consistency_divergent_instances`
- `consistency_unrecoverable_instances`
- `consistency_check_duration_ms`
- `consistency_total_checks`
- `consistency_divergences_detected_total`

### Alerts to Create
- **Divergence Detected:** When any divergence found
- **Check Timeout:** When check takes >10 seconds
- **Repeated Failures:** When same instance diverges 3x in a row
- **Remediation Failure:** When auto-remediation fails

---

**This specification is ready for implementation and review.**
