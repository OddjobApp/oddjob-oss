import { type EventPayload, eventStream } from "@domain/core/infrastructure/event-stream.service.js";
// Lazy loaded to avoid circular dependencies
import { pipelineTriggers, pipelines, pipelineTriggerLogs } from "@shared/schema/index.js";

/**
 * Safely evaluate a trigger filter condition against an event.
 * Supports: condition1 && condition2 || condition3
 * Each condition must follow: event.<field> <op> <literal>
 */
export function evaluateFilterCondition(condition: string, event: EventPayload): boolean {
    const trimmed = condition.trim();
    if (!trimmed) return true;

    // Split by && and || while preserving the delimiters for processing
    // Note: Simple left-to-right evaluation, no parentheses support for now to keep it safe/simple
    const tokens = trimmed.split(/(&&|\|\|)/).map(t => t.trim());
    
    let result = false;
    let nextOp: '&&' | '||' | null = null;

    for (const token of tokens) {
        if (token === "&&" || token === "||") {
            nextOp = token;
            continue;
        }

        const subResult = evaluateSingleCondition(token, event);

        if (nextOp === null) {
            result = subResult;
        } else if (nextOp === "&&") {
            result = result && subResult;
        } else if (nextOp === "||") {
            result = result || subResult;
        }
        nextOp = null;
    }

    return result;
}

/**
 * Evaluates a single comparison: event.<field> <op> <literal>
 */
export function evaluateSingleCondition(token: string, event: EventPayload): boolean {
    const SAFE_PATTERN = /^event\.([\w.]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(['"]?[\w.\-@: ]+['"]?)$/;
    const match = token.match(SAFE_PATTERN);
    if (!match) {
        throw new Error(
            `Condition part "${token}" is not a supported expression. ` +
            `Use: event.<field> <op> <literal>`
        );
    }
    const [, path, op, rawValue] = match;
    const fieldValue = path.split(".").reduce<any>((obj, key) => obj?.[key], event);
    
    let literal: string | number | boolean;
    if (rawValue === "true") literal = true;
    else if (rawValue === "false") literal = false;
    else if (rawValue !== "" && !isNaN(Number(rawValue))) literal = Number(rawValue);
    else literal = rawValue.replace(/^['"]|['"]$/g, "");

    switch (op) {
        case "===": case "==":  return fieldValue === literal;
        case "!==": case "!=":  return fieldValue !== literal;
        case ">":  return Number(fieldValue) > Number(literal);
        case ">=": return Number(fieldValue) >= Number(literal);
        case "<":  return Number(fieldValue) < Number(literal);
        case "<=": return Number(fieldValue) <= Number(literal);
        default: return false;
    }
}
import { eq, and } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { notificationService } from "./notification.service.js";

/**
 * Pipeline Trigger Service
 * 
 * Listens to the Event Stream and executes pipelines based on configured triggers.
 */
export class PipelineTriggerService {
    private async getExecutor() {
        // Use the process-wide singleton to share the dedup guard and abort signal set
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        return pipelineExecutor;
    }

    /**
     * Start listening for events
     */
    async start(): Promise<void> {
        // Subscribe to all events
        eventStream.on("*", this.handleEvent.bind(this));
        console.log("[PipelineTrigger] Started listening for events");
    }

    /**
     * Handle incoming event
     */
    private async handleEvent(event: EventPayload): Promise<void> {
        // 1. Find all active triggers for this event type
        try {
            const triggers = await db
                .select({
                    trigger: pipelineTriggers,
                    pipeline: pipelines
                })
                .from(pipelineTriggers)
                .innerJoin(pipelines, eq(pipelineTriggers.pipelineId, pipelines.id))
                .where(
                    and(
                        eq(pipelineTriggers.eventType, event.eventType),
                        eq(pipelineTriggers.isActive, true),
                        eq(pipelines.isActive, true)
                    )
                );

            if (triggers.length === 0) return;

            console.log(`[PipelineTrigger] Found ${triggers.length} triggers for event '${event.eventType}'`);

            for (const { trigger, pipeline } of triggers) {
                // 2. Check filter condition (if any)
                let shouldRun = true;
                let evaluationError: string | null = null;
                
                if (trigger.filterCondition) {
                    try {
                        shouldRun = evaluateFilterCondition(trigger.filterCondition, event);
                    } catch (err: any) {
                        console.error(`[PipelineTrigger] Filter evaluation failed for trigger ${trigger.id}:`, err);
                        shouldRun = false;
                        evaluationError = err.message || String(err);
                    }
                }

                let executionId: number | null = null;
                let outcome: 'executed' | 'filtered' | 'error' = shouldRun ? 'executed' : 'filtered';
                if (evaluationError) outcome = 'error';

                if (shouldRun && event.eventId) {
                    // Cheap redelivery guard: Redis pub/sub plus a restart can
                    // deliver the same event twice — a prior 'executed' log for
                    // this (trigger, event) means we already ran it.
                    const [alreadyRan] = await db
                        .select({ id: pipelineTriggerLogs.id })
                        .from(pipelineTriggerLogs)
                        .where(
                            and(
                                eq(pipelineTriggerLogs.triggerId, trigger.id),
                                eq(pipelineTriggerLogs.eventId, event.eventId),
                                eq(pipelineTriggerLogs.outcome, 'executed')
                            )
                        )
                        .limit(1);
                    if (alreadyRan) {
                        shouldRun = false;
                        outcome = 'filtered';
                        evaluationError = 'duplicate event delivery';
                    }
                }

                if (shouldRun) {
                    console.log(`[PipelineTrigger] Triggering ${trigger.actionType} for event '${event.eventType}'`);

                    if (trigger.actionType === 'notification' && trigger.notificationConfig) {
                        try {
                            const config = trigger.notificationConfig as any;
                            await notificationService.send({
                                channel: config.channel,
                                target: config.target,
                                subject: `Oddjob Alert: ${event.eventType}`,
                                body: config.template 
                                    ? config.template.replace(/\{\{(.*?)\}\}/g, (_: string, key: string) => {
                                        // Simple interpolation for event payload
                                        const parts = key.trim().split('.');
                                        let val: any = event;
                                        for (const part of parts) {
                                            val = val?.[part];
                                        }
                                        return val ?? `{{${key}}}`;
                                      })
                                    : `Event ${event.eventType} triggered. Payload: ${JSON.stringify(event.payload)}`
                            });
                            outcome = 'executed';
                        } catch (notifErr: any) {
                            console.error(`[PipelineTrigger] Notification failed for trigger ${trigger.id}:`, notifErr);
                            outcome = 'error';
                            evaluationError = notifErr.message || String(notifErr);
                        }
                    } else {
                        // Default: Execute Pipeline
                        try {
                            // A pipeline owned by a workflow runs its ACTIVE
                            // production release; paused/undeployed workflows
                            // must not start runs. No workflow = legacy behaviour.
                            const { workflowLifecycleService } = await import("./workflow-lifecycle.service.js");
                            const active = await workflowLifecycleService.resolveActiveRelease(pipeline.id);
                            const owner = active
                                ? null
                                : await workflowLifecycleService.findByPipeline(pipeline.id);

                            if (owner) {
                                shouldRun = false;
                                outcome = 'filtered';
                                evaluationError = 'workflow has no active deployment';
                                console.log(`[PipelineTrigger] Pipeline ${pipeline.id} is a workflow draft with no active deployment — not firing`);
                            } else {
                                const executor = await this.getExecutor();
                                const execution = await executor.executePipeline(
                                    pipeline.id,
                                    "system-event-trigger",
                                    null, // startStepId
                                    null, // ttl
                                    { event }, // initialVariables
                                    undefined,
                                    undefined,
                                    undefined,
                                    undefined,
                                    active ? { workflowReleaseId: active.releaseId, workflowDeploymentId: active.deploymentId } : undefined
                                );
                                executionId = execution?.executionId || null;
                            }
                        } catch (execErr: any) {
                            console.error(`[PipelineTrigger] Execution failed for pipeline ${pipeline.id}:`, execErr);
                            outcome = 'error';
                            evaluationError = execErr.message || String(execErr);
                        }
                    }
                }

                // 4. Log the result
                try {
                    await db.insert(pipelineTriggerLogs).values({
                        organizationId: pipeline.organizationId,
                        pipelineId: pipeline.id,
                        triggerId: trigger.id,
                        eventId: event.eventId,
                        eventType: event.eventType,
                        eventPayload: event.payload as any,
                        evaluationResult: shouldRun,
                        filterCondition: trigger.filterCondition,
                        outcome: outcome,
                        executionId: executionId,
                        errorMessage: evaluationError,
                    });
                } catch (logErr) {
                    console.error("[PipelineTrigger] Failed to write trigger log:", logErr);
                }
            }
        } catch (error) {
            console.error(`[PipelineTrigger] Error handling event ${event.eventType}:`, error);
        }
    }
}

export const pipelineTriggerService = new PipelineTriggerService();


