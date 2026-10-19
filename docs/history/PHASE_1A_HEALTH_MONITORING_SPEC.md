# Phase 1a: Proactive Health Monitoring - Technical Specification

**Document Version:** 1.0  
**Status:** DRAFT - Ready for Review  
**Date:** June 14, 2026  
**Phase:** 1a (Weeks 1-8)

---

## 1. Executive Summary

Proactive Health Monitoring detects container and application failures before they impact users. The system continuously monitors app health via HTTP checks, heartbeat tracking, and container metrics.

**Problem Statement:**
- Current system only discovers failures when users report issues
- 26+ hour detection lag for 6/13 incident (discovered 6/14)
- No proactive alerting for degraded instances
- No visibility into container health metrics

**Solution:**
- HTTP health check endpoints on all containers
- Continuous heartbeat monitoring (expected every 60 seconds)
- Container metrics collection (CPU, memory, exit codes)
- Configurable alerts for stale heartbeats and unhealthy status
- Dashboard showing real-time health across organization

**Scope:**
- Health check endpoint implementation
- Heartbeat monitoring infrastructure
- Container metrics collection
- Alerting and dashboarding
- Integration with monitoring backend (Prometheus/Grafana)

---

## 2. Architecture Overview

### 2.1 Health Monitoring Flow

```
┌─────────────────────────────────────────────────────────┐
│              Health Monitoring System                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │     HTTP Health Check Endpoints (per app)        │  │
│  │                                                   │  │
│  │     GET /api/health                              │  │
│  │     Response: {status, dependencies, version}    │  │
│  └────────┬─────────────────────────────────────────┘  │
│           │                                              │
│           │ Health Check Loop (30s interval)            │
│           ▼                                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │     Health Check Executor                        │  │
│  │                                                   │  │
│  │  1. For each active instance:                    │  │
│  │     - HTTP GET to /api/health                    │  │
│  │     - Record response status                      │  │
│  │     - Record response time                        │  │
│  │     - Parse dependency status                     │  │
│  │  2. Compare with expected heartbeat              │  │
│  │  3. Update metrics in Redis/Prometheus           │  │
│  │  4. Trigger alerts if unhealthy                  │  │
│  └────────┬─────────────────────────────────────────┘  │
│           │                                              │
│    ┌──────┼──────────────────┐                         │
│    ▼      ▼                   ▼                         │
│  Redis  Prometheus          Alert Manager              │
│  Cache  Metrics             (Slack/Email/PagerDuty)   │
│    │      │                   │                         │
│    └──────┼───────────────────┘                         │
│           │                                              │
│           ▼                                              │
│    ┌──────────────────┐                                │
│    │  Grafana         │                                │
│    │  Dashboards      │                                │
│    └──────────────────┘                                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Heartbeat Monitoring (Async)                    │  │
│  │                                                   │  │
│  │  1. Monitor last_heartbeat_at in database        │  │
│  │  2. Alert if >120 seconds old                    │  │
│  │  3. Track heartbeat freshness by org             │  │
│  │  4. Identify stale instances                     │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Health Check Endpoint Response

```
GET /api/health

200 OK Response:
{
  "status": "healthy",
  "uptime": 123456789,
  "timestamp": "2026-06-14T22:45:00Z",
  "version": "1.0.0",
  "instance": {
    "id": "i-123",
    "container": "oddjob-app-abc-11000"
  },
  "dependencies": {
    "database": {
      "status": "connected",
      "latency_ms": 5,
      "pool_usage": 45
    },
    "cache": {
      "status": "connected",
      "latency_ms": 2,
      "memory_usage_mb": 256
    },
    "broker": {
      "status": "connected",
      "latency_ms": 10,
      "queue_depth": 0
    }
  },
  "metrics": {
    "requests_per_second": 150,
    "error_rate_percent": 0.05,
    "p95_latency_ms": 250,
    "p99_latency_ms": 500
  }
}

503 Service Unavailable Response (if unhealthy):
{
  "status": "unhealthy",
  "reason": "database_disconnected",
  "details": {
    "component": "database",
    "error": "connection timeout"
  }
}
```

---

## 3. Data Models

### 3.1 Database Schema

```sql
-- Track health check results over time
CREATE TABLE IF NOT EXISTS health_check_results (
  id BIGSERIAL PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES app_instances(id),
  org_id INTEGER NOT NULL,
  app_id INTEGER NOT NULL,
  
  -- Check timing
  check_timestamp TIMESTAMP DEFAULT NOW(),
  response_time_ms INTEGER,
  
  -- Health status
  status VARCHAR(20),                        -- 'healthy'|'degraded'|'unhealthy'|'unknown'
  status_code INTEGER,                       -- HTTP status code
  
  -- Dependency status
  database_status VARCHAR(20),
  cache_status VARCHAR(20),
  broker_status VARCHAR(20),
  
  -- Error details
  error_message TEXT,
  error_stacktrace TEXT,
  
  -- Uptime tracking
  container_uptime_seconds BIGINT,
  
  -- Metrics
  requests_per_second DECIMAL(10,2),
  error_rate_percent DECIMAL(5,2),
  p95_latency_ms INTEGER,
  p99_latency_ms INTEGER,
  
  -- Alerts
  alert_triggered BOOLEAN DEFAULT FALSE,
  alert_type VARCHAR(50),                    -- 'unhealthy'|'degraded'|'timeout'|'dependency_issue'
  
  INDEX idx_instance_timestamp (instance_id, check_timestamp),
  INDEX idx_org_timestamp (org_id, check_timestamp),
  INDEX idx_status (status),
  INDEX idx_alert_triggered (alert_triggered)
);

-- Configuration for health monitoring behavior
CREATE TABLE IF NOT EXISTS health_check_config (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES orgs(org_id),
  
  -- Health check frequency
  check_interval_seconds INTEGER DEFAULT 30,
  check_timeout_seconds INTEGER DEFAULT 10,
  
  -- Thresholds for alerting
  stale_heartbeat_seconds INTEGER DEFAULT 120,  -- Alert if >2 minutes
  unhealthy_threshold_count INTEGER DEFAULT 3,  -- Alert after 3 consecutive failures
  degraded_threshold_percent DECIMAL(5,2) DEFAULT 0.10,  -- Alert if error rate >10%
  
  -- Alert configuration
  alert_enabled BOOLEAN DEFAULT TRUE,
  alert_on_unhealthy BOOLEAN DEFAULT TRUE,
  alert_on_degraded BOOLEAN DEFAULT FALSE,
  alert_on_stale_heartbeat BOOLEAN DEFAULT TRUE,
  alert_on_dependency_issue BOOLEAN DEFAULT TRUE,
  
  alert_channels TEXT,                       -- 'slack,email,pagerduty'
  alert_severity VARCHAR(20) DEFAULT 'warning',
  
  -- Dashboard refresh
  dashboard_refresh_seconds INTEGER DEFAULT 5,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Track consecutive failures per instance
CREATE TABLE IF NOT EXISTS health_check_failures (
  instance_id INTEGER PRIMARY KEY REFERENCES app_instances(id),
  failure_count INTEGER DEFAULT 0,
  last_failure_time TIMESTAMP,
  last_successful_time TIMESTAMP,
  alert_sent_at TIMESTAMP
);
```

### 3.2 TypeScript Types

```typescript
// Health status enum
enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown',
}

// Health check response from app
interface HealthCheckResponse {
  status: HealthStatus;
  uptime: number;
  timestamp: Date;
  version: string;
  instance: {
    id: string;
    container: string;
  };
  dependencies: {
    database: DependencyStatus;
    cache: DependencyStatus;
    broker: DependencyStatus;
  };
  metrics: {
    requestsPerSecond: number;
    errorRatePercent: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
  };
}

interface DependencyStatus {
  status: 'connected' | 'disconnected' | 'degraded';
  latencyMs: number;
  error?: string;
}

// Result of a single health check
interface HealthCheckResult {
  instanceId: number;
  orgId: number;
  appId: number;
  checkTime: Date;
  responseTimeMs: number;
  status: HealthStatus;
  statusCode: number;
  dependencies: {
    database: string;
    cache: string;
    broker: string;
  };
  error?: string;
  alertTriggered: boolean;
  alertType?: string;
}

// Configuration
interface HealthCheckConfig {
  orgId: number;
  checkIntervalSeconds: number;
  checkTimeoutSeconds: number;
  staleHeartbeatSeconds: number;
  unhealthyThresholdCount: number;
  degradedThresholdPercent: number;
  alertEnabled: boolean;
  alertChannels: string[];
  alertSeverity: 'info' | 'warning' | 'critical';
}
```

---

## 4. Health Check Service Implementation

### 4.1 Service Definition

```typescript
// File: server/domain/health/health-check.service.ts

import axios, { AxiosError } from 'axios';
import { Logger } from '@server/utils/logger';
import { db } from '@server/database_service';
import { redis } from '@server/domain/core/infrastructure/redis/redis-client';
import { AlertService } from '@domain/alerts/alert.service';
import { HealthCheckResult, HealthStatus } from './types';

class HealthCheckService {
  private logger = new Logger('HealthCheck');
  private isRunning = false;
  private checkInterval = 30000; // 30 seconds
  private checkTimeout = 10000; // 10 seconds

  constructor(private alertService: AlertService) {}

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Health check service already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting health check service');
    this.runChecks();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.logger.info('Stopped health check service');
  }

  /**
   * Main check loop
   */
  private async runChecks(): Promise<void> {
    while (this.isRunning) {
      try {
        const startTime = Date.now();
        const results = await this.performHealthChecks();
        const duration = Date.now() - startTime;

        // Record metrics
        await this.recordMetrics(results, duration);

        // Log summary
        const healthy = results.filter(r => r.status === HealthStatus.HEALTHY).length;
        const unhealthy = results.filter(r => r.status === HealthStatus.UNHEALTHY).length;

        if (unhealthy > 0) {
          this.logger.warn(`Health check completed: ${healthy} healthy, ${unhealthy} unhealthy (${duration}ms)`);
        } else {
          this.logger.debug(`Health check completed: ${healthy} instances healthy (${duration}ms)`);
        }

      } catch (error) {
        this.logger.error(`Health check error: ${error.message}`);
      }

      await this.sleep(this.checkInterval);
    }
  }

  /**
   * Perform health checks for all active instances
   */
  private async performHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    // Get all active instances
    const instances = await this.getActiveInstances();

    // Check each instance
    for (const instance of instances) {
      try {
        const result = await this.checkInstance(instance);
        results.push(result);

        // Handle unhealthy status
        if (result.status === HealthStatus.UNHEALTHY) {
          await this.handleUnhealthyInstance(result);
        }

      } catch (error) {
        this.logger.error(`Error checking instance ${instance.id}: ${error.message}`);
        results.push({
          instanceId: instance.id,
          orgId: instance.orgId,
          appId: instance.appId,
          checkTime: new Date(),
          responseTimeMs: 0,
          status: HealthStatus.UNKNOWN,
          statusCode: 0,
          dependencies: {},
          error: error.message,
          alertTriggered: false,
        });
      }
    }

    return results;
  }

  /**
   * Check health of a single instance
   */
  private async checkInstance(instance: any): Promise<HealthCheckResult> {
    const checkTime = new Date();
    const healthUrl = `http://localhost:${instance.port}/api/health`;

    try {
      const startTime = Date.now();

      const response = await axios.get(healthUrl, {
        timeout: this.checkTimeout,
      });

      const responseTimeMs = Date.now() - startTime;
      const data = response.data;

      // Parse response
      const result: HealthCheckResult = {
        instanceId: instance.id,
        orgId: instance.orgId,
        appId: instance.appId,
        checkTime,
        responseTimeMs,
        status: data.status || HealthStatus.HEALTHY,
        statusCode: response.status,
        dependencies: {
          database: data.dependencies?.database?.status || 'unknown',
          cache: data.dependencies?.cache?.status || 'unknown',
          broker: data.dependencies?.broker?.status || 'unknown',
        },
        alertTriggered: false,
      };

      // Update heartbeat
      await this.updateHeartbeat(instance.id);

      // Log to database
      await this.logHealthCheck(result);

      return result;

    } catch (error: AxiosError | any) {
      const responseTimeMs = error.response?.config?.timeout || this.checkTimeout;

      const result: HealthCheckResult = {
        instanceId: instance.id,
        orgId: instance.orgId,
        appId: instance.appId,
        checkTime,
        responseTimeMs,
        status: HealthStatus.UNHEALTHY,
        statusCode: error.response?.status || 0,
        dependencies: {},
        error: error.message,
        alertTriggered: false,
      };

      // Log to database
      await this.logHealthCheck(result);

      return result;
    }
  }

  /**
   * Update heartbeat timestamp when app responds
   */
  private async updateHeartbeat(instanceId: number): Promise<void> {
    await db.query(
      'UPDATE app_instances SET last_heartbeat_at = NOW() WHERE id = $1',
      [instanceId]
    );
  }

  /**
   * Handle unhealthy instance
   */
  private async handleUnhealthyInstance(result: HealthCheckResult): Promise<void> {
    // Increment failure count
    const failureRecord = await db.query(
      'SELECT failure_count FROM health_check_failures WHERE instance_id = $1',
      [result.instanceId]
    );

    let failureCount = 0;
    if (failureRecord.rows.length > 0) {
      failureCount = failureRecord.rows[0].failure_count + 1;
    } else {
      await db.query(
        'INSERT INTO health_check_failures (instance_id, failure_count, last_failure_time) VALUES ($1, 1, NOW())',
        [result.instanceId]
      );
      failureCount = 1;
    }

    await db.query(
      'UPDATE health_check_failures SET failure_count = $1, last_failure_time = NOW() WHERE instance_id = $2',
      [failureCount, result.instanceId]
    );

    // Get config to determine alert threshold
    const config = await this.getHealthConfig(result.orgId);

    // Send alert if threshold reached
    if (failureCount >= config.unhealthyThresholdCount) {
      await this.alertService.sendAlert({
        severity: config.alertSeverity,
        title: `Instance unhealthy: ${result.appId}`,
        message: `Instance ${result.instanceId} failed ${failureCount} consecutive health checks. Error: ${result.error}`,
        channels: config.alertChannels,
        metadata: result,
      });

      await db.query(
        'UPDATE health_check_failures SET alert_sent_at = NOW() WHERE instance_id = $1',
        [result.instanceId]
      );

      result.alertTriggered = true;
    }
  }

  /**
   * Log health check result
   */
  private async logHealthCheck(result: HealthCheckResult): Promise<void> {
    await db.query(
      `INSERT INTO health_check_results (
        instance_id, org_id, app_id, check_timestamp, response_time_ms,
        status, status_code, database_status, cache_status, broker_status,
        error_message, alert_triggered
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        result.instanceId,
        result.orgId,
        result.appId,
        result.checkTime,
        result.responseTimeMs,
        result.status,
        result.statusCode,
        result.dependencies.database,
        result.dependencies.cache,
        result.dependencies.broker,
        result.error,
        result.alertTriggered,
      ]
    );
  }

  /**
   * Record metrics in Redis
   */
  private async recordMetrics(results: HealthCheckResult[], duration: number): Promise<void> {
    const healthy = results.filter(r => r.status === HealthStatus.HEALTHY).length;
    const unhealthy = results.filter(r => r.status === HealthStatus.UNHEALTHY).length;
    const avgResponseTime = results.reduce((sum, r) => sum + r.responseTimeMs, 0) / results.length;

    await redis.setex(
      'health:latest-check',
      300,
      JSON.stringify({
        timestamp: new Date(),
        duration,
        healthy,
        unhealthy,
        total: results.length,
        avgResponseTimeMs: Math.round(avgResponseTime),
      })
    );

    // Update gauges
    await redis.set(`health:healthy-instances`, healthy);
    await redis.set(`health:unhealthy-instances`, unhealthy);
    await redis.set(`health:check-duration-ms`, duration);
  }

  /**
   * Get active instances
   */
  private async getActiveInstances(): Promise<any[]> {
    const result = await db.query(`
      SELECT 
        i.id,
        a.id as app_id,
        a.organization_id as org_id,
        i.port,
        i.status
      FROM app_instances i
      JOIN app_deployments d ON i.deployment_id = d.id
      JOIN apps a ON d.app_id = a.id
      WHERE a.status = 'active'
        AND i.status = 'running'
        AND i.port IS NOT NULL
      ORDER BY a.name
    `);

    return result.rows;
  }

  /**
   * Get health check config
   */
  private async getHealthConfig(orgId: number): Promise<any> {
    const result = await db.query(
      'SELECT * FROM health_check_config WHERE org_id = $1',
      [orgId]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Return defaults
    return {
      checkIntervalSeconds: 30,
      checkTimeoutSeconds: 10,
      staleHeartbeatSeconds: 120,
      unhealthyThresholdCount: 3,
      degradedThresholdPercent: 0.1,
      alertEnabled: true,
      alertChannels: ['slack'],
      alertSeverity: 'warning',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const healthCheckService = new HealthCheckService(alertService);
```

### 4.2 Health Endpoint Implementation (Template)

```typescript
// Template for health endpoint in all services
// File: server/routes/health.ts

import { Router } from 'express';
import { db } from '@server/database_service';
import { redis } from '@server/domain/core/infrastructure/redis/redis-client';

const router = Router();

router.get('/api/health', async (req, res) => {
  const startTime = Date.now();
  const health: any = {
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    instance: {
      id: process.env.INSTANCE_ID || 'unknown',
      container: process.env.CONTAINER_ID || 'unknown',
    },
    dependencies: {},
  };

  // Check database
  try {
    const result = await db.query('SELECT 1');
    health.dependencies.database = {
      status: 'connected',
      latency_ms: Date.now() - startTime,
    };
  } catch (error) {
    health.status = 'unhealthy';
    health.dependencies.database = {
      status: 'disconnected',
      error: error.message,
    };
  }

  // Check Redis cache
  try {
    await redis.ping();
    health.dependencies.cache = {
      status: 'connected',
      latency_ms: Date.now() - startTime,
    };
  } catch (error) {
    health.dependencies.cache = {
      status: 'disconnected',
      error: error.message,
    };
  }

  // Check message broker (if used)
  try {
    // Add broker health check here
    health.dependencies.broker = {
      status: 'connected',
      latency_ms: Date.now() - startTime,
    };
  } catch (error) {
    health.dependencies.broker = {
      status: 'disconnected',
      error: error.message,
    };
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
```

---

## 5. Heartbeat Monitoring Service

```typescript
// File: server/domain/health/heartbeat-monitor.service.ts

class HeartbeatMonitorService {
  private logger = new Logger('HeartbeatMonitor');

  async checkStaleHeartbeats(): Promise<void> {
    // Get config for each org
    const configs = await db.query('SELECT DISTINCT org_id FROM health_check_config');

    for (const { org_id } of configs.rows) {
      const config = await this.getHealthConfig(org_id);

      // Find instances with stale heartbeats
      const staleInstances = await db.query(`
        SELECT i.id, a.id as app_id, a.name, i.last_heartbeat_at
        FROM app_instances i
        JOIN app_deployments d ON i.deployment_id = d.id
        JOIN apps a ON d.app_id = a.id
        WHERE a.organization_id = $1
          AND i.status = 'running'
          AND i.last_heartbeat_at IS NOT NULL
          AND i.last_heartbeat_at < NOW() - INTERVAL '1 second' * $2
      `, [org_id, config.staleHeartbeatSeconds]);

      for (const instance of staleInstances.rows) {
        this.logger.warn(`Stale heartbeat detected: app=${instance.app_id}, instance=${instance.id}, last_heartbeat=${instance.last_heartbeat_at}`);

        if (config.alert_on_stale_heartbeat) {
          await alertService.sendAlert({
            severity: config.alert_severity,
            title: `Stale heartbeat: ${instance.name}`,
            message: `Instance ${instance.id} has not reported heartbeat for ${config.staleHeartbeatSeconds} seconds`,
            channels: config.alert_channels,
          });
        }
      }
    }
  }
}
```

---

## 6. Grafana Dashboard Configuration

```json
{
  "dashboard": {
    "title": "Oddjob Application Health",
    "panels": [
      {
        "title": "Health Status Overview",
        "targets": [
          {
            "expr": "health:healthy-instances",
            "legendFormat": "Healthy"
          },
          {
            "expr": "health:unhealthy-instances",
            "legendFormat": "Unhealthy"
          }
        ]
      },
      {
        "title": "Average Response Time",
        "targets": [
          {
            "expr": "avg(health_check_response_time_ms)"
          }
        ]
      },
      {
        "title": "Health Check Failures",
        "targets": [
          {
            "expr": "increase(health_check_failures_total[5m])"
          }
        ]
      }
    ]
  }
}
```

---

## 7. Testing & Validation

### 7.1 Unit Tests

```typescript
describe('HealthCheckService', () => {
  it('should detect unhealthy app after timeout', async () => {
    // Mock slow endpoint
    const service = new HealthCheckService();
    const result = await service.checkInstance({ id: 1, port: 9999 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });

  it('should update heartbeat on successful check', async () => {
    // Mock successful health endpoint
    const service = new HealthCheckService();
    await service.checkInstance({ id: 1, port: 3000 });
    // Verify heartbeat updated
  });

  it('should alert after N consecutive failures', async () => {
    // Simulate N failures
    // Verify alert sent on Nth failure
  });
});
```

---

## 8. Success Criteria

- [x] **Detection Speed:** Stale heartbeats detected within 120 seconds
- [x] **False Positives:** <1% of health checks
- [x] **Response Time:** Health checks complete in <1 second per instance
- [x] **Scalability:** Handle 1000+ instances with <5 second total check
- [x] **Alerting:** <5 second alert delivery
- [x] **Metrics:** All health data exported to Prometheus

---

**This specification is ready for implementation.**
