import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { redis } from "@server/domain/core/infrastructure/redis/redis-client.js";
import { appInstances } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { portManagerService } from "./port-manager.service.js";

const execAsync = promisify(exec);
const logger = createLogger("GarbageCollectionService");

class GarbageCollectionService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private checkInterval = 30 * 60 * 1000; // 30 minutes
  private lockKey = "gc:lock";
  private lockTTL = 60 * 5; // 5 minutes lock duration for a GC run

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`Starting Garbage Collection Service background task (interval: ${this.checkInterval}ms)`);

    const loop = async () => {
      if (!this.isRunning) return;

      const lockAcquired = await this.acquireLock();
      if (!lockAcquired) {
        // Another instance is already running the GC or a recent one just finished
        if (this.isRunning) {
          this.timer = setTimeout(loop, this.checkInterval);
        }
        return;
      }

      try {
        logger.info("Executing periodic GC sweep...");
        await this.performGC();
      } catch (error: any) {
        logger.error(`GC sweep failed: ${error.message}`, error);
      } finally {
        await this.releaseLock();
        if (this.isRunning) {
          this.timer = setTimeout(loop, this.checkInterval);
        }
      }
    };

    // Run first check after a short delay
    this.timer = setTimeout(loop, 10000);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("Stopped Garbage Collection Service background task");
  }

  private async acquireLock(): Promise<boolean> {
    try {
      const result = await redis.set(this.lockKey, '1', 'EX', this.lockTTL, 'NX');
      return result === 'OK';
    } catch (err: any) {
      logger.warn(`Redis lock acquire failed: ${err.message}`);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await redis.del(this.lockKey);
    } catch (err: any) {
      logger.warn(`Redis lock release failed: ${err.message}`);
    }
  }

  private async performGC(): Promise<void> {
    await this.collectPorts();
    await this.collectDockerImages();
    await this.collectOrphanedContainers();
  }

  private async collectPorts(): Promise<void> {
    try {
      // Find all keys starting with port:allocations:
      const keys = await redis.keys("port:allocations:*");
      if (!keys.length) return;

      let releasedCount = 0;
      for (const key of keys) {
        const dataStr = await redis.get(key);
        if (!dataStr) continue;

        try {
          const data = JSON.parse(dataStr);
          const instanceId = data.instanceId;
          
          if (instanceId) {
            // Check if instance still exists and is healthy
            const [instance] = await db
              .select({ status: appInstances.status })
              .from(appInstances)
              .where(eq(appInstances.id, instanceId))
              .limit(1);

            // If it doesn't exist, or is definitively stopped/deleted
            if (!instance || ["stopped", "deleted"].includes(instance.status)) {
              logger.info(`Releasing stale port allocation for instance ${instanceId}`);
              await portManagerService.releasePort(instanceId);
              releasedCount++;
            }
          }
        } catch (parseError) {
          logger.warn(`Invalid JSON in port allocation cache for key ${key}`);
        }
      }
      
      if (releasedCount > 0) {
        logger.info(`GC reclaimed ${releasedCount} stale port allocations`);
      }
    } catch (error: any) {
      logger.error(`Port collection failed: ${error.message}`);
    }
  }

  private async collectDockerImages(): Promise<void> {
    try {
      // Prune dangling/unused images older than 24 hours
      // -a removes all unused images not just dangling ones
      const { stdout, stderr } = await execAsync('docker image prune -a -f --filter "until=24h"', { timeout: 60000 });
      if (stdout.includes("Deleted Images:")) {
        logger.info(`GC pruned docker images:\n${stdout.trim()}`);
      }
    } catch (error: any) {
      logger.error(`Docker image prune failed: ${error.message}`);
    }
  }

  private async collectOrphanedContainers(): Promise<void> {
    try {
      // Find all running containers prefixed with oddjob-app-
      const { stdout } = await execAsync('docker ps --format "{{.ID}} {{.Names}}" --filter "name=^/?oddjob-app-"', { timeout: 30000 });
      const lines = stdout.trim().split("\n").filter(l => l.length > 0);
      
      if (!lines.length) return;

      const activeInstances = await db
        .select({ containerId: appInstances.containerId })
        .from(appInstances)
        .where(inArray(appInstances.status, ["running", "starting", "unhealthy"]));

      const validContainerIds = new Set(activeInstances.map(i => i.containerId).filter(Boolean));
      
      let removedCount = 0;
      for (const line of lines) {
        const [containerId, name] = line.split(" ");
        // Docker ID from ps is short (12 chars), database containerId might be long or short.
        // We do a startsWith check to be safe.
        const isValid = Array.from(validContainerIds).some(validId => validId!.startsWith(containerId));
        
        if (!isValid) {
          logger.info(`Found orphaned container ${name} (${containerId}). Removing...`);
          try {
            await execAsync(`docker rm -f ${containerId}`, { timeout: 15000 });
            removedCount++;
          } catch (rmError: any) {
            logger.warn(`Failed to remove orphaned container ${containerId}: ${rmError.message}`);
          }
        }
      }

      if (removedCount > 0) {
        logger.info(`GC removed ${removedCount} orphaned containers`);
      }
    } catch (error: any) {
      logger.error(`Orphaned container collection failed: ${error.message}`);
    }
  }
}

export const garbageCollectionService = new GarbageCollectionService();
