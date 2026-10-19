import { ActionHandler, ActionContext, ArchiveAssetDecision } from "./action-handler.js";
import { db } from "@server/database_service.js";
import { apps, skills } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { decisionRouter } from "../../../governor/core/decision-router.js";

const logger = createLogger("ArchiveAssetHandler");

export class ArchiveAssetHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: ArchiveAssetDecision): Promise<void> {
        const { missionRunId, userId, orgId, appendTrace } = ctx;

        const assetSlug = decision.action_details?.app_slug;
        const assetType = decision.action_details?.asset_type || "app";
        const archiveRationale = decision.thought_process || "Identified as a low-ROI Zombie asset.";

        if (!assetSlug) {
            throw new Error("Missing 'app_slug' for ARCHIVE_ASSET action.");
        }
        if (!orgId) {
            throw new Error("Missing org context for ARCHIVE_ASSET action.");
        }

        logger.info(`[ArchiveAssetHandler] Run ${missionRunId} proposing asset archive: ${assetSlug} (${assetType})`);

        // 1. Request HIL Approval for Archival (Institutional Governance â€” blocking)
        const archiveProposal = await decisionRouter.requestDecision({
            sessionId: `archive-${assetSlug}`,
            executionId: String(missionRunId),
            tool: "ARCHIVE_ASSET",
            params: { assetSlug, assetType },
            goal: `Decommission the ${assetType} '${assetSlug}' to reduce corporate resource overhead.`,
            description: `RATIONALE: ${archiveRationale}`,
            riskLevel: "medium",
            approverType: "internal",
            approverId: userId,
            channels: ["inbox", "copilot"],
        });

        if (archiveProposal.approved) {
            if (assetType === "app") {
                const { appRegistryService } = await import("../../../apps/app-registry.service.js");
                // Filter by orgId to prevent cross-tenant archival
                const [app] = await db.select().from(apps)
                    .where(and(eq(apps.slug, assetSlug), eq(apps.organizationId, orgId)))
                    .limit(1);
                if (app) {
                    await appRegistryService.stopApp(app.id);
                    await db.update(apps).set({ isPublic: false, updatedAt: new Date() }).where(eq(apps.id, app.id));
                }
            } else if (assetType === "skill") {
                const { skillService } = await import("../../../agents/core/skill-service.js");
                // Filter by orgId to prevent cross-tenant archival
                const [skill] = await db.select().from(skills)
                    .where(and(eq(skills.name, assetSlug), eq(skills.organizationId, orgId)))
                    .limit(1);
                if (skill) {
                    await skillService.deleteSkill(skill.id);
                }
            }

            await appendTrace(missionRunId, { 
                type: "system", 
                event: "asset_archived", 
                note: `INSTITUTIONAL CLEANUP: '${assetSlug}' (${assetType}) has been decommissioned.`, 
                timestamp: new Date().toISOString() 
            });
        } else {
            await appendTrace(missionRunId, { 
                type: "system", 
                event: "archive_rejected", 
                note: `User rejected the archival request for '${assetSlug}'. Asset remains active.`, 
                timestamp: new Date().toISOString() 
            });
        }
    }
}
