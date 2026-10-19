import os from 'os';
import v8 from 'v8';
import { createLogger } from '../../../utils/logger.js';
import { getRedisClient } from '../../../domain/core/infrastructure/redis/redis-client.js';

const logger = createLogger("ResourceGovernor");
const HEALTH_KEY = "oddjob:system:health";
const MEMORY_CRITICAL_CHANNEL = "system:memory:critical";

export interface SystemHealth {
    cpuLoad: number;      // 1-minute load average normalized by core count
    memPressure: number;  // Percentage of memory used
    status: 'healthy' | 'throttled' | 'critical';
}

// Background Heap Monitor (checks every 30s)
setInterval(() => {
    try {
        const heapStats = v8.getHeapStatistics();
        const maxHeap = heapStats.heap_size_limit;
        const heapUsed = process.memoryUsage().heapUsed;
        const heapUsedPct = heapUsed / maxHeap;

        if (heapUsedPct > 0.90) {
            logger.error(`[ResourceGovernor] CRITICAL: Node heap usage exceeds 90% of limit! Heap Used: ${Math.round(heapUsed / 1024 / 1024)}MB, Max Heap Limit: ${Math.round(maxHeap / 1024 / 1024)}MB (${Math.round(heapUsedPct * 100)}%)`);
            
            const redis = getRedisClient();
            redis.publish(MEMORY_CRITICAL_CHANNEL, JSON.stringify({
                timestamp: new Date().toISOString(),
                heapUsedPct,
                heapUsedBytes: heapUsed,
                heapLimitBytes: maxHeap,
                message: "Node heap space critical. Process restart recommended."
            })).catch((err: any) => {
                logger.error(`[ResourceGovernor] Failed to publish memory critical event: ${err.message}`);
            });
        }
    } catch (err: any) {
        logger.error(`[ResourceGovernor] Heap usage monitor check failed: ${err.message}`);
    }
}, 30000).unref(); // unref so it does not prevent the process from exiting gracefully

export class ResourceGovernor {
    private static readonly CPU_THROTTLE_THRESHOLD = 0.8; // 80% load
    private static readonly CPU_CRITICAL_THRESHOLD = 0.95; // 95% load
    private static readonly MEM_THROTTLE_THRESHOLD = 0.90; // 90% usage
    private static readonly MEM_CRITICAL_THRESHOLD = 0.98; // 98% usage

    static getSystemHealth(): SystemHealth {
        const cpus = os.cpus().length;
        const load = os.loadavg()[0] / cpus;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memUsed = (totalMem - freeMem) / totalMem;

        let status: SystemHealth['status'] = 'healthy';

        if (load > this.CPU_CRITICAL_THRESHOLD || memUsed > this.MEM_CRITICAL_THRESHOLD) {
            status = 'critical';
        } else if (load > this.CPU_THROTTLE_THRESHOLD || memUsed > this.MEM_THROTTLE_THRESHOLD) {
            status = 'throttled';
        }

        if (status !== 'healthy') {
            logger.warn(`[ResourceGovernor] System ${status.toUpperCase()}: CPU ${Math.round(load * 100)}%, MEM ${Math.round(memUsed * 100)}%`);
        }

        return { cpuLoad: load, memPressure: memUsed, status };
    }

    /**
     * Publishes health to Redis for cross-language access (Python agents).
     */
    static async publishHealth(): Promise<void> {
        try {
            const health = this.getSystemHealth();
            const redis = getRedisClient();
            await redis.set(HEALTH_KEY, JSON.stringify(health), "EX", 15); // 15s TTL
        } catch (err: any) {
            logger.error(`[ResourceGovernor] Failed to publish health to Redis: ${err.message}`);
        }
    }

    /**
     * Helper to yield if the system is under pressure.
     * Returns a delay in ms to wait, or 0 if healthy.
     */
    static getRecommendedDelay(): number {
        const health = this.getSystemHealth();
        if (health.status === 'critical') return 30000; // Wait 30s
        if (health.status === 'throttled') return 5000;  // Wait 5s
        return 0;
    }
}
