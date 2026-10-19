/**
 * Event Publishing Utilities
 * 
 * High-level helpers for publishing domain events
 * to the event bus.
 */

import { publishToExchange } from "./rabbitmq.js";
import { EXCHANGES, type EventMessage } from "./types.js";

/**
 * Publish a domain event
 */
export async function publishEvent(
    eventType: string,
    payload: Record<string, any>,
    context?: Record<string, any>
): Promise<void> {
    const event: EventMessage = {
        eventType,
        source: process.env.SERVICE_NAME || "unknown",
        payload,
        context,
    };

    await publishToExchange(EXCHANGES.EVENTS, eventType, event, {
        type: eventType,
    });
}

/**
 * Publish a job-related event
 */
export async function publishJobEvent(
    action: 'created' | 'started' | 'completed' | 'failed',
    jobId: number,
    data?: Record<string, any>
): Promise<void> {
    await publishEvent(`job.${action}`, {
        jobId,
        ...data,
    });
}

/**
 * Publish a pipeline-related event
 */
export async function publishPipelineEvent(
    action: 'created' | 'started' | 'completed' | 'failed' | 'step_completed',
    pipelineId: number,
    data?: Record<string, any>
): Promise<void> {
    await publishEvent(`pipeline.${action}`, {
        pipelineId,
        ...data,
    });
}

/**
 * Publish a user-related event
 */
export async function publishUserEvent(
    action: 'login' | 'logout' | 'created' | 'updated',
    userId: string,
    data?: Record<string, any>
): Promise<void> {
    await publishEvent(`user.${action}`, {
        userId,
        ...data,
    });
}

/**
 * Publish a system event
 */
export async function publishSystemEvent(
    action: string,
    data?: Record<string, any>
): Promise<void> {
    await publishEvent(`system.${action}`, data || {});
}

