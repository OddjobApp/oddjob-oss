import type { OrgContext } from "@server/utils/auth-context.js";

export type GovernanceTier = 'relaxed' | 'standard' | 'strict';

export interface GovernancePolicy {
    tier: GovernanceTier;
    consensusThreshold: number;
    vetoThreshold: number;
    timeoutMs: number;
    weights: Record<string, number>;
}

export class GovernancePolicyService {
    private static DEFAULT_WEIGHTS = {
        'W-1': 0.3, // Strategist
        'W-2': 0.4, // Critic (Veto Power)
        'W-3': 0.1, // Explorer
        'W-4': 0.2  // Auditor
    };

    static getPolicy(tier: GovernanceTier = 'standard'): GovernancePolicy {
        switch (tier) {
            case 'strict':
                return {
                    tier,
                    consensusThreshold: 0.90,
                    vetoThreshold: 0.30, // Much easier to veto
                    timeoutMs: 120000,   // 2 minutes
                    weights: this.DEFAULT_WEIGHTS
                };
            case 'relaxed':
                return {
                    tier,
                    consensusThreshold: 0.50,
                    vetoThreshold: 0.05, // Harder to veto
                    timeoutMs: 30000,    // 30 seconds
                    weights: {
                        'W-1': 0.5,
                        'W-2': 0.2,
                        'W-3': 0.2,
                        'W-4': 0.1
                    }
                };
            case 'standard':
            default:
                return {
                    tier: 'standard',
                    consensusThreshold: 0.75,
                    vetoThreshold: 0.10,
                    timeoutMs: 60000,    // 1 minute
                    weights: this.DEFAULT_WEIGHTS
                };
        }
    }

    /**
     * Resolves the governance tier for a mission run by checking its blackboard context.
     */
    static async resolveTierForRun(missionId: number): Promise<GovernanceTier> {
        try {
            const { missionService } = await import("../../mission/core/mission.service.js");
            const mission = await missionService.getById(missionId);
            const context = (mission?.blackboard as any) || {};
            return context.governanceTier || 'standard';
        } catch (err) {
            return 'standard';
        }
    }

    /**
     * Determines the maximum security classification level an actor can access 
     * based on their role and organizational context.
     * Scale: 1 (Public) to 5 (Top Secret)
     */
    static getSecurityClearance(orgContext: OrgContext): number {
        if (orgContext.isSuperAdmin) return 5;
        if (orgContext.isOrgAdmin) return 4;
        
        switch ((orgContext as any).role) {
            case 'admin': return 4;
            case 'agent': return 3; // Agents can see operational data
            case 'manager': return 3;
            case 'user': return 2;
            case 'system': return 5;
            default: return 1; // Unauthenticated/Basic access defaults to public
        }
    }
}
