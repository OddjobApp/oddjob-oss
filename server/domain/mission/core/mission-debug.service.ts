/**
 * Mission Debug Service
 * 
 * Provides step-through debugging capabilities for mission execution.
 * Allows pausing at breakpoints, inspecting state, modifying parameters,
 * and controlling execution flow.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { missionCorrelationService } from "./mission-correlation.service.js";

const logger = createLogger("MissionDebug");

export interface DebugSession {
    missionRunId: number;
    correlationId: string;
    status: DebugStatus;
    breakpoints: Breakpoint[];
    pausedAt?: DebugPausePoint;
    stepMode: StepMode;
    startTime: Date;
    lastActivity: Date;
    history: DebugAction[];
}

export type DebugStatus = 'active' | 'paused' | 'stepping' | 'terminated';
export type StepMode = 'run' | 'step_over' | 'step_into' | 'step_out';

export interface Breakpoint {
    id: string;
    type: 'tool_call' | 'phase_change' | 'blackboard_update' | 'line' | 'condition';
    target?: string; // tool name, phase name, etc.
    condition?: string; // Optional condition expression
    enabled: boolean;
    hitCount: number;
}

export interface DebugPausePoint {
    type: 'breakpoint' | 'step' | 'exception' | 'manual';
    timestamp: Date;
    phase?: string;
    toolName?: string;
    blackboardSnapshot: Record<string, any>;
    cycleCount: number;
    nextAction?: string;
    callStack: string[];
}

export interface DebugAction {
    timestamp: Date;
    action: 'pause' | 'resume' | 'step_over' | 'step_into' | 'step_out' | 'continue' | 'modify';
    details?: Record<string, any>;
}

export interface DebugInspectResult {
    blackboard: Record<string, any>;
    phase?: string;
    cycleCount: number;
    lastToolRun?: string;
    variables: Array<{ name: string; value: any; type: string }>;
    callStack: string[];
    canModify: boolean;
}

// In-memory debug sessions (could be Redis in production)
const debugSessions = new Map<number, DebugSession>();

export const missionDebugService = {
    /**
     * Start a debug session for a mission run
     */
    async startDebugSession(missionRunId: number, options: {
        autoPauseOnStart?: boolean;
        initialBreakpoints?: Breakpoint[];
    } = {}): Promise<DebugSession> {
        const correlationId = missionCorrelationService.getCorrelationId();
        
        const session: DebugSession = {
            missionRunId,
            correlationId,
            status: options.autoPauseOnStart ? 'paused' : 'active',
            breakpoints: options.initialBreakpoints || [],
            stepMode: 'run',
            startTime: new Date(),
            lastActivity: new Date(),
            history: [],
        };

        if (options.autoPauseOnStart) {
            session.pausedAt = {
                type: 'manual',
                timestamp: new Date(),
                blackboardSnapshot: {},
                cycleCount: 0,
                callStack: ['start'],
            };
        }

        debugSessions.set(missionRunId, session);

        logger.info(`[Debug] Started debug session for run ${missionRunId}`, {
            correlationId,
            autoPause: options.autoPauseOnStart,
        });

        await eventStream.publish('mission.debug_session_started', {
            missionRunId,
            correlationId,
            status: session.status,
        }, {
            correlationId,
            subject: `mission-run:${missionRunId}`,
        }, 'mission-debug');

        return session;
    },

    /**
     * Get current debug session
     */
    getDebugSession(missionRunId: number): DebugSession | undefined {
        return debugSessions.get(missionRunId);
    },

    /**
     * Check if mission is in debug mode
     */
    isDebugMode(missionRunId: number): boolean {
        return debugSessions.has(missionRunId);
    },

    /**
     * Check if execution should pause
     */
    shouldPause(
        missionRunId: number,
        context: {
            phase?: string;
            toolName?: string;
            cycleCount: number;
            blackboard: Record<string, any>;
        }
    ): { shouldPause: boolean; reason?: string } {
        const session = debugSessions.get(missionRunId);
        if (!session) return { shouldPause: false };

        // Check step mode
        if (session.stepMode === 'step_over' || session.stepMode === 'step_into') {
            session.status = 'paused';
            session.pausedAt = this.createPausePoint('step', context);
            session.stepMode = 'run'; // Reset step mode
            return { shouldPause: true, reason: `step_${session.stepMode}` };
        }

        // Check breakpoints
        for (const bp of session.breakpoints.filter(b => b.enabled)) {
            if (this.matchesBreakpoint(bp, context)) {
                bp.hitCount++;
                session.status = 'paused';
                session.pausedAt = this.createPausePoint('breakpoint', context, bp.id);
                return { shouldPause: true, reason: `breakpoint:${bp.id}` };
            }
        }

        return { shouldPause: false };
    },

    /**
     * Pause execution manually
     */
    async pause(missionRunId: number, reason = 'manual'): Promise<DebugSession | null> {
        const session = debugSessions.get(missionRunId);
        if (!session) return null;

        session.status = 'paused';
        session.pausedAt = {
            type: 'manual',
            timestamp: new Date(),
            blackboardSnapshot: {},
            cycleCount: 0,
            callStack: ['manual_pause'],
        };
        session.lastActivity = new Date();
        session.history.push({
            timestamp: new Date(),
            action: 'pause',
            details: { reason },
        });

        await eventStream.publish('mission.debug_paused', {
            missionRunId,
            reason,
            correlationId: session.correlationId,
        }, {
            correlationId: session.correlationId,
            subject: `mission-run:${missionRunId}`,
        }, 'mission-debug');

        return session;
    },

    /**
     * Resume execution
     */
    async resume(missionRunId: number): Promise<DebugSession | null> {
        const session = debugSessions.get(missionRunId);
        if (!session) return null;

        session.status = 'active';
        session.stepMode = 'run';
        session.pausedAt = undefined;
        session.lastActivity = new Date();
        session.history.push({
            timestamp: new Date(),
            action: 'resume',
        });

        await eventStream.publish('mission.debug_resumed', {
            missionRunId,
            correlationId: session.correlationId,
        }, {
            correlationId: session.correlationId,
            subject: `mission-run:${missionRunId}`,
        }, 'mission-debug');

        return session;
    },

    /**
     * Step over - execute next action and pause
     */
    async stepOver(missionRunId: number): Promise<DebugSession | null> {
        const session = debugSessions.get(missionRunId);
        if (!session) return null;

        session.stepMode = 'step_over';
        session.status = 'stepping';
        session.pausedAt = undefined;
        session.lastActivity = new Date();
        session.history.push({
            timestamp: new Date(),
            action: 'step_over',
        });

        return session;
    },

    /**
     * Step into - dive deeper into next operation
     */
    async stepInto(missionRunId: number): Promise<DebugSession | null> {
        const session = debugSessions.get(missionRunId);
        if (!session) return null;

        session.stepMode = 'step_into';
        session.status = 'stepping';
        session.pausedAt = undefined;
        session.lastActivity = new Date();
        session.history.push({
            timestamp: new Date(),
            action: 'step_into',
        });

        return session;
    },

    /**
     * Continue until next breakpoint
     */
    async continueUntilBreakpoint(missionRunId: number): Promise<DebugSession | null> {
        return this.resume(missionRunId);
    },

    /**
     * Add a breakpoint
     */
    async addBreakpoint(
        missionRunId: number,
        breakpoint: Omit<Breakpoint, 'id' | 'hitCount'>
    ): Promise<Breakpoint | null> {
        const session = debugSessions.get(missionRunId);
        if (!session) return null;

        const newBp: Breakpoint = {
            ...breakpoint,
            id: `bp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            hitCount: 0,
        };

        session.breakpoints.push(newBp);
        session.lastActivity = new Date();

        return newBp;
    },

    /**
     * Remove a breakpoint
     */
    async removeBreakpoint(missionRunId: number, breakpointId: string): Promise<boolean> {
        const session = debugSessions.get(missionRunId);
        if (!session) return false;

        const index = session.breakpoints.findIndex(bp => bp.id === breakpointId);
        if (index === -1) return false;

        session.breakpoints.splice(index, 1);
        session.lastActivity = new Date();

        return true;
    },

    /**
     * Enable/disable breakpoint
     */
    async toggleBreakpoint(missionRunId: number, breakpointId: string, enabled: boolean): Promise<boolean> {
        const session = debugSessions.get(missionRunId);
        if (!session) return false;

        const bp = session.breakpoints.find(b => b.id === breakpointId);
        if (!bp) return false;

        bp.enabled = enabled;
        session.lastActivity = new Date();

        return true;
    },

    /**
     * Inspect current state when paused
     */
    async inspect(missionRunId: number, currentContext: Record<string, any>): Promise<DebugInspectResult | null> {
        const session = debugSessions.get(missionRunId);
        if (!session) return null;

        const blackboard = currentContext;
        
        // Extract variables from blackboard
        const variables = Object.entries(blackboard)
            .filter(([key]) => !key.startsWith('_')) // Filter internal keys
            .map(([name, value]) => ({
                name,
                value,
                type: typeof value,
            }));

        return {
            blackboard,
            phase: currentContext.phase,
            cycleCount: currentContext.cycleCount || 0,
            lastToolRun: currentContext.lastToolRun,
            variables,
            callStack: session.pausedAt?.callStack || [],
            canModify: session.status === 'paused',
        };
    },

    /**
     * Modify blackboard during debug pause
     */
    async modifyVariable(
        missionRunId: number,
        path: string,
        value: any
    ): Promise<{ success: boolean; error?: string }> {
        const session = debugSessions.get(missionRunId);
        if (!session) {
            return { success: false, error: 'No debug session found' };
        }

        if (session.status !== 'paused') {
            return { success: false, error: 'Can only modify during pause' };
        }

        try {
            // Update the paused snapshot
            if (session.pausedAt) {
                this.setNestedValue(session.pausedAt.blackboardSnapshot, path, value);
            }

            session.history.push({
                timestamp: new Date(),
                action: 'modify',
                details: { path, value },
            });

            await eventStream.publish('mission.debug_variable_modified', {
                missionRunId,
                path,
                correlationId: session.correlationId,
            }, {
                correlationId: session.correlationId,
                subject: `mission-run:${missionRunId}`,
            }, 'mission-debug');

            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },

    /**
     * End debug session
     */
    async terminateDebugSession(missionRunId: number): Promise<boolean> {
        const session = debugSessions.get(missionRunId);
        if (!session) return false;

        session.status = 'terminated';
        
        await eventStream.publish('mission.debug_session_ended', {
            missionRunId,
            duration: Date.now() - session.startTime.getTime(),
            correlationId: session.correlationId,
        }, {
            correlationId: session.correlationId,
            subject: `mission-run:${missionRunId}`,
        }, 'mission-debug');

        debugSessions.delete(missionRunId);
        return true;
    },

    /**
     * Get all active debug sessions
     */
    getActiveSessions(): DebugSession[] {
        return Array.from(debugSessions.values()).filter(s => s.status !== 'terminated');
    },

    // Helper methods
    createPausePoint(
        type: DebugPausePoint['type'],
        context: {
            phase?: string;
            toolName?: string;
            blackboard: Record<string, any>;
            cycleCount: number;
        },
        breakpointId?: string
    ): DebugPausePoint {
        return {
            type,
            timestamp: new Date(),
            phase: context.phase,
            toolName: context.toolName,
            blackboardSnapshot: JSON.parse(JSON.stringify(context.blackboard)), // Deep clone
            cycleCount: context.cycleCount,
            nextAction: context.toolName ? `tool:${context.toolName}` : 'continue',
            callStack: breakpointId ? [`breakpoint:${breakpointId}`] : ['step'],
        };
    },

    matchesBreakpoint(bp: Breakpoint, context: {
        phase?: string;
        toolName?: string;
        blackboard: Record<string, any>;
    }): boolean {
        switch (bp.type) {
            case 'tool_call':
                return context.toolName === bp.target;
            case 'phase_change':
                return context.phase === bp.target;
            case 'blackboard_update':
                // Check if specific key was updated
                return bp.target ? context.blackboard[bp.target] !== undefined : true;
            case 'condition':
                // Simple condition evaluation (could be enhanced)
                return this.evaluateCondition(bp.condition, context);
            default:
                return false;
        }
    },

    evaluateCondition(condition: string | undefined, context: Record<string, any>): boolean {
        if (!condition) return true;
        
        // Simple condition evaluator - can be enhanced with proper expression parser
        try {
            // Only allow simple property checks for security
            const allowedPattern = /^[a-zA-Z_][a-zA-Z0-9_]*\s*(==|!=|===|!==)\s*.+$/;
            if (!allowedPattern.test(condition)) return false;
            
            // Very basic evaluation - in production use a proper expression evaluator
            const parts = condition.split(/\s*(==|!=|===|!==)\s*/);
            if (parts.length !== 3) return false;
            
            const [left, operator, right] = parts;
            const leftValue = this.getNestedValue(context, left);
            const rightValue = JSON.parse(right); // Assume JSON value
            
            switch (operator) {
                case '==': return leftValue == rightValue;
                case '!=': return leftValue != rightValue;
                case '===': return leftValue === rightValue;
                case '!==': return leftValue !== rightValue;
                default: return false;
            }
        } catch {
            return false;
        }
    },

    getNestedValue(obj: Record<string, any>, path: string): any {
        return path.split('.').reduce((o, p) => o?.[p], obj);
    },

    setNestedValue(obj: Record<string, any>, path: string, value: any): void {
        const parts = path.split('.');
        const last = parts.pop()!;
        const target = parts.reduce((o, p) => {
            if (!o[p]) o[p] = {};
            return o[p];
        }, obj);
        target[last] = value;
    },
};
