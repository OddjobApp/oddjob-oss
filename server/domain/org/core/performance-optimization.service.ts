import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PerformanceOptimizationService");

/**
 * Cache entry
 */
export interface CacheEntry<T> {
    value: T;
    expiresAt: Date;
    hits: number;
    lastAccessed: Date;
}

/**
 * Cache statistics
 */
export interface CacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    maxSize: number;
}

/**
 * Performance optimization configuration
 */
export interface PerformanceConfig {
    cacheEnabled: boolean;
    cacheTTLSeconds: number;
    cacheMaxSize: number;
    lazyLoadEnabled: boolean;
    queryOptimizationEnabled: boolean;
    connectionPoolingEnabled: boolean;
    cdnEnabled: boolean;
}

/**
 * Performance Optimization Service
 * Handles caching, lazy loading, and performance optimizations
 */
export class PerformanceOptimizationService {
    private static instance: PerformanceOptimizationService;
    private cache: Map<string, CacheEntry<any>> = new Map();
    private cacheStats = { hits: 0, misses: 0 };
    private config: PerformanceConfig = {
        cacheEnabled: true,
        cacheTTLSeconds: 300, // 5 minutes
        cacheMaxSize: 10000,
        lazyLoadEnabled: true,
        queryOptimizationEnabled: true,
        connectionPoolingEnabled: true,
        cdnEnabled: false,
    };

    private constructor() {
        this.startCacheCleanup();
    }

    static getInstance(): PerformanceOptimizationService {
        if (!PerformanceOptimizationService.instance) {
            PerformanceOptimizationService.instance = new PerformanceOptimizationService();
        }
        return PerformanceOptimizationService.instance;
    }

    /**
     * Get value from cache
     */
    get<T>(key: string): T | null {
        if (!this.config.cacheEnabled) {
            return null;
        }

        const entry = this.cache.get(key);

        if (!entry) {
            this.cacheStats.misses++;
            return null;
        }

        // Check if expired
        if (new Date() > entry.expiresAt) {
            this.cache.delete(key);
            this.cacheStats.misses++;
            return null;
        }

        // Update access stats
        entry.hits++;
        entry.lastAccessed = new Date();
        this.cacheStats.hits++;

        logger.debug(`[Performance] Cache hit for key: ${key}`);
        return entry.value as T;
    }

    /**
     * Set value in cache
     */
    set<T>(key: string, value: T, ttlSeconds?: number): void {
        if (!this.config.cacheEnabled) {
            return;
        }

        // Check cache size limit
        if (this.cache.size >= this.config.cacheMaxSize) {
            this.evictLRU();
        }

        const ttl = ttlSeconds || this.config.cacheTTLSeconds;
        const entry: CacheEntry<T> = {
            value,
            expiresAt: new Date(Date.now() + ttl * 1000),
            hits: 0,
            lastAccessed: new Date(),
        };

        this.cache.set(key, entry);
        logger.debug(`[Performance] Cached key: ${key} (TTL: ${ttl}s)`);
    }

    /**
     * Delete value from cache
     */
    delete(key: string): void {
        this.cache.delete(key);
        logger.debug(`[Performance] Deleted cache key: ${key}`);
    }

    /**
     * Clear all cache
     */
    clear(): void {
        this.cache.clear();
        this.cacheStats = { hits: 0, misses: 0 };
        logger.info("[Performance] Cache cleared");
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): CacheStats {
        const total = this.cacheStats.hits + this.cacheStats.misses;
        const hitRate = total > 0 ? this.cacheStats.hits / total : 0;

        return {
            hits: this.cacheStats.hits,
            misses: this.cacheStats.misses,
            hitRate,
            size: this.cache.size,
            maxSize: this.config.cacheMaxSize,
        };
    }

    /**
     * Evict least recently used entry
     */
    private evictLRU(): void {
        let lruKey: string | null = null;
        let lruTime = Date.now();

        for (const [key, entry] of this.cache.entries()) {
            if (entry.lastAccessed.getTime() < lruTime) {
                lruTime = entry.lastAccessed.getTime();
                lruKey = key;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
            logger.debug(`[Performance] Evicted LRU cache key: ${lruKey}`);
        }
    }

    /**
     * Start cache cleanup interval
     */
    private startCacheCleanup(): void {
        setInterval(() => {
            const now = Date.now();
            const toDelete: string[] = [];

            for (const [key, entry] of this.cache.entries()) {
                if (now > entry.expiresAt.getTime()) {
                    toDelete.push(key);
                }
            }

            for (const key of toDelete) {
                this.cache.delete(key);
            }

            if (toDelete.length > 0) {
                logger.debug(`[Performance] Cleaned up ${toDelete.length} expired cache entries`);
            }
        }, 60000); // Check every minute
    }

    /**
     * Get or set pattern (cache-aside)
     */
    async getOrSet<T>(
        key: string,
        factory: () => Promise<T>,
        ttlSeconds?: number
    ): Promise<T> {
        const cached = this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        const value = await factory();
        this.set(key, value, ttlSeconds);
        return value;
    }

    /**
     * Invalidate cache by pattern
     */
    invalidatePattern(pattern: string): void {
        const regex = new RegExp(pattern);
        const toDelete: string[] = [];

        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                toDelete.push(key);
            }
        }

        for (const key of toDelete) {
            this.cache.delete(key);
        }

        logger.info(`[Performance] Invalidated ${toDelete.length} cache entries matching pattern: ${pattern}`);
    }

    /**
     * Warm up cache with keys
     */
    async warmUp<T>(entries: Array<{ key: string; factory: () => Promise<T>; ttlSeconds?: number }>): Promise<void> {
        logger.info(`[Performance] Warming up cache with ${entries.length} entries`);

        for (const entry of entries) {
            try {
                const value = await entry.factory();
                this.set(entry.key, value, entry.ttlSeconds);
            } catch (error) {
                logger.error(`[Performance] Failed to warm up cache key ${entry.key}:`, error);
            }
        }

        logger.info("[Performance] Cache warm-up complete");
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<PerformanceConfig>): void {
        this.config = { ...this.config, ...config };
        logger.info("[Performance] Configuration updated", config);
    }

    /**
     * Get current configuration
     */
    getConfig(): PerformanceConfig {
        return { ...this.config };
    }

    /**
     * Generate performance report
     */
    generatePerformanceReport(): {
        cache: CacheStats;
        config: PerformanceConfig;
        recommendations: string[];
    } {
        const stats = this.getCacheStats();
        const recommendations: string[] = [];

        if (stats.hitRate < 0.5) {
            recommendations.push("Cache hit rate is below 50%. Consider increasing TTL or cache size.");
        }

        if (stats.size >= stats.maxSize * 0.9) {
            recommendations.push("Cache is near capacity. Consider increasing max size or optimizing cache keys.");
        }

        if (!this.config.queryOptimizationEnabled) {
            recommendations.push("Query optimization is disabled. Enable for better database performance.");
        }

        if (!this.config.connectionPoolingEnabled) {
            recommendations.push("Connection pooling is disabled. Enable for better database connection management.");
        }

        return {
            cache: stats,
            config: this.config,
            recommendations,
        };
    }
}

export const performanceOptimizationService = PerformanceOptimizationService.getInstance();
