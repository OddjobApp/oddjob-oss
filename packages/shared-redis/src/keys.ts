/**
 * Redis Key Naming Conventions
 * 
 * Centralized key generation for consistent Redis key naming
 * across all services that use Redis for caching and state.
 */

/**
 * Pipeline execution state tracking keys
 */
export const PipelineKeys = {
    /**
     * Visit count key: pipeline:exec:{executionId}:step:{stepId}:visits
     */
    visitCount: (executionId: number, stepId: number): string => {
        return `pipeline:exec:${executionId}:step:${stepId}:visits`;
    },

    /**
     * Payload hash key: pipeline:exec:{executionId}:step:{stepId}:hash
     */
    payloadHash: (executionId: number, stepId: number): string => {
        return `pipeline:exec:${executionId}:step:${stepId}:hash`;
    },

    /**
     * Execution state prefix for clearing all keys
     */
    executionPrefix: (executionId: number): string => {
        return `pipeline:exec:${executionId}:*`;
    },

    /**
     * Pipeline lock key for concurrency control
     */
    lock: (pipelineId: number): string => {
        return `pipeline:${pipelineId}:lock`;
    },
};

/**
 * Session and auth-related keys
 */
export const SessionKeys = {
    /**
     * User session key
     */
    session: (sessionId: string): string => {
        return `session:${sessionId}`;
    },

    /**
     * User session list (for multi-device tracking)
     */
    userSessions: (userId: string): string => {
        return `user:${userId}:sessions`;
    },

    /**
     * Rate limiting key
     */
    rateLimit: (identifier: string, window: string): string => {
        return `ratelimit:${identifier}:${window}`;
    },
};

/**
 * Caching keys
 */
export const CacheKeys = {
    /**
     * Generic cache key with namespace
     */
    generic: (namespace: string, key: string): string => {
        return `cache:${namespace}:${key}`;
    },

    /**
     * API response cache
     */
    apiResponse: (endpoint: string, hash: string): string => {
        return `cache:api:${endpoint}:${hash}`;
    },

    /**
     * Job execution result cache
     */
    jobResult: (jobId: number, inputHash: string): string => {
        return `cache:job:${jobId}:${inputHash}`;
    },

    /**
     * Knowledge base query cache
     */
    knowledgeQuery: (queryHash: string): string => {
        return `cache:knowledge:query:${queryHash}`;
    },
};

/**
 * Pub/Sub channel names
 */
export const Channels = {
    /**
     * Pipeline execution events
     */
    pipelineEvents: (pipelineId?: number): string => {
        return pipelineId ? `events:pipeline:${pipelineId}` : 'events:pipeline:*';
    },

    /**
     * Job execution events
     */
    jobEvents: (jobId?: number): string => {
        return jobId ? `events:job:${jobId}` : 'events:job:*';
    },

    /**
     * System-wide notifications
     */
    systemNotifications: (): string => {
        return 'events:system:notifications';
    },

    /**
     * Organization-specific events
     */
    orgEvents: (orgId: number): string => {
        return `events:org:${orgId}`;
    },
};

/**
 * Queue keys (for basic Redis-based queuing)
 */
export const QueueKeys = {
    /**
     * Work queue
     */
    queue: (name: string): string => {
        return `queue:${name}`;
    },

    /**
     * Processing queue (items being worked on)
     */
    processing: (name: string): string => {
        return `queue:${name}:processing`;
    },

    /**
     * Dead letter queue
     */
    deadLetter: (name: string): string => {
        return `queue:${name}:dlq`;
    },
};

/**
 * IPC (Inter-Process Communication) keys
 */
export const IPCKeys = {
    /**
     * Python task stream
     */
    pythonTasks: 'ipc:python:tasks',

    /**
     * Node results stream/list (one per request for basic RPC)
     */
    nodeResults: (requestId: string): string => `ipc:node:results:${requestId}`,

    /**
     * Node response stream (for scalable streaming RPC)
     */
    nodeResponses: 'ipc:node:responses',
};


