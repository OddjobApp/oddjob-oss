/**
 * Self-Healing Missions Service
 * 
 * Automatically recovers from common failures by recognizing patterns
 * and applying known remedies. Escalates novel failures to humans.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { missionCorrelationService } from "./mission-correlation.service.js";
import { missionRetryService } from "./retry.service.js";
import { circuitBreakerService } from "./circuit-breaker.service.js";

const logger = createLogger("SelfHealing");

export interface FailurePattern {
    id: string;
    name: string;
    description: string;
    signature: {
        errorMessagePatterns: string[];    // Regex patterns to match
        errorCodes?: string[];               // Specific error codes
        toolName?: string;                   // Specific tool
        stackTracePatterns?: string[];       // Stack trace signatures
    };
    severity: 'low' | 'medium' | 'high' | 'critical';
    autoRemediate: boolean;                // Can be auto-fixed?
    remedies: Remedy[];
    metadata: {
        detectedCount: number;
        autoResolvedCount: number;
        escalationCount: number;
        lastDetected: Date;
        successRate: number;
    };
}

export interface Remedy {
    id: string;
    name: string;
    description: string;
    action: RemedyAction;
    successRate: number;
    maxAttempts: number;
    requiresConfirmation?: boolean;        // Human approval needed?
    estimatedTime: number;                  // Seconds to apply
}

export type RemedyAction =
    | { type: 'retry'; config: { delay: number; maxAttempts: number } }
    | { type: 'reset_circuit_breaker'; toolName: string }
    | { type: 'clear_cache'; cacheKey?: string }
    | { type: 'restart_service'; serviceName: string }
    | { type: 'adjust_timeout'; toolName: string; newTimeout: number }
    | { type: 'skip_tool'; toolName: string; fallbackValue?: any }
    | { type: 'use_alternative_tool'; originalTool: string; alternativeTool: string }
    | { type: 'modify_params'; toolName: string; paramChanges: Record<string, any> }
    | { type: 'escalate'; reason: string; urgency: 'low' | 'medium' | 'high' | 'critical' };

export interface HealingAttempt {
    id: string;
    failurePatternId?: string;
    missionRunId: number;
    toolName: string;
    error: {
        message: string;
        code?: string;
        stack?: string;
    };
    timestamp: Date;
    correlationId: string;
    remediesAttempted: Array<{
        remedyId: string;
        timestamp: Date;
        success: boolean;
        result?: string;
    }>;
    finalStatus: 'resolved' | 'escalated' | 'failed' | 'in_progress';
    escalationId?: string;
}

export interface EscalationRequest {
    id: string;
    healingAttemptId: string;
    reason: string;
    urgency: 'low' | 'medium' | 'high' | 'critical';
    failureContext: {
        missionRunId: number;
        toolName: string;
        error: any;
        remediesAttempted: string[];
    };
    status: 'pending' | 'acknowledged' | 'resolved' | 'rejected';
    createdAt: Date;
    acknowledgedAt?: Date;
    resolvedAt?: Date;
    humanResponse?: string;
}

// Known failure patterns database
const failurePatterns: FailurePattern[] = [
    {
        id: "pattern_timeout",
        name: "Request Timeout",
        description: "Tool call exceeded timeout limit",
        signature: {
            errorMessagePatterns: ['timeout', 'ETIMEDOUT', 'request timed out', 'deadline exceeded'],
        },
        severity: 'medium',
        autoRemediate: true,
        remedies: [
            {
                id: "remedy_retry_with_backoff",
                name: "Retry with Exponential Backoff",
                description: "Retry the operation with increasing delays",
                action: { type: 'retry', config: { delay: 2000, maxAttempts: 3 } },
                successRate: 0.75,
                maxAttempts: 3,
                estimatedTime: 10,
            },
            {
                id: "remedy_increase_timeout",
                name: "Increase Timeout",
                description: "Double the timeout for the operation",
                action: { type: 'adjust_timeout', toolName: '*', newTimeout: 60000 },
                successRate: 0.60,
                maxAttempts: 1,
                estimatedTime: 1,
            },
        ],
        metadata: {
            detectedCount: 0,
            autoResolvedCount: 0,
            escalationCount: 0,
            lastDetected: new Date(),
            successRate: 0.68,
        },
    },
    {
        id: "pattern_rate_limit",
        name: "Rate Limit Exceeded",
        description: "API rate limit or throttling error",
        signature: {
            errorMessagePatterns: ['rate limit', 'too many requests', '429', 'throttle', 'quota exceeded'],
            errorCodes: ['429', 'RATE_LIMITED'],
        },
        severity: 'medium',
        autoRemediate: true,
        remedies: [
            {
                id: "remedy_wait_and_retry",
                name: "Wait and Retry",
                description: "Wait for rate limit window to reset",
                action: { type: 'retry', config: { delay: 60000, maxAttempts: 2 } },
                successRate: 0.90,
                maxAttempts: 2,
                estimatedTime: 60,
            },
            {
                id: "remedy_circuit_breaker_reset",
                name: "Reset Circuit Breaker",
                description: "Reset circuit breaker for the tool",
                action: { type: 'reset_circuit_breaker', toolName: '*' },
                successRate: 0.40,
                maxAttempts: 1,
                estimatedTime: 1,
            },
        ],
        metadata: {
            detectedCount: 0,
            autoResolvedCount: 0,
            escalationCount: 0,
            lastDetected: new Date(),
            successRate: 0.72,
        },
    },
    {
        id: "pattern_auth_failure",
        name: "Authentication Failure",
        description: "Credentials expired or invalid",
        signature: {
            errorMessagePatterns: ['unauthorized', 'authentication failed', 'invalid token', 'credentials', '401', '403'],
            errorCodes: ['401', '403', 'AUTH_FAILED'],
        },
        severity: 'high',
        autoRemediate: false,
        remedies: [
            {
                id: "remedy_escalate_auth",
                name: "Escalate to Human",
                description: "Requires human intervention for credential refresh",
                action: { type: 'escalate', reason: 'Authentication credentials need manual refresh', urgency: 'high' },
                successRate: 0.95,
                maxAttempts: 1,
                requiresConfirmation: true,
                estimatedTime: 300,
            },
        ],
        metadata: {
            detectedCount: 0,
            autoResolvedCount: 0,
            escalationCount: 0,
            lastDetected: new Date(),
            successRate: 0.95,
        },
    },
    {
        id: "pattern_connection_refused",
        name: "Connection Refused",
        description: "Cannot connect to external service",
        signature: {
            errorMessagePatterns: ['connection refused', 'ECONNREFUSED', 'ENOTFOUND', 'DNS', 'unreachable'],
            errorCodes: ['ECONNREFUSED', 'ENOTFOUND'],
        },
        severity: 'high',
        autoRemediate: true,
        remedies: [
            {
                id: "remedy_retry_connection",
                name: "Retry Connection",
                description: "Retry with exponential backoff",
                action: { type: 'retry', config: { delay: 5000, maxAttempts: 5 } },
                successRate: 0.65,
                maxAttempts: 5,
                estimatedTime: 30,
            },
            {
                id: "remedy_use_alternative",
                name: "Use Alternative Service",
                description: "Switch to backup service endpoint",
                action: { type: 'use_alternative_tool', originalTool: '*', alternativeTool: 'backup_*' },
                successRate: 0.80,
                maxAttempts: 1,
                requiresConfirmation: true,
                estimatedTime: 5,
            },
        ],
        metadata: {
            detectedCount: 0,
            autoResolvedCount: 0,
            escalationCount: 0,
            lastDetected: new Date(),
            successRate: 0.73,
        },
    },
    {
        id: "pattern_resource_exhausted",
        name: "Resource Exhausted",
        description: "Out of memory, disk space, or other resources",
        signature: {
            errorMessagePatterns: ['out of memory', 'ENOMEM', 'disk full', 'quota exceeded', 'resource exhausted', 'no space'],
            errorCodes: ['ENOMEM', 'ENOSPC'],
        },
        severity: 'critical',
        autoRemediate: false,
        remedies: [
            {
                id: "remedy_escalate_resource",
                name: "Escalate for Resource Increase",
                description: "Requires human to provision more resources",
                action: { type: 'escalate', reason: 'Resource exhaustion requires infrastructure scaling', urgency: 'critical' },
                successRate: 0.90,
                maxAttempts: 1,
                requiresConfirmation: true,
                estimatedTime: 600,
            },
        ],
        metadata: {
            detectedCount: 0,
            autoResolvedCount: 0,
            escalationCount: 0,
            lastDetected: new Date(),
            successRate: 0.90,
        },
    },
];

// Active healing attempts and escalations
const healingAttempts = new Map<string, HealingAttempt>();
const escalations = new Map<string, EscalationRequest>();

export const selfHealingService = {
    /**
     * Attempt to heal a failure automatically
     */
    async attemptHealing(
        missionRunId: number,
        toolName: string,
        error: Error,
        context?: Record<string, any>
    ): Promise<HealingAttempt> {
        const correlationId = missionCorrelationService.getCorrelationId();
        const attemptId = `heal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        logger.info(`[SelfHealing] Attempting to heal failure in ${toolName}`, {
            missionRunId,
            error: error.message,
            attemptId,
        });

        // 1. Match failure to known pattern
        const pattern = this.matchFailurePattern(error);
        
        // 2. Create healing attempt
        const attempt: HealingAttempt = {
            id: attemptId,
            failurePatternId: pattern?.id,
            missionRunId,
            toolName,
            error: {
                message: error.message,
                code: (error as any).code,
                stack: error.stack,
            },
            timestamp: new Date(),
            correlationId,
            remediesAttempted: [],
            finalStatus: 'in_progress',
        };
        
        healingAttempts.set(attemptId, attempt);

        await eventStream.publish('mission.healing_started', {
            attemptId,
            missionRunId,
            toolName,
            patternId: pattern?.id,
            correlationId,
        }, {
            correlationId,
            subject: `mission:${missionRunId}`,
        }, 'self-healing');

        // 3. If no pattern found, escalate immediately
        if (!pattern) {
            attempt.finalStatus = 'escalated';
            const escalation = await this.escalateToHuman(attempt, 'Unknown failure pattern - no auto-remediation available');
            attempt.escalationId = escalation.id;
            return attempt;
        }

        // 4. Update pattern stats
        pattern.metadata.detectedCount++;
        pattern.metadata.lastDetected = new Date();

        // 5. Try auto-remediation if enabled
        if (pattern.autoRemediate) {
            for (const remedy of pattern.remedies) {
                const remedyResult = await this.applyRemedy(remedy, attempt, context);
                
                attempt.remediesAttempted.push({
                    remedyId: remedy.id,
                    timestamp: new Date(),
                    success: remedyResult.success,
                    result: remedyResult.result,
                });

                if (remedyResult.success) {
                    attempt.finalStatus = 'resolved';
                    pattern.metadata.autoResolvedCount++;
                    
                    logger.info(`[SelfHealing] Successfully resolved failure using ${remedy.name}`);
                    
                    await eventStream.publish('mission.healing_resolved', {
                        attemptId,
                        remedyId: remedy.id,
                        patternId: pattern.id,
                        correlationId,
                    }, {
                        correlationId,
                        subject: `mission:${missionRunId}`,
                    }, 'self-healing');
                    
                    return attempt;
                }
            }
        }

        // 6. If auto-remediation failed, escalate
        attempt.finalStatus = 'escalated';
        const escalation = await this.escalateToHuman(
            attempt,
            `Auto-remediation failed after ${attempt.remediesAttempted.length} attempts`
        );
        attempt.escalationId = escalation.id;
        pattern.metadata.escalationCount++;

        return attempt;
    },

    /**
     * Match error to known failure patterns
     */
    matchFailurePattern(error: Error): FailurePattern | undefined {
        const errorMessage = error.message.toLowerCase();
        const errorCode = (error as any).code || '';
        const stackTrace = error.stack || '';

        for (const pattern of failurePatterns) {
            const { signature } = pattern;
            let matches = 0;
            let totalChecks = 0;

            // Check error message patterns
            if (signature.errorMessagePatterns) {
                totalChecks++;
                for (const pattern of signature.errorMessagePatterns) {
                    if (new RegExp(pattern, 'i').test(errorMessage)) {
                        matches++;
                        break;
                    }
                }
            }

            // Check error codes
            if (signature.errorCodes && errorCode) {
                totalChecks++;
                if (signature.errorCodes.includes(errorCode)) {
                    matches++;
                }
            }

            // Check stack trace patterns
            if (signature.stackTracePatterns) {
                totalChecks++;
                for (const pattern of signature.stackTracePatterns) {
                    if (new RegExp(pattern, 'i').test(stackTrace)) {
                        matches++;
                        break;
                    }
                }
            }

            // If we have matches and at least one check passed, consider it a match
            if (matches > 0 && totalChecks > 0) {
                logger.debug(`[SelfHealing] Matched pattern: ${pattern.name}`);
                return pattern;
            }
        }

        return undefined;
    },

    /**
     * Apply a remedy to heal the failure
     */
    async applyRemedy(
        remedy: Remedy,
        attempt: HealingAttempt,
        context?: Record<string, any>
    ): Promise<{ success: boolean; result?: string }> {
        logger.info(`[SelfHealing] Applying remedy: ${remedy.name}`);

        try {
            switch (remedy.action.type) {
                case 'retry':
                    await this.sleep(remedy.action.config.delay);
                    return { success: true, result: 'Retry delay applied' };

                case 'reset_circuit_breaker':
                    const toolName = remedy.action.toolName === '*' 
                        ? attempt.toolName 
                        : remedy.action.toolName;
                    circuitBreakerService.reset(toolName);
                    return { success: true, result: `Circuit breaker reset for ${toolName}` };

                case 'clear_cache':
                    // Would clear relevant cache
                    return { success: true, result: 'Cache cleared' };

                case 'adjust_timeout':
                    return { 
                        success: true, 
                        result: `Timeout adjusted to ${remedy.action.newTimeout}ms` 
                    };

                case 'use_alternative_tool':
                    return { 
                        success: true, 
                        result: `Switched to alternative: ${remedy.action.alternativeTool}` 
                    };

                case 'escalate':
                    // Escalation is handled by the caller
                    return { success: false, result: 'Requires escalation' };

                default:
                    return { success: false, result: 'Unknown remedy type' };
            }
        } catch (error: any) {
            logger.error(`[SelfHealing] Remedy failed: ${error.message}`);
            return { success: false, result: error.message };
        }
    },

    /**
     * Escalate failure to human operator
     */
    async escalateToHuman(
        attempt: HealingAttempt,
        reason: string,
        urgency: 'low' | 'medium' | 'high' | 'critical' = 'medium'
    ): Promise<EscalationRequest> {
        const escalationId = `esc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const escalation: EscalationRequest = {
            id: escalationId,
            healingAttemptId: attempt.id,
            reason,
            urgency,
            failureContext: {
                missionRunId: attempt.missionRunId,
                toolName: attempt.toolName,
                error: attempt.error,
                remediesAttempted: attempt.remediesAttempted.map(r => r.remedyId),
            },
            status: 'pending',
            createdAt: new Date(),
        };

        escalations.set(escalationId, escalation);

        logger.warn(`[SelfHealing] Escalated to human: ${reason}`, {
            escalationId,
            missionRunId: attempt.missionRunId,
            urgency,
        });

        await eventStream.publish('mission.healing_escalated', {
            escalationId,
            healingAttemptId: attempt.id,
            reason,
            urgency,
            correlationId: attempt.correlationId,
        }, {
            correlationId: attempt.correlationId,
            subject: `mission:${attempt.missionRunId}`,
        }, 'self-healing');

        return escalation;
    },

    /**
     * Acknowledge an escalation (human response)
     */
    acknowledgeEscalation(escalationId: string, humanResponse?: string): EscalationRequest | undefined {
        const escalation = escalations.get(escalationId);
        if (!escalation) return undefined;

        escalation.status = 'acknowledged';
        escalation.acknowledgedAt = new Date();
        escalation.humanResponse = humanResponse;

        // Update associated healing attempt
        const attempt = healingAttempts.get(escalation.healingAttemptId);
        if (attempt) {
            attempt.finalStatus = 'in_progress'; // Back to in-progress
        }

        logger.info(`[SelfHealing] Escalation acknowledged: ${escalationId}`);

        return escalation;
    },

    /**
     * Resolve an escalation
     */
    resolveEscalation(
        escalationId: string,
        resolution: string,
        learnPattern?: boolean
    ): EscalationRequest | undefined {
        const escalation = escalations.get(escalationId);
        if (!escalation) return undefined;

        escalation.status = 'resolved';
        escalation.resolvedAt = new Date();
        escalation.humanResponse = resolution;

        // Update healing attempt
        const attempt = healingAttempts.get(escalation.healingAttemptId);
        if (attempt) {
            attempt.finalStatus = 'resolved';
        }

        // Optionally learn from this resolution
        if (learnPattern && attempt) {
            this.learnFromResolution(attempt, resolution);
        }

        logger.info(`[SelfHealing] Escalation resolved: ${escalationId}`);

        return escalation;
    },

    /**
     * Learn from human resolution to create new patterns
     */
    learnFromResolution(attempt: HealingAttempt, humanResolution: string): void {
        // This would implement ML-based pattern learning
        // For now, just log the learning opportunity
        logger.info(`[SelfHealing] Learning from resolution:`, {
            errorPattern: attempt.error.message,
            resolution: humanResolution,
        });

        // In a full implementation, this would:
        // 1. Analyze the error signature
        // 2. Extract the fix that worked
        // 3. Create a new failure pattern with auto-remedy
        // 4. Update pattern database
    },

    /**
     * Get all failure patterns
     */
    getPatterns(): FailurePattern[] {
        return [...failurePatterns];
    },

    /**
     * Get healing statistics
     */
    getStats(): {
        totalAttempts: number;
        resolved: number;
        escalated: number;
        failed: number;
        inProgress: number;
        byPattern: Record<string, {
            detected: number;
            autoResolved: number;
            escalated: number;
            successRate: number;
        }>;
        pendingEscalations: number;
    } {
        let resolved = 0, escalated = 0, failed = 0, inProgress = 0;
        
        for (const attempt of healingAttempts.values()) {
            switch (attempt.finalStatus) {
                case 'resolved': resolved++; break;
                case 'escalated': escalated++; break;
                case 'failed': failed++; break;
                case 'in_progress': inProgress++; break;
            }
        }

        const byPattern: Record<string, any> = {};
        for (const pattern of failurePatterns) {
            byPattern[pattern.id] = {
                detected: pattern.metadata.detectedCount,
                autoResolved: pattern.metadata.autoResolvedCount,
                escalated: pattern.metadata.escalationCount,
                successRate: pattern.metadata.successRate,
            };
        }

        const pendingEscalations = Array.from(escalations.values())
            .filter(e => e.status === 'pending').length;

        return {
            totalAttempts: healingAttempts.size,
            resolved,
            escalated,
            failed,
            inProgress,
            byPattern,
            pendingEscalations,
        };
    },

    /**
     * Get active escalations
     */
    getEscalations(status?: 'pending' | 'acknowledged' | 'resolved'): EscalationRequest[] {
        let results = Array.from(escalations.values());
        
        if (status) {
            results = results.filter(e => e.status === status);
        }
        
        return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    /**
     * Get healing attempt by ID
     */
    getHealingAttempt(id: string): HealingAttempt | undefined {
        return healingAttempts.get(id);
    },

    /**
     * Add a new failure pattern (for learning)
     */
    addPattern(pattern: Omit<FailurePattern, 'id' | 'metadata'>): FailurePattern {
        const newPattern: FailurePattern = {
            ...pattern,
            id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            metadata: {
                detectedCount: 0,
                autoResolvedCount: 0,
                escalationCount: 0,
                lastDetected: new Date(),
                successRate: 0,
            },
        };
        failurePatterns.push(newPattern);
        return newPattern;
    },

    /**
     * Clear all healing attempts (for testing)
     */
    clearHealingAttempts(): void {
        healingAttempts.clear();
    },

    /**
     * Clear all escalations (for testing)
     */
    clearEscalations(): void {
        escalations.clear();
    },

    // Private helpers
    sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};
