import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";
import { createLogger } from "@server/utils/logger.js";
import { redisConnectionOptions } from "./connection-options.js";

const logger = createLogger("RedisService");

interface CacheMetrics {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    errors: number;
}

export class RedisService {
    private static instance: RedisService;

    // Dedicated connections
    private mainClient: Redis | null = null;
    private subscriberClient: Redis | null = null;
    private publisherClient: Redis | null = null;

    // Connection state
    private isConnected = false;
    private connectionPromise: Promise<boolean> | null = null;

    // Cache metrics
    private metrics: CacheMetrics = {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        errors: 0,
    };
    private metricsEnabled = process.env.REDIS_METRICS_ENABLED === 'true';

    private constructor() { }

    static getInstance(): RedisService {
        if (!RedisService.instance) {
            RedisService.instance = new RedisService();
        }
        return RedisService.instance;
    }

    /**
     * Get configuration from env
     */
    public getOptions(): RedisOptions {
        const options: RedisOptions = {
            ...redisConnectionOptions(),
            maxRetriesPerRequest: null, // Essential for BullMQ
            enableReadyCheck: false,
            retryStrategy: (times) => {
                if (times > 5) return null; // Stop retrying if local Redis is unavailable
                return Math.min(times * 200, 2000);
            },
            lazyConnect: true,
            connectTimeout: 5000,
        };

        return options;
    }

    private createClient(name: string): Redis {
        const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
        const options = this.getOptions();

        const client = new Redis(url, {
            ...options,
            connectionName: `oddjob:${name}`
        });

        client.on("connect", () => logger.debug(`Redis [${name}] connecting...`));
        client.on("ready", () => {
            if (name === "main") this.isConnected = true;
            logger.info(`Redis [${name}] ready`);
        });
        client.on("error", (err) => logger.error(`Redis [${name}] error`, { error: err.message }));
        client.on("close", () => {
            if (name === "main") this.isConnected = false;
            logger.warn(`Redis [${name}] closed`);
        });

        // Compatibility wrapper for libraries using node-redis style arguments (e.g. connect-redis v9)
        const originalSet = client.set.bind(client);
        (client as any).set = (key: string, value: string, ...args: any[]) => {
            if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
                const opts = args[0] as any;

                if (key.includes('sess:') && process.env.NODE_ENV === 'development') {
                    logger.debug(`Redis [${name}] session WRITE: ${key}`, {
                        ttl: opts.expiration?.value || opts.EX || opts.PX
                    });
                }

                if (opts.expiration && typeof opts.expiration === 'object') {
                    const { type, value: ttl } = opts.expiration;
                    if (type === 'EX') return originalSet(key, value, 'EX', ttl).then((r: any) => { this.recordSet(); return r; });
                    if (type === 'PX') return originalSet(key, value, 'PX', ttl).then((r: any) => { this.recordSet(); return r; });
                }

                if (opts.PX) return originalSet(key, value, "PX", opts.PX).then((r: any) => { this.recordSet(); return r; });
                if (opts.EX) return originalSet(key, value, "EX", opts.EX).then((r: any) => { this.recordSet(); return r; });
                if (opts.NX) return originalSet(key, value, "NX").then((r: any) => { this.recordSet(); return r; });
            }
            return originalSet(key, value, ...args).then((r: any) => { this.recordSet(); return r; });
        };

        // Metrics: wrap get to track cache hits/misses
        const originalGet = client.get.bind(client);
        (client as any).get = (key: string) =>
            originalGet(key).then((value: string | null) => {
                if (value !== null) this.recordHit();
                else this.recordMiss();
                return value;
            }).catch((err: Error) => { this.recordError(); throw err; });

        // Metrics: wrap setex/set with TTL to track sets
        const originalSetex = client.setex.bind(client);
        (client as any).setex = (key: string, seconds: number, value: string) =>
            originalSetex(key, seconds, value).then((r: any) => { this.recordSet(); return r; })
                .catch((err: Error) => { this.recordError(); throw err; });

        // Metrics: wrap del to track deletes
        const originalDel = client.del.bind(client);
        (client as any).del = (...keys: string[]) =>
            originalDel(...keys).then((r: number) => { if (r > 0) this.recordDelete(); return r; })
                .catch((err: Error) => { this.recordError(); throw err; });

        return client;
    }

    /**
     * Get the main shared Redis client (caching, simple KV)
     */
    get client(): Redis {
        if (!this.mainClient) {
            this.mainClient = this.createClient("main");
        }
        return this.mainClient;
    }

    /**
     * Get the subscriber client (Pub/Sub)
     */
    get subscriber(): Redis {
        if (!this.subscriberClient) {
            this.subscriberClient = this.createClient("subscriber");
        }
        return this.subscriberClient;
    }

    /**
     * Get the publisher client (Loopbane, etc)
     */
    get publisher(): Redis {
        if (!this.publisherClient) {
            this.publisherClient = this.createClient("publisher");
        }
        return this.publisherClient;
    }

    /**
     * Initialize connections (Optional, lazy by default)
     */
    async connect(): Promise<boolean> {
        if (this.connectionPromise) return this.connectionPromise;

        this.connectionPromise = (async () => {
            try {
                await this.client.connect(); 
                return true;
            } catch (err) {
                logger.error("Failed to connect to Redis", { error: err });
                return false;
            }
        })();

        return this.connectionPromise;
    }

    /**
     * Gracefully close all connections
     */
    async shutdown(): Promise<void> {
        const promises: Promise<string | void>[] = [];
        if (this.mainClient) promises.push(this.mainClient.quit());
        if (this.subscriberClient) promises.push(this.subscriberClient.quit());
        if (this.publisherClient) promises.push(this.publisherClient.quit());

        await Promise.allSettled(promises);
        this.isConnected = false;
        logger.info("All Redis connections closed");
    }

    /**
     * Record cache hit
     */
    recordHit(): void {
        if (this.metricsEnabled) {
            this.metrics.hits++;
        }
    }

    /**
     * Record cache miss
     */
    recordMiss(): void {
        if (this.metricsEnabled) {
            this.metrics.misses++;
        }
    }

    /**
     * Record cache set
     */
    recordSet(): void {
        if (this.metricsEnabled) {
            this.metrics.sets++;
        }
    }

    /**
     * Record cache delete
     */
    recordDelete(): void {
        if (this.metricsEnabled) {
            this.metrics.deletes++;
        }
    }

    /**
     * Record cache error
     */
    recordError(): void {
        if (this.metricsEnabled) {
            this.metrics.errors++;
        }
    }

    /**
     * Get cache statistics
     */
    getMetrics(): CacheMetrics & { hitRate: number; totalOperations: number } {
        const total = this.metrics.hits + this.metrics.misses;
        return {
            ...this.metrics,
            hitRate: total > 0 ? (this.metrics.hits / total) * 100 : 0,
            totalOperations: total + this.metrics.sets + this.metrics.deletes,
        };
    }

    /**
     * Reset cache metrics
     */
    resetMetrics(): void {
        this.metrics = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            errors: 0,
        };
    }

    /**
     * Enable or disable metrics collection
     */
    setMetricsEnabled(enabled: boolean): void {
        this.metricsEnabled = enabled;
    }
}

export const redisService = RedisService.getInstance();
export const redis: Redis = redisService.client;
export const subscriber: Redis = redisService.subscriber;
export const publisher: Redis = redisService.publisher;
export const nodeRedisClient: Redis = redisService.client;
export const redisManager = redisService;
export const getRedisClient = (): Redis => redisService.client;
export const getRedisOptions = (): RedisOptions => redisService.getOptions();

// Cache metrics convenience exports
export const recordCacheHit = (): void => redisService.recordHit();
export const recordCacheMiss = (): void => redisService.recordMiss();
export const recordCacheSet = (): void => redisService.recordSet();
export const recordCacheDelete = (): void => redisService.recordDelete();
export const recordCacheError = (): void => redisService.recordError();
export const getCacheMetrics = (): ReturnType<RedisService['getMetrics']> => redisService.getMetrics();
export const resetCacheMetrics = (): void => redisService.resetMetrics();
export const setCacheMetricsEnabled = (enabled: boolean): void => redisService.setMetricsEnabled(enabled);




