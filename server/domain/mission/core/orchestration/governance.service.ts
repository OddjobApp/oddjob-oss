
import { db } from "@server/database_service.js";
import { approvalRequests, missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { decisionRouter } from "../../../governor/core/decision-router.js";
import { approvalService } from "../../../integrations/core/approval.service.js";
import { missionRunService } from "../mission-run.service.js";
import { OrchestrationContext, OrchestrationThought } from "./types.js";
import { MissionGovernanceService } from "../mission-governance.service.js";

const logger = createLogger("OrchestrationGovernance");

export const SAFE_TOOLS = new Set([
    "think_step",
    "google_search",
    "browse_web",
    "update_blackboard",
    "get_blackboard",
    "neural_log_extractor",
    "gms_core_synthesizer",
    "behavioral_resonance_detector"
]);

const SAFE_TOOLS_NORMALIZED = new Set([...SAFE_TOOLS].map(t => t.replace(/[\s_\-]/g, '')));

export const orchestrationGovernanceService = {
    async checkRisk(ctx: OrchestrationContext, thought: OrchestrationThought): Promise<{ needsApproval: boolean; approved?: boolean; reason?: string }> {
        const { missionRunId, missionContext, blackboard, effectiveUserEmail, userId, orgId } = ctx;
        const { action, params } = thought;

        // 1. Safe-tool bypass — exact names only. This used to also match SUBSTRINGS
        // (`includes('logextractor')`), so any action whose name contained one skipped
        // every check below, and a mission merely NAMED "Debug Mission: ..." skipped
        // all governance. The mission name is user-supplied and nothing in the
        // codebase produces that prefix, so the bypass is gone.
        const actionNormalized = (action || '').toLowerCase().replace(/[\s_\-]/g, '');
        if (SAFE_TOOLS_NORMALIZED.has(actionNormalized)) {
            return { needsApproval: false, approved: true };
        }

        if (missionContext.requireApprovalForAll && action !== 'conclude_mission' && action !== 'fail_mission') {
            return { needsApproval: true };
        }

        // 2. Sentinel Audit (Pillar 5: RLAIF)
        const sentinel = await MissionGovernanceService.sentinelAudit(
            missionRunId, 
            { tool: action, params }, 
            ctx.objective, 
            orgId ?? undefined
        );

        if (!sentinel.approved) {
            logger.warn(`[OrchestrationGovernance] Sentinel REJECTED action: ${sentinel.rationale}`);
            // If Sentinel rejects, we MUST get human approval (Escalation)
            return { needsApproval: true, reason: `Sentinel Audit Failure: ${sentinel.rationale}` };
        }

        // 3. Tool Contract: explicit approval policy or high risk level
        const { AGENT_TOOLS } = await import("../../../tools/v1/tool-registry.service.js");
        const tool = (AGENT_TOOLS as any)[action.toLowerCase()];

        if (tool?.approvalPolicy?.requiresApproval) {
            logger.info(`[OrchestrationGovernance] Tool '${action}' has explicit approvalPolicy.requiresApproval`);
            return { needsApproval: true, reason: tool.approvalPolicy.rationale };
        }

        if (tool?.riskLevel === 'high') {
            logger.info(`[OrchestrationGovernance] High risk tool detected: ${action}`);
            return { needsApproval: true };
        }

        return { needsApproval: false, approved: true };
    },

    async requestApproval(ctx: OrchestrationContext, thought: OrchestrationThought): Promise<{ approved: boolean; reason?: string; modifiedOutput?: any }> {
        const { missionRunId, missionContext, blackboard, effectiveUserEmail, userId, orgId } = ctx;
        const { action, params } = thought;

        logger.info(`Requesting approval for action: ${action} in run ${missionRunId}`);

        const result = await decisionRouter.requestDecision({
            sessionId: `mission-${missionRunId}`,
            executionId: `run-${missionRunId}-${Date.now()}`,
            tool: action,
            params: params,
            goal: missionContext.intent || "Mission task execution",
            riskLevel: "medium", // Default to medium if we're here
            description: thought.reasoning,
            approverType: "internal",
            approverEmail: effectiveUserEmail,
            approverId: userId,
            organizationId: orgId ?? undefined,
            channels: missionContext.rulesOfEngagement?.notificationChannels || ["copilot", "inbox"]
        });

        return {
            approved: result.approved,
            reason: result.reason,
            modifiedOutput: result.modifiedOutput
        };
    }
};
