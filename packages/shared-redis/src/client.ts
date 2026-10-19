/**
 * Redis Client Manager
 * 
 * Centralized Redis client singleton that provides:
 * - Shared connection for general operations
 * - Dedicated pub/sub connections
 * - Graceful degradation when Redis is unavailable
 * - Connection lifecycle management
 */

import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";
import { createClient, type RedisClientType } from "redis";

// Configuration from environment
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

// Shared options for all Redis connections
const baseOptions: RedisOptions = {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 50, 2000);
    },
    lazyConnect: true, // Don't connect until needed
    enableReadyCheck: true,
    connectTimeout: 5000,
    enableOfflineQueue: true, // Allow buffering while connecting
};

if (REDIS_PASSWORD) {
    baseOptions.password = REDIS_PASSWORD;
}

/**
 * Logger interface for dependency injection
 */
export interface RedisLogger {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    debug: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Default console logger when no logger is provided
 */
const defaultLogger: RedisLogger = {
    info: (msg, meta) => console.log(`[Redis] ${msg}`, meta || ''),
    warn: (msg, meta) => console.warn(`[Redis] ${msg}`, meta || ''),
    error: (msg, meta) => console.error(`[Redis] ${msg}`, meta || ''),
    debug: (msg, meta) => console.debug(`[Redis] ${msg}`, meta || ''),
};

/**
 * Redis client singleton class
 * Manages connection lifecycle and provides client instances
 */
export class RedisClientManager {
    private _client: Redis | null = null;
    private _nodeClient: RedisClientType | null = null;
    private _isConnected: boolean = false;
    private _connectionPromise: Promise<boolean> | null = null;
    private logger: RedisLogger;

    constructor(logger?: RedisLogger) {
        this.logger = logger || defaultLogger;
    }

    /**
     * Get the Redis client instance
     * Creates one if it doesn't exist
     */
    get client(): Redis {
        if (!this._client) {
            this._client = this.createClient("main");
        }
        return this._client;
    }

    /**
     * Get the official Node Redis client instance
     * Used for compatibility with libraries like connect-redis v9
     */
    get nodeClient(): RedisClientType {
        if (!this._nodeClient) {
            const config = getRedisConfig();
            const url = `redis://${config.username ? config.username + ':' : ''}${config.password ? config.password + '@' : ''}${config.host}:${config.port}`;

            this._nodeClient = createClient({ url });

            this._nodeClient.on('error', (err) => {
                this.logger.error('Node Redis Client Error', { error: err.message });
            });

            this._nodeClient.connect().catch(err => {
                this.logger.error('Node Redis Client Connection Failed', { error: err.message });
            });
        }
        return this._nodeClient;
    }

    /**
     * Check if Redis is connected
     */
    get isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * Create a new Redis client with optional name for logging
     */
    createClient(name: string = "client"): Redis {
        const client = new Redis(REDIS_URL, baseOptions);
        this.setupEventHandlers(client, name);
        return client;
    }

    /**
     * Create a new Redis client for Pub/Sub (requires separate connection)
     */
    createSubscriber(): Redis {
        return this.createClient("subscriber");
    }

    /**
     * Create a new Redis client for publishing
     */
    createPublisher(): Redis {
        return this.createClient("publisher");
    }

    /**
     * Connect to Redis and verify connection
     */
    async connect(): Promise<boolean> {
        if (this._connectionPromise) {
            return this._connectionPromise;
        }

        this._connectionPromise = new Promise(async (resolve) => {
            try {
                await this.client.connect();
                const pong = await this.client.ping();
                this._isConnected = pong === "PONG";
                if (this._isConnected) {
                    this.logger.info("Redis connected successfully", {
                        url: REDIS_URL.replace(/\/\/.*@/, "//***@")
                    });
                }
                resolve(this._isConnected);
            } catch (error) {
                this.logger.warn("Redis connection failed, falling back to in-memory", {
                    error: error instanceof Error ? error.message : String(error)
                });
                this._isConnected = false;
                resolve(false);
            }
        });

        return this._connectionPromise;
    }

    /**
     * Graceful shutdown
     */
    async disconnect(): Promise<void> {
        if (this._client) {
            await this._client.quit();
            this._client = null;
        }
        if (this._nodeClient) {
            await this._nodeClient.quit();
            this._nodeClient = null;
        }
        this._isConnected = false;
        this._connectionPromise = null;
        this.logger.info("Redis disconnected");
    }

    /**
     * Setup event handlers for a Redis client
     */
    private setupEventHandlers(client: Redis, name: string = "main"): void {
        client.on("connect", () => {
            this.logger.debug(`Redis ${name} connecting...`);
        });

        client.on("ready", () => {
            this._isConnected = true;
            this.logger.info(`Redis ${name} ready`);
        });

        client.on("error", (err: Error) => {
            this.logger.error(`Redis ${name} error`, { error: err.message });
        });

        client.on("close", () => {
            this._isConnected = false;
            this.logger.warn(`Redis ${name} connection closed`);
        });

        client.on("reconnecting", () => {
            this.logger.info(`Redis ${name} reconnecting...`);
        });
    }
}

// Singleton instance
let _manager: RedisClientManager | null = null;

/**
 * Get or create the Redis client manager singleton
 */
export function getRedisManager(logger?: RedisLogger): RedisClientManager {
    if (!_manager) {
        _manager = new RedisClientManager(logger);
    }
    return _manager;
}

/**
 * Get the shared Redis client
 * Convenience function for simple use cases
 */
export function getRedisClient(logger?: RedisLogger): Redis {
    return getRedisManager(logger).client;
}

/**
 * Get the shared Node Redis client
 */
export function getNodeRedisClient(logger?: RedisLogger): RedisClientType {
    return getRedisManager(logger).nodeClient;
}

/**
 * Close and reset the Redis manager
 */
export async function closeRedisClient(): Promise<void> {
    if (_manager) {
        await _manager.disconnect();
        _manager = null;
    }
}
/**
 * Get the shared Redis configuration options
 * Useful for libraries like BullMQ that need raw connection options
 */
export function getRedisConfig(): RedisOptions {
    const opts = { ...baseOptions };
    opts.host = "127.0.0.1";
    opts.port = 6379;

    if (REDIS_URL.startsWith("redis://")) {
        try {
            const url = new URL(REDIS_URL);
            opts.host = url.hostname;
            opts.port = parseInt(url.port || "6379");
            if (url.password) opts.password = url.password;
            if (url.username) opts.username = url.username;
        } catch (e) {
            console.warn("[Redis] Failed to parse Redis URL, using defaults");
        }
    }

    if (REDIS_PASSWORD) {
        opts.password = REDIS_PASSWORD;
    }

    return opts;
}

