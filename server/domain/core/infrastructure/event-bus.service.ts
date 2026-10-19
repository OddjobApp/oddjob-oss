import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../database_service.js';
import { eventLog, pipelineTriggers } from '@shared/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('EventBus');

export interface CloudEvent<T = any> {
    id: string;
    source: string;
    type: string;
    specversion: '1.0';
    datacontenttype?: string;
    subject?: string;
    time?: string;
    organizationid?: number;
    pipelineexecutionid?: number;
    data: T;
}

interface DebounceEntry {
    events: CloudEvent[];
    timer: NodeJS.Timeout;
    triggerId: number;
}

const debounceMap = new Map<string, DebounceEntry>();

export function createCloudEvent<T>(
    type: string,
    source: string,
    data: T,
    options: {
        subject?: string;
        organizationId?: number;
        pipelineExecutionId?: number;
    } = {}
): CloudEvent<T> {
    return {
        id: uuidv4(),
        source,
        type,
        specversion: '1.0',
        datacontenttype: 'application/json',
        subject: options.subject,
        time: new Date().toISOString(),
        organizationid: options.organizationId,
        pipelineexecutionid: options.pipelineExecutionId,
        data,
    };
}

export async function emitEvent<T>(event: CloudEvent<T>): Promise<void> {
    logger.info(`[EventBus] Emitting event: ${event.type} from ${event.source}`, { eventId: event.id });
    await logEvent(event);
    const triggers = await findMatchingTriggers(event);
    logger.debug(`[EventBus] Found ${triggers.length} matching triggers for event type: ${event.type}`);
    for (const trigger of triggers) {
        if (trigger.debounceWindow && trigger.debounceWindow > 0) {
            await handleDebouncedTrigger(event, trigger);
        } else {
            await fireTrigger(trigger, [event]);
        }
    }
}

async function logEvent<T>(event: CloudEvent<T>): Promise<void> {
    try {
        await db.insert(eventLog).values({
            eventId: event.id,
            type: event.type,
            source: event.source,
            subject: event.subject,
            payload: event.data,
            organizationId: event.organizationid,
        });
    } catch (error) {
        logger.error('[EventBus] Failed to log event', error);
    }
}

async function findMatchingTriggers(event: CloudEvent): Promise<any[]> {
    try {
        const triggers = await db
            .select()
            .from(pipelineTriggers)
            .where(
                and(
                    eq(pipelineTriggers.eventType, event.type),
                    eq(pipelineTriggers.isActive, true)
                )
            );
        return triggers.filter(trigger => {
            if (!trigger.filterCondition) {
                return true;
            }
            try {
                const fn = new Function('event', `return (${trigger.filterCondition});`);
                return fn(event);
            } catch (error) {
                logger.warn(`[EventBus] Failed to evaluate filter condition for trigger ${trigger.id}`, { triggerId: trigger.id }, error);
                return false;
            }
        });
    } catch (error) {
        logger.error('[EventBus] Failed to find matching triggers', error);
        return [];
    }
}

async function handleDebouncedTrigger(event: CloudEvent, trigger: any): Promise<void> {
    const debounceKey = `trigger:${trigger.id}`;
    const windowMs = (trigger.debounceWindow || 60) * 1000;
    const batchSize = trigger.batchSize || 1;
    const existing = debounceMap.get(debounceKey);
    if (existing) {
        existing.events.push(event);
        if (existing.events.length >= batchSize) {
            clearTimeout(existing.timer);
            debounceMap.delete(debounceKey);
            await fireTrigger(trigger, existing.events);
        }
    } else {
        const timer = setTimeout(async () => {
            const entry = debounceMap.get(debounceKey);
            if (entry) {
                debounceMap.delete(debounceKey);
                await fireTrigger(trigger, entry.events);
            }
        }, windowMs);
        debounceMap.set(debounceKey, {
            events: [event],
            timer,
            triggerId: trigger.id,
        });
    }
}

async function fireTrigger(trigger: any, events: CloudEvent[]): Promise<void> {
    logger.info(`[EventBus] Firing trigger ${trigger.id} for pipeline ${trigger.pipelineId} with ${events.length} events`, { triggerId: trigger.id, pipelineId: trigger.pipelineId });
    try {
        const { pipelineExecutor } = await import('../../../core/pipeline-executor.js');
        const eventContext = events.length === 1
            ? { event: events[0] }
            : { events, eventCount: events.length };
        await pipelineExecutor.executePipeline(
            trigger.pipelineId,
            'event_trigger',
            undefined,
            undefined,
            {
                triggerType: 'event',
                triggerId: trigger.id,
                ...eventContext,
            }
        );
    } catch (error) {
        logger.error(`[EventBus] Failed to fire trigger ${trigger.id}`, error, { triggerId: trigger.id });
    }
}

export async function emitDiffEvent(
    entityType: 'job' | 'node' | 'step',
    entityId: number,
    diff: any,
    options: {
        organizationId?: number;
        pipelineExecutionId?: number;
        jobName?: string;
    } = {}
): Promise<void> {
    const event = createCloudEvent(
        `${entityType}.changed`,
        `${entityType}:${entityId}`,
        {
            entityId,
            entityType,
            diff,
            jobName: options.jobName,
        },
        {
            subject: `${entityType}:${entityId}`,
            organizationId: options.organizationId,
            pipelineExecutionId: options.pipelineExecutionId,
        }
    );
    await emitEvent(event);
}

export function clearPendingTriggers(): void {
    for (const entry of debounceMap.values()) {
        clearTimeout(entry.timer);
    }
    debounceMap.clear();
}





