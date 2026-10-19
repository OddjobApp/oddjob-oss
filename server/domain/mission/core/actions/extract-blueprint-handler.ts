import { ActionHandler, ActionContext, ExtractBlueprintDecision } from "./action-handler.js";
import { createLogger } from "@server/utils/logger.js";
import { missionService } from "../mission.service.js";
import { decisionRouter } from "../../../governor/core/decision-router.js";

const logger = createLogger("ExtractBlueprintHandler");

export class ExtractBlueprintHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: ExtractBlueprintDecision): Promise<void> {
        const { missionRunId, missionId, userId, orgId, appendTrace } = ctx;

        const appSlugToPromote = decision.action_details?.app_slug;
        const newBlueprintName = decision.action_details?.blueprint_name;
        const rationale = decision.thought_process || "Extracted from successful mission flow.";

        if (!appSlugToPromote || !newBlueprintName) {
            throw new Error("Missing 'app_slug' or 'blueprint_name' for EXTRACT_BLUEPRINT action.");
        }

        logger.info(`[ExtractBlueprintHandler] Run ${missionRunId} proposing blueprint extraction for: ${appSlugToPromote}`);

        // 1. Request HIL Approval for Extraction (Corporate Governance)
        const extractionProposal = await decisionRouter.requestDecision({
            sessionId: `extract-${appSlugToPromote}`,
            executionId: String(missionRunId),
            tool: "EXTRACT_BLUEPRINT",
            params: { appSlug: appSlugToPromote, newBlueprintName },
            goal: `Promote '${appSlugToPromote}' to a global corporate blueprint named '${newBlueprintName}'.`,
            description: rationale,
            riskLevel: "low", // Non-destructive, but permanent registry addition
            approverType: "internal",
            approverId: userId,
            channels: ["inbox", "copilot"],
            noWait: true, // Non-blocking governance proposal
        });

        if (extractionProposal.approved) {
            const { blueprintExtractionService } = await import("../../../apps/core/blueprint-extraction.service.js");
            
            const extractionResult = await blueprintExtractionService.extractToBlueprint({
                appSlug: appSlugToPromote,
                newBlueprintSlug: newBlueprintName.toLowerCase().replace(/\s+/g, '-'),
                newName: newBlueprintName,
                description: rationale,
                missionRunId: missionRunId,
                organizationId: orgId || undefined
            });

            await appendTrace(missionRunId, { 
                type: "system", 
                event: "blueprint_extracted", 
                note: `APP PROMOTED TO BLUEPRINT: '${newBlueprintName}' (Slug: ${extractionResult.blueprintSlug})`, 
                timestamp: new Date().toISOString() 
            });

            // Record in blackboard
            await missionService.updateBlackboard(missionId, {
                [`extracted_blueprint_${extractionResult.blueprintSlug}`]: "available"
            }, "agent:orchestrator", "extraction_success");
        } else {
            await appendTrace(missionRunId, { 
                type: "system", 
                event: "extraction_rejected", 
                note: `User rejected the blueprint extraction proposal for '${newBlueprintName}'.`, 
                timestamp: new Date().toISOString() 
            });
        }
    }
}
