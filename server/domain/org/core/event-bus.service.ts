import { EventEmitter } from "events";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and } from "drizzle-orm";
import { orgSettings } from "@shared/schema/index.js";

const logger = createLogger("EventBusService");

/**
 * Event types for cross-app communication
 */
export enum CrossAppEventType {
    // Requirements events
    REQUIREMENT_CREATED = "requirement.created",
    REQUIREMENT_UPDATED = "requirement.updated",
    REQUIREMENT_DELETED = "requirement.deleted",
    REQUIREMENT_APPROVED = "requirement.approved",
    REQUIREMENT_REJECTED = "requirement.rejected",
    
    // Story/JIRA events
    STORY_CREATED = "story.created",
    STORY_UPDATED = "story.updated",
    STORY_MOVED = "story.moved",
    STORY_BLOCKED = "story.blocked",
    STORY_UNBLOCKED = "story.unblocked",
    
    // Test events
    TEST_FAILED = "test.failed",
    TEST_PASSED = "test.passed",
    TEST_COVERAGE_CHANGED = "test.coverage_changed",
    FLAKY_TEST_DETECTED = "test.flaky_detected",
    
    // Agent events
    AGENT_PIP_TRIGGERED = "agent.pip_triggered",
    AGENT_PIP_COMPLETED = "agent.pip_completed",
    AGENT_PERFORMANCE_DEGRADED = "agent.performance_degraded",
    AGENT_TOKEN_BUDGET_EXCEEDED = "agent.token_budget_exceeded",
    
    // Deployment events
    DEPLOYMENT_STARTED = "deployment.started",
    DEPLOYMENT_COMPLETED = "deployment.completed",
    DEPLOYMENT_FAILED = "deployment.failed",
    DEPLOYMENT_ROLLED_BACK = "deployment.rolled_back",
    
    // Blocker events
    BLOCKER_CREATED = "blocker.created",
    BLOCKER_RESOLVED = "blocker.resolved",
    BLOCKER_ESCALATED = "blocker.escalated",
    
    // Sprint events
    SPRINT_STARTED = "sprint.started",
    SPRINT_COMPLETED = "sprint.completed",
    SPRINT_VELOCITY_CHANGED = "sprint.velocity_changed",
    
    // Budget events
    BUDGET_WARNING = "budget.warning",
    BUDGET_EXCEEDED = "budget.exceeded",
    
    // Guardrail events (observability for agent stopping conditions)
    GUARDRAIL_TRIGGERED = "guardrail.triggered",
    GUARDRAIL_ITERATION_LIMIT = "guardrail.iteration_limit",
    GUARDRAIL_TOKEN_BUDGET = "guardrail.token_budget",
    GUARDRAIL_STALL_DETECTED = "guardrail.stall_detected",
    
    // Workspace events
    WORKSPACE_PROVISIONED = "workspace.provisioned",
    WORKSPACE_HEALTH_CHECK_FAILED = "workspace.health_check_failed",
    
    // Pipeline step events (for event-driven mission advancement)
    STEP_OUTPUT_WRITTEN = "step.output_written",
    STEP_COMPLETED = "step.completed",
    STEP_FAILED = "step.failed",
    
    // Mission events
    MISSION_STEP_ADVANCED = "mission.step_advanced",
    
    // App events
    APP_PROVISIONED = "app.provisioned",
    BLUEPRINT_INSTALLED = "blueprint.installed",

    // Autonomous action events (Signal Intelligence engine).
    // The string values match the ad-hoc types these were originally emitted
    // with, so anything already keyed on the wire format keeps working.
    AUTONOMOUS_ACTION_SPAWN_CYCLE = "autonomous-action:spawn-cycle",
    AUTONOMOUS_ACTION_CREATE_RFC = "autonomous-action:create-rfc",
    AUTONOMOUS_ACTION_UPDATE_COMPLIANCE_CHECK = "autonomous-action:update-compliance-check",
    AUTONOMOUS_ACTION_MODIFY_SPATIAL_ROUTING = "autonomous-action:modify-spatial-routing",
}

/**
 * Event payload interface
 */
export interface CrossAppEvent {
    id: string;
    type: CrossAppEventType;
    organizationId: number;
    timestamp: Date;
    sourceApp: string;
    payload: any;
    metadata?: {
        userId?: string;
        correlationId?: string;
        priority?: "low" | "medium" | "high" | "critical";
    };
}

/**
 * Event handler interface
 */
/**
 * What a handler did, when the publisher needs to know.
 *
 * Returning nothing keeps the old contract — the handler ran without throwing
 * and is treated as succeeded. Handlers that catch their own errors (the usual
 * pattern here, so one bad consumer cannot break a fan-out) must return an
 * explicit `failed` status, because a caught error is invisible from outside.
 */
export interface HandlerResult {
    status?: "succeeded" | "failed" | "skipped";
    /** Numeric facts about what actually happened, for outcome comparison. */
    metrics?: Record<string, number>;
    detail?: string;
}

export interface EventHandler {
    eventType: CrossAppEventType;
    /** A name for this handler, used in publish outcomes. */
    name?: string;
    handler: (event: CrossAppEvent) => Promise<void | HandlerResult>;
    filter?: (event: CrossAppEvent) => boolean;
}

/** One handler's verdict on one published event. */
export interface HandlerOutcome {
    name: string;
    status: "succeeded" | "failed" | "skipped";
    metrics?: Record<string, number>;
    detail?: string;
}

export interface PublishResult {
    eventId: string;
    /** Empty when nothing was registered for the event type. */
    outcomes: HandlerOutcome[];
}

/**
 * Cross-App Event Bus Service
 * Enables real-time communication between workbenches
 */
/**
 * Cross-app event bus.
 *
 * IMPORTANT — publish(), not emit(). This class extends EventEmitter, so the
 * inherited `emit(type, payload)` is always in scope and looks like the obvious
 * way to send an event. It is not: raw `emit` only wakes EventEmitter listeners
 * registered through `.on()`/`subscribe()`. It does NOT invoke handlers added
 * via `registerHandler()`, and it does NOT write the event log that
 * `getEventHistory()` reads.
 *
 * Everything publishing an event should call `publish()`, which logs the event,
 * emits it to EventEmitter listeners, AND runs the registered handlers. It is a
 * strict superset of `emit`.
 */
export class CrossAppEventBusService extends EventEmitter {
    private static instance: CrossAppEventBusService;
    private handlers: Map<CrossAppEventType, EventHandler[]> = new Map();
    private eventLog: Map<number, CrossAppEvent[]> = new Map(); // orgId -> events
    private maxLogSize: number = 1000;

    private constructor() {
        super();
        this.setMaxListeners(100);
    }

    static getInstance(): CrossAppEventBusService {
        if (!CrossAppEventBusService.instance) {
            CrossAppEventBusService.instance = new CrossAppEventBusService();
        }
        return CrossAppEventBusService.instance;
    }

    /**
     * Register an event handler
     */
    registerHandler(handler: EventHandler): void {
        const existing = this.handlers.get(handler.eventType) || [];
        existing.push(handler);
        this.handlers.set(handler.eventType, existing);
        logger.info(`[EventBus] Registered handler for ${handler.eventType}`);
    }

    /**
     * Unregister an event handler
     */
    unregisterHandler(eventType: CrossAppEventType, handler: EventHandler): void {
        const existing = this.handlers.get(eventType) || [];
        const filtered = existing.filter(h => h !== handler);
        this.handlers.set(eventType, filtered);
        logger.info(`[EventBus] Unregistered handler for ${eventType}`);
    }

    /**
     * Publish an event to the bus
     */
    async publish(event: Omit<CrossAppEvent, "id" | "timestamp">): Promise<string> {
        return (await this.publishWithResults(event)).eventId;
    }

    /**
     * Publish, and report what each handler did.
     *
     * `publish()` returns only an event id and swallows every handler error, so
     * from a publisher's point of view a fan-out where every consumer threw is
     * indistinguishable from one where all of them succeeded — and a fan-out
     * with NO registered consumer is indistinguishable from both. That is fine
     * for genuine notifications, which is most callers here, and it is why
     * `publish()` keeps exactly its old behaviour.
     *
     * It is not fine for an autonomous action. There, "did this happen?" is the
     * whole question: the outcome observation fed to the prediction-error loop
     * was reporting that an event had been *emitted*, not that anything had been
     * *done*, which made a wrong prediction impossible to detect.
     *
     * Errors are still contained per handler — one failing consumer must not
     * stop the others — but they are now reported rather than only logged.
     */
    async publishWithResults(
        event: Omit<CrossAppEvent, "id" | "timestamp">,
    ): Promise<PublishResult> {
        const fullEvent: CrossAppEvent = {
            ...event,
            id: this.generateEventId(),
            timestamp: new Date(),
        };

        // Log event
        this.logEvent(fullEvent);

        // Emit to EventEmitter
        this.emit(fullEvent.type, fullEvent);

        // Call registered handlers
        const handlers = this.handlers.get(fullEvent.type) || [];
        const outcomes: HandlerOutcome[] = [];

        for (const [index, handler] of handlers.entries()) {
            const name = handler.name ?? `${fullEvent.type}#${index}`;
            try {
                if (handler.filter && !handler.filter(fullEvent)) {
                    outcomes.push({ name, status: "skipped", detail: "filtered out" });
                    continue;
                }
                const result = await handler.handler(fullEvent);
                outcomes.push({
                    name,
                    // A handler that returns nothing and does not throw has
                    // succeeded, which preserves the contract every existing
                    // handler was written against.
                    status: result?.status ?? "succeeded",
                    metrics: result?.metrics,
                    detail: result?.detail,
                });
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                logger.error(`[EventBus] Handler error for ${fullEvent.type}:`, error);
                outcomes.push({ name, status: "failed", detail });
            }
        }

        logger.info(`[EventBus] Published event ${fullEvent.id} of type ${fullEvent.type} from ${fullEvent.sourceApp}`);
        return { eventId: fullEvent.id, outcomes };
    }

    /**
     * Subscribe to events of a specific type
     */
    subscribe(eventType: CrossAppEventType, callback: (event: CrossAppEvent) => void): void {
        this.on(eventType, callback);
        logger.info(`[EventBus] Subscribed to ${eventType}`);
    }

    /**
     * Unsubscribe from events
     */
    unsubscribe(eventType: CrossAppEventType, callback: (event: CrossAppEvent) => void): void {
        this.off(eventType, callback);
        logger.info(`[EventBus] Unsubscribed from ${eventType}`);
    }

    /**
     * Get event history for an organization
     */
    getEventHistory(organizationId: number, limit: number = 100): CrossAppEvent[] {
        const events = this.eventLog.get(organizationId) || [];
        return events.slice(-limit);
    }

    /**
     * Get events by type for an organization
     */
    getEventsByType(organizationId: number, eventType: CrossAppEventType, limit: number = 100): CrossAppEvent[] {
        const events = this.eventLog.get(organizationId) || [];
        return events
            .filter(e => e.type === eventType)
            .slice(-limit);
    }

    /**
     * Clear event history for an organization
     */
    clearEventHistory(organizationId: number): void {
        this.eventLog.delete(organizationId);
        logger.info(`[EventBus] Cleared event history for org ${organizationId}`);
    }

    /**
     * Log event to in-memory store
     */
    private logEvent(event: CrossAppEvent): void {
        const events = this.eventLog.get(event.organizationId) || [];
        events.push(event);
        
        // Enforce max log size
        if (events.length > this.maxLogSize) {
            events.shift();
        }
        
        this.eventLog.set(event.organizationId, events);
    }

    /**
     * Generate unique event ID
     */
    private generateEventId(): string {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Check if event bus is enabled for organization
     */
    async isEnabled(organizationId: number): Promise<boolean> {
        try {
            const [rawSettings] = await db.select()
                .from(orgSettings)
                .where(eq(orgSettings.organizationId, organizationId))
                .limit(1);
            
            return (rawSettings as any)?.eventBusEnabled ?? true;
        } catch (error) {
            logger.error(`[EventBus] Error checking enabled status:`, error);
            return true; // Default to enabled
        }
    }
}

export const crossAppEventBus = CrossAppEventBusService.getInstance();
