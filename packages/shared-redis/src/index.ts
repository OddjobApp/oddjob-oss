/**
 * Shared Redis Package
 * 
 * Provides centralized Redis client management and utilities
 * for all Oddjob services.
 */

// Client management
export {
    RedisClientManager,
    getRedisManager,
    getRedisClient,
    closeRedisClient,
    type RedisLogger,
} from './client.js';

// Key naming conventions
export {
    PipelineKeys,
    SessionKeys,
    CacheKeys,
    Channels,
    QueueKeys,
    IPCKeys,
} from './keys.js';

export { RedisStreamRPC, type IPCRequest, type IPCResponse } from './ipc.js';


// Re-export Redis types for convenience
export type { Redis, RedisOptions } from 'ioredis';

