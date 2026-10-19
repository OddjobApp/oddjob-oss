import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { observabilityPod } from "../observability/observability-pod.service.js";
import {
    governanceDecisions as decisionsTable,
    governanceAuditLogs as auditLogsTable,
} from "@shared/schema/prediction/governance.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import type { DomainContext } from "../quant/types.js";
import type {
    GovernancePort,
    GovernanceDecision,
    GovernanceEvaluationInput,
    PolicyEvaluationInput,
    ActionAuthorizationInput,
    MemoryGovernanceInput,
    AgentGovernanceInput,
    RiskClassificationInput,
    RiskClassificationResult,
    GovernanceSimulationInput,
    GovernanceSimulationResult,
    GovernanceSubject,
    GovernanceAction,
    GovernanceResource,
    GovernanceDecisionType,
    ActionAuthorityLevel,
    RiskClass,
} from "./types.js";
import { CURRENT_POLICY_VERSION, RISK_CLASS_RANK } from "./types.js";
import { tenantIsolationPlugin } from "./plugins/tenant-isolation.plugin.js";
import { sensitivityEnforcementPlugin } from "./plugins/sensitivity-enforcement.plugin.js";
import { riskClassificationPlugin } from "./plugins/risk-classification.plugin.js";
import { confidenceGatingPlugin } from "./plugins/confidence-gating.plugin.js";
import { actionAuthorizationPlugin } from "./plugins/action-authorization.plugin.js";
import { policyEnginePlugin } from "./plugins/policy-engine.plugin.js";
import { clamp, minAuthority } from "./plugins/plugin-helpers.js";

const logger = createLogger("GovernancePod");

function makeCtx(domainCtx: DomainContext, contextId: string) {
    return createPluginContext({
        contextId, mode: domainCtx.mode,
        requestId: domainCtx.requestId, correlationId: domainCtx.correlationId,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false },
    });
}

async function persistDecision(decision: GovernanceDecision): Promise<void> {
    try {
        await db.insert(decisionsTable).values({
            id: decision.id,
            contextId: decision.contextId as unknown as string,
            subjectId: decision.subjectId ?? null,
            decision: decision.decision,
            allowed: decision.allowed,
            maxActionLevel: decision.maxActionLevel,
            riskClass: decision.riskClass,
            requiresHumanConfirmation: decision.requiresHumanConfirmation,
            requiresExplanation: decision.requiresExplanation,
            requiresAudit: decision.requiresAudit,
            confidenceThreshold: decision.confidenceThreshold ?? null,
            confidenceAdjustment: decision.confidenceAdjustment ?? null,
            redactions: decision.redactions as any,
            constraints: decision.constraints as any,
            policyTrace: decision.policyTrace as any,
            reason: decision.reason,
            evidenceIds: decision.evidenceIds as unknown as string[],
            policyVersion: decision.policyVersion,
            createdAt: new Date(decision.createdAt),
            payload: {},
        }).onConflictDoNothing();

        if (decision.requiresAudit) {
            await db.insert(auditLogsTable).values({
                id: randomUUID(),
                decisionId: decision.id as unknown as string,
                contextId: decision.contextId as unknown as string,
                subjectId: decision.subjectId ?? null,
                actionType: null,
                resourceType: null,
                decision: decision.decision,
                policyVersion: decision.policyVersion,
                auditPayload: { riskClass: decision.riskClass, maxActionLevel: decision.maxActionLevel, reason: decision.reason } as any,
                createdAt: new Date(decision.createdAt),
            });
        }
    } catch (err) {
        logger.error(`governance decision persistence failed - decisionId: ${decision.id}`, { err: String(err) });
    }
}

function quickDeny(contextId: string, reason: string, now: string): GovernanceDecision {
    return {
        id: randomUUID(), contextId, decision: "deny", allowed: false,
        maxActionLevel: "observe", riskClass: "critical",
        requiresHumanConfirmation: false, requiresExplanation: false, requiresAudit: true,
        redactions: [], constraints: [], policyTrace: [],
        reason, evidenceIds: [], policyVersion: CURRENT_POLICY_VERSION, createdAt: now,
    };
}

// ============================================================================
// GovernancePod
// ============================================================================

class GovernancePod implements GovernancePort {

    async evaluate(input: GovernanceEvaluationInput, ctx: DomainContext): Promise<GovernanceDecision> {
        const contextId = input.context.id;
        const pluginCtx = makeCtx(ctx, contextId);
        const now = ctx.now;

        const requestedLevel: ActionAuthorityLevel = input.requestedActionLevel ?? "suggest";
        const confidence = clamp(input.confidence ?? 0.7);
        const entropy = clamp(input.quantField?.fieldEntropy ?? 0.5);
        const sensitivity = input.resource?.sensitivity;
        const tenantId = input.context.tenantId;
        const epistemicStatus = input.hiddenState?.candidates?.[0]?.type;

        // ── 1. Tenant isolation ─────────────────────────────────────────────
        const tenantResult = await tenantIsolationPlugin.execute({
            contextTenantId: tenantId,
            subjectTenantId: input.subject?.tenantId,
            resourceTenantId: input.resource?.tenantId,
            mode: input.mode,
        }, pluginCtx);

        if (!tenantResult.output?.allowed) {
            const d = quickDeny(contextId, tenantResult.output?.reason ?? "tenant isolation", now);
            persistDecision(d).catch(() => {});
            return d;
        }

        // ── 2. Sensitivity enforcement ──────────────────────────────────────
        const defaultAction: GovernanceAction = input.action ?? { type: "surface_prediction", requestedAuthority: requestedLevel };
        let redactions: GovernanceDecision["redactions"] = [];

        if (sensitivity) {
            const sensResult = await sensitivityEnforcementPlugin.execute({
                sensitivity, action: defaultAction, subject: input.subject, mode: input.mode,
            }, pluginCtx);

            if (!sensResult.output?.allowed) {
                const d = quickDeny(contextId, sensResult.output?.reason ?? "sensitivity denied", now);
                persistDecision(d).catch(() => {});
                return d;
            }
            redactions = sensResult.output?.redactions ?? [];
        }

        // ── 3. Risk classification ──────────────────────────────────────────
        const riskResult = await riskClassificationPlugin.execute({
            contextId,
            requestedActionLevel: requestedLevel,
            confidence,
            entropy,
            sensitivity,
            branches: input.branches,
            hiddenState: input.hiddenState,
            irreversible: false,
        }, pluginCtx);
        const riskClass: RiskClass = riskResult.output?.riskClass ?? "medium";

        // ── 4. Confidence gating ────────────────────────────────────────────
        const gatingResult = await confidenceGatingPlugin.execute({
            confidence, entropy, riskClass,
            requestedActionLevel: requestedLevel,
            epistemicStatus: input.hiddenState?.candidates?.[0]?.type,
        }, pluginCtx);
        const gatedLevel: ActionAuthorityLevel = gatingResult.output?.gatedActionLevel ?? "suggest";

        // ── 5. Policy engine ────────────────────────────────────────────────
        const facts: Record<string, unknown> = {
            crossTenant: tenantResult.output?.crossTenant ?? false,
            sensitivityLevel: sensitivity?.sensitivityLevel ?? "none",
            sensitivityCategories: sensitivity?.categories ?? [],
            riskClass,
            requestedActionLevel: gatedLevel,
            actionType: defaultAction.type,
            subjectTrust: clamp(input.subject?.trustLevel ?? 0.8),
            epistemicStatus: input.hiddenState?.candidates?.[0]?.type ?? "known_known",
            confidence,
            entropy,
        };

        const subject: GovernanceSubject = input.subject ?? {
            id: "system", type: "system", roles: [], permissions: [], trustLevel: 0.8,
        };
        const resource: GovernanceResource = input.resource ?? { type: "prediction" };

        const policyResult = await policyEnginePlugin.execute({
            subject, action: { ...defaultAction, requestedAuthority: gatedLevel },
            resource, context: input.context, facts, mode: input.mode,
        }, pluginCtx);

        const policyDecision = policyResult.output!;

        // ── 6. Action authorization ─────────────────────────────────────────
        const authResult = await actionAuthorizationPlugin.execute({
            contextId,
            requestedActionLevel: gatedLevel,
            riskClass,
            confidence,
            entropy,
            subjectTrustLevel: clamp(input.subject?.trustLevel ?? 0.8),
            contextPermissions: input.context.permissions,
            requiresHuman: policyDecision.requiresHumanConfirmation,
        }, pluginCtx);

        const finalDecision: GovernanceDecision = {
            ...policyDecision,
            maxActionLevel: minAuthority(policyDecision.maxActionLevel, authResult.output?.maxActionLevel ?? "observe"),
            allowed: policyDecision.allowed && (authResult.output?.allowed ?? false),
            requiresHumanConfirmation: policyDecision.requiresHumanConfirmation || (authResult.output?.requiresHumanConfirmation ?? false),
            requiresExplanation: policyDecision.requiresExplanation || RISK_CLASS_RANK[riskClass] >= RISK_CLASS_RANK.medium,
            redactions: [...redactions, ...policyDecision.redactions],
            reason: `${policyDecision.reason}; auth: ${authResult.output?.reason ?? "ok"}`,
        };

        persistDecision(finalDecision).catch(() => {});
        observabilityPod.emit({
            type: "governance_decision",
            contextId: input.context.id,
            severity: finalDecision.allowed ? "info" : "warning",
            source: "governance_pod",
            payload: {
                allowed: finalDecision.allowed,
                maxActionLevel: finalDecision.maxActionLevel,
                requiresHumanConfirmation: finalDecision.requiresHumanConfirmation,
                riskClass,
                reason: finalDecision.reason,
            },
        }, ctx).catch(() => {});
        return finalDecision;
    }

    async evaluatePolicy(input: PolicyEvaluationInput, ctx: DomainContext): Promise<GovernanceDecision> {
        const pluginCtx = makeCtx(ctx, input.context.id);
        const result = await policyEnginePlugin.execute(input, pluginCtx);
        const d = result.output!;
        persistDecision(d).catch(() => {});
        return d;
    }

    async authorizeAction(input: ActionAuthorizationInput, ctx: DomainContext): Promise<GovernanceDecision> {
        const pluginCtx = makeCtx(ctx, input.contextId);

        const riskResult = await riskClassificationPlugin.execute({
            contextId: input.contextId,
            requestedActionLevel: input.requestedActionLevel,
            confidence: input.confidence,
            entropy: input.entropy,
            irreversible: false,
        }, pluginCtx);
        const riskClass = riskResult.output?.riskClass ?? "medium";

        const authResult = await actionAuthorizationPlugin.execute({ ...input, riskClass }, pluginCtx);
        const auth = authResult.output!;

        const d: GovernanceDecision = {
            id: randomUUID(), contextId: input.contextId,
            decision: auth.decision, allowed: auth.allowed,
            maxActionLevel: auth.maxActionLevel, riskClass,
            requiresHumanConfirmation: auth.requiresHumanConfirmation,
            requiresExplanation: RISK_CLASS_RANK[riskClass] >= RISK_CLASS_RANK.medium,
            requiresAudit: true, redactions: [], constraints: [], policyTrace: [],
            reason: auth.reason, evidenceIds: [], policyVersion: CURRENT_POLICY_VERSION, createdAt: ctx.now,
        };
        persistDecision(d).catch(() => {});
        return d;
    }

    async governMemory(input: MemoryGovernanceInput, ctx: DomainContext): Promise<GovernanceDecision> {
        const pluginCtx = makeCtx(ctx, input.contextId);
        const sensitivityLevel = input.sensitivity?.sensitivityLevel ?? "none";
        const allowed = sensitivityLevel !== "restricted" || input.requestType !== "recall";
        const decision: GovernanceDecisionType = allowed ? "allow" : "deny";
        const d: GovernanceDecision = {
            id: randomUUID(), contextId: input.contextId,
            decision, allowed, maxActionLevel: allowed ? "notify" : "observe",
            riskClass: allowed ? "low" : "high",
            requiresHumanConfirmation: false, requiresExplanation: !allowed, requiresAudit: !allowed,
            redactions: [], constraints: [], policyTrace: [],
            reason: allowed ? "memory access allowed" : `memory ${input.requestType} denied: restricted sensitivity`,
            evidenceIds: [], policyVersion: CURRENT_POLICY_VERSION, createdAt: ctx.now,
        };
        if (!allowed) persistDecision(d).catch(() => {});
        return d;
    }

    async governAgentCall(input: AgentGovernanceInput, ctx: DomainContext): Promise<GovernanceDecision> {
        const sensitivityLevel = input.sensitivity?.sensitivityLevel ?? "none";
        const allowed = sensitivityLevel !== "restricted" && sensitivityLevel !== "high";
        const d: GovernanceDecision = {
            id: randomUUID(), contextId: input.contextId,
            decision: allowed ? "allow" : "deny", allowed,
            maxActionLevel: allowed ? "automate_low_risk" : "observe",
            riskClass: allowed ? "low" : "critical",
            requiresHumanConfirmation: false, requiresExplanation: !allowed, requiresAudit: true,
            redactions: [], constraints: [], policyTrace: [],
            reason: allowed ? `agent '${input.agentId}' call authorized` : `agent call denied: ${sensitivityLevel} sensitive data`,
            evidenceIds: [], policyVersion: CURRENT_POLICY_VERSION, createdAt: ctx.now,
        };
        persistDecision(d).catch(() => {});
        return d;
    }

    async classifyRisk(input: RiskClassificationInput, ctx: DomainContext): Promise<RiskClassificationResult> {
        const pluginCtx = makeCtx(ctx, input.contextId);
        const result = await riskClassificationPlugin.execute(input, pluginCtx);
        return result.output ?? { riskClass: "medium", score: 0.5, factors: [], explanation: "default risk" };
    }

    async simulate(_input: GovernanceSimulationInput, ctx: DomainContext): Promise<GovernanceSimulationResult> {
        // Deferred per MVP scope (spec §50)
        const stub: GovernanceDecision = {
            id: randomUUID(), contextId: _input.contextId ?? "sim",
            decision: "allow", allowed: true, maxActionLevel: "suggest", riskClass: "low",
            requiresHumanConfirmation: false, requiresExplanation: false, requiresAudit: false,
            redactions: [], constraints: [], policyTrace: [],
            reason: "simulation deferred in MVP", evidenceIds: [],
            policyVersion: _input.policyVersion, createdAt: ctx.now,
        };
        return { simulatedDecision: stub, differs: false, differences: [] };
    }
}

export const governancePod = new GovernancePod();
export type { GovernancePod };
