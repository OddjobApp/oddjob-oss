import { createLogger } from "@server/utils/logger.js";
import {
    adversarialConsensusService,
    type AttestationToken,
} from "./core/adversarial-consensus.service.js";

const logger = createLogger("CopilotGovernanceGuard");

export type RestrictableAction =
    | "deploy_production"
    | "promote_candidate"
    | "rollback_production"
    | "override_guardrail"
    | "mutate_production_db"
    | "scaffold_feature_pack";

export interface CopilotGovernanceContext {
    userRoles: string[];
    hasExplicitApproval?: boolean;
    evidenceProvided?: boolean;
    evidenceSource?: string;
    attestationToken?: AttestationToken;
    payload?: Record<string, any>;
    requireAttestation?: boolean;
}

export interface GovernanceValidationResult {
    allowed: boolean;
    reason?: string;
    requiresRole?: string[];
}

/**
 * Enforces Rule 2 & Rule 3 of the Copilot Operating Contract:
 * Role-gated approval boundaries for high-risk actions & zero hallucinated evidence.
 */
export class CopilotGovernanceGuard {
    private static readonly PRIVILEGED_ROLES = ["operations-supervisor", "application-owner", "admin"];

    /**
     * Checks whether an action is restricted and requires supervisor approval.
     */
    public static validateAction(
        action: RestrictableAction,
        context: CopilotGovernanceContext
    ): GovernanceValidationResult {
        const hasPrivilegedRole = context.userRoles.some(role =>
            CopilotGovernanceGuard.PRIVILEGED_ROLES.includes(role.toLowerCase())
        );

        if (!hasPrivilegedRole && !context.hasExplicitApproval) {
            logger.warn(`[CopilotGovernanceGuard] Action '${action}' rejected for roles: ${context.userRoles.join(", ")}`);
            return {
                allowed: false,
                reason: `Action '${action}' requires explicit approval from an operations-supervisor or application-owner.`,
                requiresRole: ["operations-supervisor", "application-owner"]
            };
        }

        if (!context.evidenceProvided) {
            logger.warn(`[CopilotGovernanceGuard] Action '${action}' rejected due to missing evidence.`);
            return {
                allowed: false,
                reason: `Zero Hallucinated Evidence Rule: Action '${action}' cannot proceed without verified evidence in the graph or tool output.`
            };
        }

        // Rule 4: Multi-Agent Adversarial Attestation Check
        if (context.attestationToken || context.requireAttestation) {
            if (!context.attestationToken) {
                logger.warn(`[CopilotGovernanceGuard] Action '${action}' rejected due to missing cryptographic attestation token.`);
                return {
                    allowed: false,
                    reason: `Action '${action}' requires a valid cryptographic AttestationToken from tripartite adversarial consensus.`
                };
            }

            const verification = adversarialConsensusService.verifyAttestationToken(
                context.attestationToken,
                action,
                context.payload
            );

            if (!verification.valid) {
                logger.warn(`[CopilotGovernanceGuard] Action '${action}' attestation verification failed: ${verification.reason}`);
                return {
                    allowed: false,
                    reason: `Attestation verification failed: ${verification.reason}`
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Helper to test if any text input attempts a restricted side effect.
     */
    public static detectRestrictedAction(intent: string): RestrictableAction | null {
        const lower = intent.toLowerCase();
        if (/\b(deploy|release)\b.*(prod|production)/i.test(lower)) return "deploy_production";
        if (/\bpromote\b.*(candidate|agent|model)/i.test(lower)) return "promote_candidate";
        if (/\brollback\b.*(prod|production|deployment)/i.test(lower)) return "rollback_production";
        if (/\boverride\b.*(guardrail|blocking|policy)/i.test(lower)) return "override_guardrail";
        if (/\b(delete|drop|truncate|mutate)\b.*(prod|production|db|database)/i.test(lower)) return "mutate_production_db";
        return null;
    }
}
