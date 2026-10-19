/**
 * Messaging Types
 * 
 * Shared type definitions for inter-service messaging.
 */

/**
 * Base message envelope for all queue messages
 */
export interface MessageEnvelope<T = unknown> {
    messageId: string;
    type: string;
    timestamp: number;
    source: string;
    correlationId?: string;
    payload: T;
}

/**
 * Job execution request
 */
export interface JobExecutionMessage {
    jobId: number;
    userId: string;
    organizationId: number;
    input?: Record<string, any>;
    options?: {
        priority?: number;
        ttl?: number;
    };
}

/**
 * Pipeline execution request
 */
export interface PipelineExecutionMessage {
    pipelineId: number;
    userId: string;
    executionId?: number;
    startStepId?: number;
    triggerData?: Record<string, any>;
}

/**
 * Job result message
 */
export interface JobResultMessage {
    jobId: number;
    executionId: number;
    status: 'success' | 'failure';
    output?: any;
    error?: string;
    duration: number;
}

/**
 * Event notification message
 */
export interface EventMessage {
    eventType: string;
    source: string;
    payload: Record<string, any>;
    context?: Record<string, any>;
}

/**
 * Queue names
 */
export const QUEUES = {
    JOB_EXECUTION: 'oddjob.jobs.execute',
    JOB_RESULTS: 'oddjob.jobs.results',
    PIPELINE_EXECUTION: 'oddjob.pipelines.execute',
    PIPELINE_RESULTS: 'oddjob.pipelines.results',
    EVENTS: 'oddjob.events',
    DEAD_LETTER: 'oddjob.dead-letter',
} as const;

/**
 * Exchange names
 */
export const EXCHANGES = {
    JOBS: 'oddjob.jobs',
    PIPELINES: 'oddjob.pipelines',
    EVENTS: 'oddjob.events',
} as const;

