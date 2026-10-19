/**
 * Mission Correlation Service
 * 
 * Provides distributed tracing capabilities for missions through correlation IDs.
 * Each mission execution gets a unique correlation ID that propagates through:
 * - Mission runs and checkpoints
 * - Pipeline executions
 * - Tool calls
 * - Event stream events
 * - Logs
 * 
 * This enables end-to-end tracing of mission execution across all services.
 */

import { createLogger } from "@server/utils/logger.js";
import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";

const logger = createLogger("MissionCorrelation");

// Thread-local storage for correlation context
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export interface CorrelationContext {
    correlationId: string;
    missionId?: number;
    missionRunId?: number;
    parentCorrelationId?: string;
    tracePath: string[];
    startedAt: Date;
}

export interface LogEntry {
    timestamp: string;
    correlationId: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    component: string;
    message: string;
    metadata?: Record<string, any>;
    tracePath?: string[];
}

export const missionCorrelationService = {
    /**
     * Generate a new correlation ID
     */
    generateCorrelationId(): string {
        return `corr_${randomUUID().replace(/-/g, '').substring(0, 16)}_${Date.now()}`;
    },

    /**
     * Create a child correlation ID for sub-missions or tool calls
     */
    createChildCorrelation(parentContext: CorrelationContext, component: string): string {
        const childId = `${parentContext.correlationId}:${component}_${Date.now()}`;
        return childId;
    },

    /**
     * Initialize correlation context for a new mission execution
     */
    initializeMissionContext(missionId: number, missionRunId: number, parentCorrelationId?: string): CorrelationContext {
        const correlationId = this.generateCorrelationId();
        const context: CorrelationContext = {
            correlationId,
            missionId,
            missionRunId,
            parentCorrelationId,
            tracePath: parentCorrelationId ? ['child'] : ['root'],
            startedAt: new Date(),
        };
        
        logger.info(`[${correlationId}] Initialized mission correlation`, {
            missionId,
            missionRunId,
            parentCorrelationId,
        });
        
        return context;
    },

    /**
     * Run a function within a correlation context
     */
    async runWithContext<T>(context: CorrelationContext, fn: () => Promise<T>): Promise<T> {
        return correlationStorage.run(context, fn);
    },

    /**
     * Get current correlation context (if any)
     */
    getCurrentContext(): CorrelationContext | undefined {
        return correlationStorage.getStore();
    },

    /**
     * Get correlation ID from current context, or generate new one
     */
    getCorrelationId(): string {
        const context = this.getCurrentContext();
        return context?.correlationId || this.generateCorrelationId();
    },

    /**
     * Add trace step to current context
     */
    addTraceStep(step: string): void {
        const context = this.getCurrentContext();
        if (context) {
            context.tracePath.push(step);
        }
    },

    /**
     * Create structured log entry with correlation context
     */
    createLogEntry(
        level: LogEntry['level'],
        component: string,
        message: string,
        metadata?: Record<string, any>
    ): LogEntry {
        const context = this.getCurrentContext();
        
        return {
            timestamp: new Date().toISOString(),
            correlationId: context?.correlationId || this.generateCorrelationId(),
            level,
            component,
            message,
            metadata: {
                ...metadata,
                missionId: context?.missionId,
                missionRunId: context?.missionRunId,
            },
            tracePath: context?.tracePath,
        };
    },

    /**
     * Log with correlation context
     */
    log(level: LogEntry['level'], component: string, message: string, metadata?: Record<string, any>): void {
        const entry = this.createLogEntry(level, component, message, metadata);
        
        // Use the underlying logger with correlation ID prefix
        const logMessage = `[${entry.correlationId}] ${message}`;
        
        switch (level) {
            case 'debug':
                logger.debug(logMessage, metadata);
                break;
            case 'info':
                logger.info(logMessage, metadata);
                break;
            case 'warn':
                logger.warn(logMessage, metadata);
                break;
            case 'error':
                logger.error(logMessage, metadata);
                break;
        }
    },

    /**
     * Wrap a function to run with child correlation context
     * Useful for tool calls, sub-missions, etc.
     */
    async withChildContext<T>(
        component: string,
        metadata: { missionId?: number; missionRunId?: number } = {},
        fn: (childContext: CorrelationContext) => Promise<T>
    ): Promise<T> {
        const parentContext = this.getCurrentContext();
        
        const childContext: CorrelationContext = {
            correlationId: parentContext 
                ? this.createChildCorrelation(parentContext, component)
                : this.generateCorrelationId(),
            missionId: metadata.missionId || parentContext?.missionId,
            missionRunId: metadata.missionRunId || parentContext?.missionRunId,
            parentCorrelationId: parentContext?.correlationId,
            tracePath: parentContext 
                ? [...parentContext.tracePath, component]
                : [component],
            startedAt: new Date(),
        };

        this.log('debug', component, `Starting ${component} execution`, {
            parentCorrelationId: childContext.parentCorrelationId,
        });

        try {
            const result = await this.runWithContext(childContext, () => fn(childContext));
            
            this.log('debug', component, `${component} completed successfully`);
            
            return result;
        } catch (error: any) {
            this.log('error', component, `${component} failed: ${error.message}`, {
                error: error.message,
                stack: error.stack,
            });
            throw error;
        }
    },

    /**
     * Extract correlation info from mission run for event publishing
     */
    getEventMetadata(): Record<string, any> {
        const context = this.getCurrentContext();
        
        if (!context) {
            return {};
        }

        return {
            correlationId: context.correlationId,
            missionId: context.missionId,
            missionRunId: context.missionRunId,
            tracePath: context.tracePath,
            traceDuration: Date.now() - context.startedAt.getTime(),
        };
    },

    /**
     * Parse correlation ID from various formats
     */
    parseCorrelationId(id: string): { root: string; path: string[] } | null {
        if (!id.startsWith('corr_')) {
            return null;
        }

        const parts = id.split(':');
        return {
            root: parts[0],
            path: parts.slice(1),
        };
    },

    /**
     * Check if a correlation ID is a child of another
     */
    isChildOf(childId: string, parentId: string): boolean {
        return childId.startsWith(`${parentId}:`);
    },

    /**
     * Get all related correlation IDs (parent + children pattern)
     */
    getRelatedCorrelationPattern(correlationId: string): string {
        const parsed = this.parseCorrelationId(correlationId);
        if (!parsed) {
            return correlationId;
        }
        
        // Return pattern that matches this correlation and all children
        return `${parsed.root}*`;
    },
};

// Convenience methods for common log levels
export const correlatedLog = {
    debug: (component: string, message: string, metadata?: Record<string, any>) => 
        missionCorrelationService.log('debug', component, message, metadata),
    info: (component: string, message: string, metadata?: Record<string, any>) => 
        missionCorrelationService.log('info', component, message, metadata),
    warn: (component: string, message: string, metadata?: Record<string, any>) => 
        missionCorrelationService.log('warn', component, message, metadata),
    error: (component: string, message: string, metadata?: Record<string, any>) => 
        missionCorrelationService.log('error', component, message, metadata),
};
