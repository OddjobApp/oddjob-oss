import { execSync } from "node:child_process";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { redis } from "@server/domain/core/infrastructure/redis/redis-client.js";
import * as schema from "@shared/schema/index.js";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";

const logger = createLogger("PortManagerService");

export interface PortAllocationRequest {
  appId: number;
  instanceId: number;
  orgId: number;
  preferredPort?: number;
  allocationType?: "sticky" | "dynamic" | "manual";
  reason?: string;
  allocatedBy?: string;
}

export interface PortAllocationResult {
  instanceId: number;
  port: number;
  allocationType: string;
  allocationTime: Date;
  stickyReused: boolean;
}

class PortManagerService {
  private allocationMap = new Map<number, { instanceId: number; expiresAt: Date }>();

  private POOL_START = 10000;
  private POOL_END = 15000;
  private LOCK_KEY = "port:allocation:lock";
  private LOCK_TTL = 10; // seconds
  private LOCK_RETRY_ATTEMPTS = 60;
  private LOCK_RETRY_DELAY_MS = 40; // ~2.4s max wait, comfortably under LOCK_TTL
  private CACHE_KEY = "port:allocations";

  constructor() {
    // Periodically sync allocation cache from database
    setInterval(() => this.syncCache(), 60000); // Every minute
    // Initial sync
    this.syncCache().catch(console.error);
  }

  /**
   * Allocate a port for an instance
   */
  async allocatePort(request: PortAllocationRequest): Promise<PortAllocationResult> {
    const lockAcquired = await this.acquireLockWithRetry();
    if (!lockAcquired) {
      throw new Error("Could not acquire port allocation lock, try again");
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
  private async findAndAllocatePort(request: PortAllocationRequest): Promise<PortAllocationResult> {
    let port: number | null = null;
    let stickyReused = false;

    // Get config for organization
    const config = await this.getPoolConfig(request.orgId);

    // 1. Try sticky allocation (reuse previous port)
    if (config.stickyAllocation && request.allocationType !== "dynamic") {
      const previousPort = await this.getPreviousPort(request.appId);
      // isPortAvailable only checks real OS-level binding, which says nothing about
      // whether another instance already holds this port in an active DB allocation —
      // check allocationMap too, or two instances can be assigned the same port.
      if (
        previousPort &&
        !this.allocationMap.has(previousPort) &&
        (await this.isPortAvailable(previousPort))
      ) {
        port = previousPort;
        stickyReused = true;
        logger.debug(`Using sticky allocation for app ${request.appId}: port ${port}`);
      }
    }

    // 2. If no sticky match, find next available port
    if (!port) {
      port = await this.findAvailablePort(config.poolStart, config.poolEnd);
      if (!port) {
        throw new Error(`No available ports in pool [${config.poolStart}, ${config.poolEnd}]`);
      }
    }

    // 3. Verify port one final time (double-check for race conditions)
    if (!(await this.isPortAvailable(port))) {
      // Port became unavailable, try again recursively
      return this.findAndAllocatePort(request);
    }

    // 4. Record allocation
    await this.recordAllocation({
      instanceId: request.instanceId,
      appId: request.appId,
      orgId: request.orgId,
      port,
      allocationType: stickyReused ? "sticky" : "dynamic",
      allocatedBy: request.allocatedBy || "system",
      reason: request.reason,
    });

    // 5. Update caches
    this.allocationMap.set(port, {
      instanceId: request.instanceId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    try {
      await redis.setex(
        `${this.CACHE_KEY}:${port}`,
        86400,
        JSON.stringify({
          instanceId: request.instanceId,
          appId: request.appId,
          allocatedAt: new Date(),
        })
      );
    } catch (error: any) {
      logger.warn(`Failed to update Redis cache: ${error.message}`);
    }

    return {
      instanceId: request.instanceId,
      port,
      allocationType: stickyReused ? "sticky" : "dynamic",
      allocationTime: new Date(),
      stickyReused,
    };
  }

  /**
   * Find next available port in pool
   */
  private async findAvailablePort(poolStart: number, poolEnd: number): Promise<number | null> {
    for (let port = poolStart; port <= poolEnd; port++) {
      // Skip if already allocated
      if (this.allocationMap.has(port)) {
        continue;
      }

      // Skip if Redis shows it's allocated
      try {
        const cached = await redis.get(`${this.CACHE_KEY}:${port}`);
        if (cached) {
          continue;
        }
      } catch (error: any) {
        logger.warn(`Redis check failed for port ${port}: ${error.message}`);
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
      if (process.platform === "win32") {
        const output = execSync(`netstat -ano | findstr :${port}`, {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "ignore"],
        });
        return output.trim() === "";
      } else {
        const output = execSync(`lsof -i :${port} 2>/dev/null || true`, {
          encoding: "utf-8",
          timeout: 5000,
        });
        return output.trim() === "";
      }
    } catch (error: any) {
      // findstr exits with status 1 when it finds no matching lines — that means
      // the port is free, not that the check failed. Without this, every free port
      // would throw here and fall through to the "assume unavailable" fallback below,
      // making the entire pool appear permanently exhausted.
      if (error.status === 1) {
        return true;
      }
      // If command fails for any other reason, assume port is unavailable to be safe
      logger.warn(`Port availability check failed for port ${port}: ${error.message}`);
      return false;
    }
  }

  /**
   * Release a port
   */
  async releasePort(instanceId: number): Promise<void> {
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      logger.warn(`Could not acquire lock to release port for instance ${instanceId}`);
      return;
    }

    try {
      // Find port allocated to this instance
      const allocations = await db
        .select()
        .from(schema.portAllocations)
        .where(
          and(
            eq(schema.portAllocations.instanceId, instanceId),
            isNull(schema.portAllocations.releasedAt)
          )
        )
        .limit(1);

      if (allocations.length === 0) {
        logger.debug(`No active port allocation for instance ${instanceId}`);
        return;
      }

      const port = allocations[0].portNumber;

      // Mark as released in database
      await db
        .update(schema.portAllocations)
        .set({ releasedAt: new Date() })
        .where(
          and(
            eq(schema.portAllocations.instanceId, instanceId),
            eq(schema.portAllocations.portNumber, port)
          )
        );

      // Remove from caches
      this.allocationMap.delete(port);
      try {
        await redis.del(`${this.CACHE_KEY}:${port}`);
      } catch (error: any) {
        logger.warn(`Failed to remove port from Redis cache: ${error.message}`);
      }

      logger.info(`Released port ${port} for instance ${instanceId}`);
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Get port allocation history for an app
   */
  async getAllocationHistory(appId: number, limit: number = 10): Promise<any[]> {
    const result = await db
      .select()
      .from(schema.portAllocations)
      .where(eq(schema.portAllocations.appId, appId))
      .limit(limit);

    return result;
  }

  /**
   * Get previous port used by app
   */
  private async getPreviousPort(appId: number): Promise<number | null> {
    const result = await db
      .select()
      .from(schema.portAllocations)
      .where(
        and(
          eq(schema.portAllocations.appId, appId),
          isNotNull(schema.portAllocations.releasedAt)
        )
      )
      .orderBy(desc(schema.portAllocations.allocatedAt))
      .limit(1);

    if (result.length > 0) {
      return result[0].portNumber;
    }

    return null;
  }

  /**
   * Get port pool status
   */
  async getPoolStatus(orgId: number): Promise<any> {
    const config = await this.getPoolConfig(orgId);

    // Count allocated ports
    const allocated = await db
      .select({ count: schema.portAllocations.portNumber })
      .from(schema.portAllocations)
      .where(
        and(
          eq(schema.portAllocations.orgId, orgId),
          isNull(schema.portAllocations.releasedAt)
        )
      );

    const allocatedCount = allocated.length;
    const totalPorts = config.poolEnd - config.poolStart + 1;
    const utilizationPercent = Math.round((allocatedCount / totalPorts) * 100);

    return {
      poolStart: config.poolStart,
      poolEnd: config.poolEnd,
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

    // Find ports allocated to multiple instances (this shouldn't happen with proper locking)
    const allocations = await db
      .select()
      .from(schema.portAllocations)
      .where(isNull(schema.portAllocations.releasedAt));

    const portMap = new Map<number, Array<{ instanceId: number; appId: number; orgId: number }>>();

    for (const alloc of allocations) {
      if (!portMap.has(alloc.portNumber)) {
        portMap.set(alloc.portNumber, []);
      }
      portMap.get(alloc.portNumber)?.push({
        instanceId: alloc.instanceId,
        appId: alloc.appId,
        orgId: alloc.orgId,
      });
    }

    for (const [port, items] of portMap.entries()) {
      if (items.length > 1) {
        conflictCount++;
        const instanceIds = items.map((i) => i.instanceId).join(", ");
        logger.error(`Port conflict detected on port ${port} for instances: ${instanceIds}`);

        const [first, second] = items;
        // Log conflict
        await db.insert(schema.portConflicts).values({
          portNumber: port,
          resolved: false,
          holdingInstanceId: first.instanceId,
          holdingAppId: first.appId,
          requestedByInstanceId: second.instanceId,
          requestedByAppId: second.appId,
          orgId: first.orgId,
        });
      }
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
    await db.insert(schema.portAllocations).values({
      instanceId: allocation.instanceId,
      appId: allocation.appId,
      orgId: allocation.orgId,
      portNumber: allocation.port,
      allocationType: allocation.allocationType,
      allocatedBy: allocation.allocatedBy,
      allocationReason: allocation.reason,
    });
  }

  /**
   * Get pool configuration
   */
  private async getPoolConfig(orgId: number): Promise<any> {
    const result = await db
      .select()
      .from(schema.portPoolConfig)
      .where(eq(schema.portPoolConfig.orgId, orgId));

    if (result.length > 0) {
      return result[0];
    }

    // Return defaults
    return {
      poolStart: this.POOL_START,
      poolEnd: this.POOL_END,
      stickyAllocation: true,
    };
  }

  /**
   * Sync allocation cache from database
   */
  private async syncCache(): Promise<void> {
    try {
      const result = await db
        .select()
        .from(schema.portAllocations)
        .where(isNull(schema.portAllocations.releasedAt));

      this.allocationMap.clear();
      for (const row of result) {
        this.allocationMap.set(row.portNumber, {
          instanceId: row.instanceId,
          expiresAt: new Date(),
        });
      }

      logger.debug(`Synced port cache: ${result.length} active allocations`);
    } catch (error: any) {
      logger.error(`Cache sync failed: ${error.message}`);
    }
  }

  /**
   * Acquire the distributed lock, retrying briefly on contention instead of
   * failing outright — without this, concurrent allocation requests mostly
   * reject each other rather than serializing.
   */
  private async acquireLockWithRetry(): Promise<boolean> {
    for (let attempt = 0; attempt < this.LOCK_RETRY_ATTEMPTS; attempt++) {
      if (await this.acquireLock()) {
        return true;
      }
      await this.sleep(this.LOCK_RETRY_DELAY_MS);
    }
    return false;
  }

  /**
   * Distributed locking using Redis
   */
  private async acquireLock(): Promise<boolean> {
    try {
      const result = await redis.set(this.LOCK_KEY, "1", "EX", this.LOCK_TTL, "NX");
      return result === "OK";
    } catch (error: any) {
      logger.warn(`Lock acquisition failed: ${error.message}`);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await redis.del(this.LOCK_KEY);
    } catch (error: any) {
      logger.warn(`Lock release failed: ${error.message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const portManagerService = new PortManagerService();
