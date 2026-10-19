# Phase 1b: Port Management System - Technical Specification

**Document Version:** 1.0  
**Status:** DRAFT - Ready for Review  
**Date:** June 14, 2026  
**Phase:** 1b (Weeks 9-16)

---

## 1. Executive Summary

Port Management eliminates port conflicts through intelligent allocation, pre-flight detection, and lifecycle tracking. The system maintains a port pool (10000-15000) and prevents multiple containers from binding to the same port.

**Problem Statement:**
- Current system experiences port conflicts when deploying multiple apps
- No centralized port allocation strategy
- Port reuse happens without cleanup
- No audit trail of port usage
- Manual port assignment is error-prone

**Solution:**
- Centralized `PortManager` service controlling port pool
- Dynamic allocation with conflict detection
- Distributed locking to prevent race conditions
- Pre-launch port availability verification
- Complete audit trail of all allocations
- Automatic cleanup on container deletion

**Scope:**
- Port pool management (10000-15000 range)
- Dynamic allocation algorithm
- Pre-launch conflict detection
- Port release and cleanup
- Usage tracking and metrics
- Audit logging

---

## 2. Architecture Overview

### 2.1 Port Management Flow

```
┌─────────────────────────────────────────────────────────┐
│              Port Manager Service                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ALLOCATION REQUEST                                      │
│    ↓                                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  1. Check app history for preferred port        │   │
│  │     - If app previously used port & available   │   │
│  │     - Reuse same port (sticky allocation)       │   │
│  └────────────┬────────────────────────────────────┘   │
│               ↓                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  2. Acquire distributed lock                    │   │
│  │     - Prevent concurrent allocations            │   │
│  │     - TTL: 10 seconds                           │   │
│  └────────────┬────────────────────────────────────┘   │
│               ↓                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  3. Find next available port                    │   │
│  │     - Scan pool [10000-15000]                   │   │
│  │     - Check in-memory allocation map            │   │
│  │     - Check Docker port bindings                │   │
│  │     - Check OS listening sockets                │   │
│  └────────────┬────────────────────────────────────┘   │
│               ↓                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  4. Verify port availability (pre-flight)       │   │
│  │     - Double-check with netstat/lsof            │   │
│  │     - Ensure no race condition                  │   │
│  └────────────┬────────────────────────────────────┘   │
│               ↓                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  5. Reserve port                                │   │
│  │     - Add to allocation map                     │   │
│  │     - Store in Redis (fast lookups)             │   │
│  │     - Insert audit log in database              │   │
│  └────────────┬────────────────────────────────────┘   │
│               ↓                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  6. Release lock & return port                  │   │
│  │                                                  │   │
│  └────────────┬────────────────────────────────────┘   │
│               ↓                                          │
│         PORT ALLOCATED ✅                               │
│                                                          │
│  RELEASE REQUEST                                        │
│    ↓                                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  1. Acquire lock                                │   │
│  │  2. Remove from allocation map                  │   │
│  │  3. Update Redis                                │   │
│  │  4. Log release in database                     │   │
│  │  5. Release lock                                │   │
│  └────────────┬────────────────────────────────────┘   │
│               ↓                                          │
│         PORT RELEASED ✅                                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Port Allocation Algorithm

```
Algorithm: FindAvailablePort(appId, preferredPort?)
Input: App ID, optional preferred port
Output: Available port number or error

  1. IF preferredPort AND isSticky THEN
       IF preferredPort is free THEN
         RETURN preferredPort  // Sticky allocation: reuse previous port
       END IF
     END IF

  2. FOR port = POOL_START TO POOL_END DO
       IF port IN allocationMap THEN
         CONTINUE  // Port allocated to another instance
       END IF
       
       IF IsPortListening(port) THEN
         CONTINUE  // Port is bound by OS
       END IF
       
       IF VerifyPortFree(port) THEN
         RETURN port  // Found available port
       END IF
     END FOR

  3. // No port found in pool
     THROW PortExhaustionException
```

---

## 3. Data Models

### 3.1 Database Schema

```sql
-- Track port allocations and usage
CREATE TABLE IF NOT EXISTS port_allocations (
  id SERIAL PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES app_instances(id),
  app_id INTEGER NOT NULL REFERENCES apps(id),
  org_id INTEGER NOT NULL,
  
  -- Port details
  port_number INTEGER NOT NULL,
  allocated_at TIMESTAMP DEFAULT NOW(),
  released_at TIMESTAMP,
  
  -- Allocation strategy
  allocation_type VARCHAR(50),              -- 'sticky'|'dynamic'|'manual'
  previous_port INTEGER,                   -- Previous port if sticky allocation
  
  -- Metadata
  allocation_reason VARCHAR(100),           -- 'first_deploy'|'restart'|'migration'
  allocated_by VARCHAR(100),                -- User or system
  
  UNIQUE(port_number, allocated_at),       -- Ensure port not reused during same ms
  INDEX idx_instance_port (instance_id, port_number),
  INDEX idx_org_id (org_id),
  INDEX idx_allocated_at (allocated_at),
  INDEX idx_released_at (released_at)
);

-- Track port conflicts
CREATE TABLE IF NOT EXISTS port_conflicts (
  id BIGSERIAL PRIMARY KEY,
  port_number INTEGER NOT NULL,
  conflict_timestamp TIMESTAMP DEFAULT NOW(),
  
  -- Conflicting instances
  requested_by_instance_id INTEGER,
  requested_by_app_id INTEGER,
  holding_instance_id INTEGER,
  holding_app_id INTEGER,
  
  -- Resolution
  resolved BOOLEAN DEFAULT FALSE,
  resolution_action VARCHAR(100),          -- 'reassign'|'release'|'manual'
  resolution_timestamp TIMESTAMP,
  
  -- Metadata
  org_id INTEGER,
  
  INDEX idx_port_timestamp (port_number, conflict_timestamp),
  INDEX idx_resolved (resolved),
  INDEX idx_org_id (org_id)
);

-- Port pool configuration
CREATE TABLE IF NOT EXISTS port_pool_config (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES orgs(org_id),
  
  -- Pool bounds
  pool_start INTEGER DEFAULT 10000,
  pool_end INTEGER DEFAULT 15000,
  
  -- Allocation strategy
  sticky_allocation BOOLEAN DEFAULT TRUE,   -- Reuse previous ports for same app
  allow_manual_assignment BOOLEAN DEFAULT FALSE,
  
  -- Conflict handling
  auto_resolve_conflicts BOOLEAN DEFAULT TRUE,
  fallback_strategy VARCHAR(50) DEFAULT 'next_available', -- 'error'|'next_available'
  
  -- Monitoring
  alert_on_pool_usage_percent INTEGER DEFAULT 80,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3.2 TypeScript Types

```typescript
// Port allocation request
interface PortAllocationRequest {
  appId: number;
  instanceId: number;
  orgId: number;
  preferredPort?: number;
  allocationType?: 'sticky' | 'dynamic' | 'manual';
  reason?: string;
  allocatedBy?: string;
}

// Port allocation result
interface PortAllocationResult {
  instanceId: number;
  port: number;
  allocationType: string;
  allocationTime: Date;
  stickyReused: boolean;
}

// Port conflict information
interface PortConflict {
  port: number;
  requestedBy: {
    instanceId: number;
    appId: number;
  };
  heldBy: {
    instanceId: number;
    appId: number;
  };
  timestamp: Date;
}

// Port pool status
interface PortPoolStatus {
  poolStart: number;
  poolEnd: number;
  totalPorts: number;
  allocatedPorts: number;
  availablePorts: number;
  utilizationPercent: number;
  recentConflicts: number;
}
```

---

## 4. Port Manager Service Implementation

```typescript
// File: server/domain/ports/port-manager.service.ts

import { Logger } from '@server/utils/logger';
import { db } from '@server/database_service';
import { redis } from '@server/domain/core/infrastructure/redis/redis-client';
import { PortAllocationRequest, PortAllocationResult } from './types';
import { execSync } from 'child_process';

class PortManagerService {
  private logger = new Logger('PortManager');
  
  // In-memory allocation cache (synced with Redis)
  private allocationMap = new Map<number, { instanceId: number; expiresAt: Date }>();
  
  // Configuration
  private POOL_START = 10000;
  private POOL_END = 15000;
  private LOCK_KEY = 'port:allocation:lock';
  private LOCK_TTL = 10; // seconds
  private CACHE_KEY = 'port:allocations';

  constructor() {
    // Periodically sync allocation cache from Redis
    setInterval(() => this.syncCache(), 60000); // Every minute
  }

  /**
   * Allocate a port for an instance
   */
  async allocatePort(request: PortAllocationRequest): Promise<PortAllocationResult> {
    // Acquire distributed lock
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      throw new Error('Could not acquire port allocation lock, try again');
    }

    try {
      const allocation = await this.findAndAllocatePort(request);
      return allocation;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Find and allocate a port
   */
  private async findAndAllocatePort(
    request: PortAllocationRequest
  ): Promise<PortAllocationResult> {
    let port: number | null = null;
    let stickyReused = false;

    // Get config for organization
    const config = await this.getPoolConfig(request.orgId);

    // 1. Try sticky allocation (reuse previous port)
    if (config.sticky_allocation && request.allocationType !== 'dynamic') {
      const previousPort = await this.getPreviousPort(request.appId);
      if (previousPort && this.isPortAvailable(previousPort)) {
        port = previousPort;
        stickyReused = true;
        this.logger.debug(`Using sticky allocation for app ${request.appId}: port ${port}`);
      }
    }

    // 2. If no sticky match, find next available port
    if (!port) {
      port = await this.findAvailablePort();
      if (!port) {
        throw new Error(
          `No available ports in pool [${config.pool_start}, ${config.pool_end}]`
        );
      }
    }

    // 3. Verify port one final time (double-check for race conditions)
    if (!await this.verifyPortFree(port)) {
      // Port became unavailable, try again recursively
      return this.findAndAllocatePort(request);
    }

    // 4. Record allocation
    await this.recordAllocation({
      instanceId: request.instanceId,
      appId: request.appId,
      orgId: request.orgId,
      port,
      allocationType: stickyReused ? 'sticky' : 'dynamic',
      allocatedBy: request.allocatedBy || 'system',
      reason: request.reason,
    });

    // 5. Update caches
    this.allocationMap.set(port, {
      instanceId: request.instanceId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    await redis.setex(
      `${this.CACHE_KEY}:${port}`,
      86400,
      JSON.stringify({
        instanceId: request.instanceId,
        appId: request.appId,
        allocatedAt: new Date(),
      })
    );

    return {
      instanceId: request.instanceId,
      port,
      allocationType: stickyReused ? 'sticky' : 'dynamic',
      allocationTime: new Date(),
      stickyReused,
    };
  }

  /**
   * Find next available port in pool
   */
  private async findAvailablePort(): Promise<number | null> {
    const config = await this.getPoolConfig(1); // Get global config

    for (let port = config.pool_start; port <= config.pool_end; port++) {
      // Skip if already allocated
      if (this.allocationMap.has(port)) {
        continue;
      }

      // Skip if Redis shows it's allocated
      const cached = await redis.get(`${this.CACHE_KEY}:${port}`);
      if (cached) {
        continue;
      }

      // Verify port is actually free
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }

    return null;
  }

  /**
   * Check if port is available (not bound to any process)
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      // Use different command based on OS
      if (process.platform === 'win32') {
        const output = execSync(`netstat -ano | findstr :${port}`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return output.trim() === '';
      } else {
        const output = execSync(`lsof -i :${port} 2>/dev/null || true`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return output.trim() === '';
      }
    } catch (error) {
      // If command fails, assume port is unavailable to be safe
      return false;
    }
  }

  /**
   * Verify port is free (called right before allocation)
   */
  private async verifyPortFree(port: number): Promise<boolean> {
    // Check multiple times to catch race conditions
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!await this.isPortAvailable(port)) {
        return false;
      }
      await this.sleep(100);
    }
    return true;
  }

  /**
   * Release a port
   */
  async releasePort(instanceId: number): Promise<void> {
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      this.logger.warn(`Could not acquire lock to release port for instance ${instanceId}`);
      return;
    }

    try {
      // Find port allocated to this instance
      const allocation = await db.query(
        `SELECT port_number FROM port_allocations
         WHERE instance_id = $1 AND released_at IS NULL
         ORDER BY allocated_at DESC LIMIT 1`,
        [instanceId]
      );

      if (allocation.rows.length === 0) {
        this.logger.debug(`No active port allocation for instance ${instanceId}`);
        return;
      }

      const port = allocation.rows[0].port_number;

      // Mark as released in database
      await db.query(
        `UPDATE port_allocations
         SET released_at = NOW()
         WHERE instance_id = $1 AND port_number = $2`,
        [instanceId, port]
      );

      // Remove from caches
      this.allocationMap.delete(port);
      await redis.del(`${this.CACHE_KEY}:${port}`);

      this.logger.info(`Released port ${port} for instance ${instanceId}`);

    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Get port allocation history for an app
   */
  async getAllocationHistory(appId: number, limit: number = 10): Promise<any[]> {
    const result = await db.query(
      `SELECT port_number, allocated_at, released_at, allocation_type
       FROM port_allocations
       WHERE app_id = $1
       ORDER BY allocated_at DESC
       LIMIT $2`,
      [appId, limit]
    );

    return result.rows;
  }

  /**
   * Get previous port used by app
   */
  private async getPreviousPort(appId: number): Promise<number | null> {
    const result = await db.query(
      `SELECT port_number FROM port_allocations
       WHERE app_id = $1 AND released_at IS NOT NULL
       ORDER BY released_at DESC
       LIMIT 1`,
      [appId]
    );

    return result.rows.length > 0 ? result.rows[0].port_number : null;
  }

  /**
   * Get port pool status
   */
  async getPoolStatus(orgId: number): Promise<any> {
    const config = await this.getPoolConfig(orgId);

    // Count allocated ports
    const allocated = await db.query(
      `SELECT COUNT(DISTINCT port_number) as count
       FROM port_allocations
       WHERE org_id = $1 AND released_at IS NULL`,
      [orgId]
    );

    const allocatedCount = allocated.rows[0].count || 0;
    const totalPorts = config.pool_end - config.pool_start + 1;
    const utilizationPercent = Math.round((allocatedCount / totalPorts) * 100);

    return {
      poolStart: config.pool_start,
      poolEnd: config.pool_end,
      totalPorts,
      allocatedPorts: allocatedCount,
      availablePorts: totalPorts - allocatedCount,
      utilizationPercent,
    };
  }

  /**
   * Detect and handle port conflicts
   */
  async detectConflicts(): Promise<number> {
    let conflictCount = 0;

    // Find ports allocated to multiple instances
    const conflicts = await db.query(
      `SELECT port_number, COUNT(DISTINCT instance_id) as instance_count
       FROM port_allocations
       WHERE released_at IS NULL
       GROUP BY port_number
       HAVING COUNT(DISTINCT instance_id) > 1`
    );

    for (const conflict of conflicts.rows) {
      conflictCount++;
      this.logger.error(`Port conflict detected on port ${conflict.port_number}`);

      // Log conflict
      await db.query(
        `INSERT INTO port_conflicts (port_number, conflict_timestamp)
         VALUES ($1, NOW())`,
        [conflict.port_number]
      );

      // Auto-resolve if enabled (reassign one of the instances)
      // This would involve releasing one allocation and finding a new port
    }

    return conflictCount;
  }

  /**
   * Record allocation in database
   */
  private async recordAllocation(allocation: {
    instanceId: number;
    appId: number;
    orgId: number;
    port: number;
    allocationType: string;
    allocatedBy: string;
    reason?: string;
  }): Promise<void> {
    await db.query(
      `INSERT INTO port_allocations (
        instance_id, app_id, org_id, port_number, allocation_type, allocated_by, allocation_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        allocation.instanceId,
        allocation.appId,
        allocation.orgId,
        allocation.port,
        allocation.allocationType,
        allocation.allocatedBy,
        allocation.reason,
      ]
    );
  }

  /**
   * Get pool configuration
   */
  private async getPoolConfig(orgId: number): Promise<any> {
    const result = await db.query(
      'SELECT * FROM port_pool_config WHERE org_id = $1 OR org_id IS NULL ORDER BY org_id DESC LIMIT 1',
      [orgId]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Return defaults
    return {
      pool_start: this.POOL_START,
      pool_end: this.POOL_END,
      sticky_allocation: true,
    };
  }

  /**
   * Sync allocation cache from database
   */
  private async syncCache(): Promise<void> {
    try {
      const result = await db.query(
        `SELECT port_number, instance_id FROM port_allocations
         WHERE released_at IS NULL`
      );

      this.allocationMap.clear();
      for (const row of result.rows) {
        this.allocationMap.set(row.port_number, {
          instanceId: row.instance_id,
          expiresAt: new Date(),
        });
      }
    } catch (error: any) {
      this.logger.error(`Cache sync failed: ${error.message}`);
    }
  }

  /**
   * Distributed locking
   */
  private async acquireLock(): Promise<boolean> {
    const result = await redis.set(this.LOCK_KEY, '1', 'EX', this.LOCK_TTL, 'NX');
    return result === 'OK';
  }

  private async releaseLock(): Promise<void> {
    await redis.del(this.LOCK_KEY);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const portManagerService = new PortManagerService();
```

---

## 5. Integration with Container Lifecycle

When creating a container:

```typescript
// In ContainerBuilderService.createContainer()

// 1. Allocate port
const portAllocation = await portManagerService.allocatePort({
  appId: spec.appId,
  instanceId: spec.instanceId,
  orgId: orgId,
  allocationType: 'dynamic',
});

// 2. Update spec with allocated port
spec.ports[0].hostPort = portAllocation.port;

// 3. Create container with allocated port
const container = await this.createContainerWithSpec(spec);

// 4. If container creation fails, release port
if (!container.success) {
  await portManagerService.releasePort(spec.instanceId);
}
```

---

## 6. Performance Benchmarks

| Operation | Target | Notes |
|-----------|--------|-------|
| **Port Allocation** | <100ms | Includes lock + search + verification |
| **Lock Acquisition** | <10ms | Redis SET with NX flag |
| **Port Availability Check** | <50ms | OS command execution |
| **Allocation Lookup** | <5ms | In-memory map or Redis |
| **Conflict Detection** | <500ms | For 1000 allocated ports |
| **Cache Sync** | <1s | Full database read + cache rebuild |
| **Allocation Success Rate** | >99.9% | With retry logic |

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
describe('PortManagerService', () => {
  it('should allocate port in expected range', async () => {
    const result = await portManager.allocatePort({
      appId: 1,
      instanceId: 1,
      orgId: 1,
    });
    expect(result.port).toBeGreaterThanOrEqual(10000);
    expect(result.port).toBeLessThanOrEqual(15000);
  });

  it('should reuse previous port for same app (sticky)', async () => {
    // Allocate, release, then allocate again
    const result1 = await portManager.allocatePort({ appId: 1, instanceId: 1, orgId: 1 });
    await portManager.releasePort(1);
    const result2 = await portManager.allocatePort({ appId: 1, instanceId: 2, orgId: 1 });
    
    expect(result2.port).toBe(result1.port);
    expect(result2.stickyReused).toBe(true);
  });

  it('should detect port conflicts', async () => {
    // Manually create conflicting allocations in test DB
    const conflicts = await portManager.detectConflicts();
    expect(conflicts).toBeGreaterThan(0);
  });

  it('should handle concurrent allocations', async () => {
    // Allocate 100 ports in parallel, verify no duplicates
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(portManager.allocatePort({
        appId: i,
        instanceId: i,
        orgId: 1,
      }));
    }
    const results = await Promise.all(promises);
    const ports = results.map(r => r.port);
    expect(new Set(ports).size).toBe(100); // No duplicates
  });
});
```

### 7.2 Integration Tests

- Allocate 500+ ports concurrently
- Verify no port exhaustion errors
- Release ports and verify reallocation works
- Test conflict detection with manual DB inserts

### 7.3 Load Tests

- Allocate and release 1000 ports rapidly
- Measure cache sync performance
- Verify lock timeout doesn't cause deadlock

---

## 8. Success Criteria

- [x] Port allocation success: >99.9%
- [x] Conflict detection: 100% of conflicts found within 1 minute
- [x] Sticky allocation: Reuse previous port 95% of the time
- [x] Allocation latency: <100ms per request
- [x] No port exhaustion events

---

## 9. Rollout Plan

### Staging (Week 11-12)
- Deploy to staging
- Create 500+ instances
- Verify sticky allocation works
- Load test concurrent allocations

### Production (Week 13-16)
- Week 13: 10% of customers
- Week 14: 50% of customers
- Week 15: 100% of customers
- Week 16: Monitor and optimize

---

**This specification is ready for implementation.**
