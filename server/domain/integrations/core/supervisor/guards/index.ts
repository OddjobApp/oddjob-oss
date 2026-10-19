import { SupervisorPlan } from "@shared/schema/supervisor.js";

export interface GuardContext {
    executionId: number;
    organizationId?: number;
    userId: string;
    governorConfig?: {
        enabled: boolean;
        rules: any[];
    };
}

export interface GuardResult {
    allowed: boolean;
    reason?: string;
    details?: any;
    metadata?: Record<string, any>;
}

/**
 * Interface for all Supervisor execution guards.
 * Guards are executed before each tick of the mission loop.
 */
export interface SupervisorGuard {
    name: string;
    validate(plan: SupervisorPlan, context: GuardContext): Promise<GuardResult>;
}


