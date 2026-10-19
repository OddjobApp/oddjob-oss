import { knowledgePackService } from "../../domain/knowledge-packs/knowledge-pack.service.js";
import { EvaluateGovernedActionInput, GetApplicableGovernanceInput } from "../tools/knowledge-packs.js";
import { errorResponse, getOrgContext, successResponse } from "./utils.js";
import type { ToolContext } from "./utils.js";

export async function handleListKnowledgePacks(_args: unknown, context?: ToolContext) {
  try {
    const { organizationId } = getOrgContext(context);
    if (organizationId == null) return errorResponse("No organization context available");
    const rows = await knowledgePackService.listForOrganization(organizationId);
    return successResponse(rows.map(({ installation, pack }) => ({ id: installation.id, packKey: pack.packKey, version: pack.version, status: installation.status, synthetic: pack.synthetic, contentHash: pack.contentHash })), `Found ${rows.length} installed knowledge pack(s)`);
  } catch (error: any) { return errorResponse(error?.message ?? String(error)); }
}

export async function handleGetApplicableGovernance(args: unknown, context?: ToolContext) {
  try {
    const input = GetApplicableGovernanceInput.parse(args);
    const { organizationId } = getOrgContext(context);
    if (organizationId == null) return errorResponse("No organization context available");
    const governance = await knowledgePackService.getApplicableGovernance(organizationId, input.actionType);
    return successResponse(governance, `Found ${governance.length} active governing pack(s)`);
  } catch (error: any) { return errorResponse(error?.message ?? String(error)); }
}

export async function handleEvaluateGovernedAction(args: unknown, context?: ToolContext) {
  try {
    const input = EvaluateGovernedActionInput.parse(args);
    const org = getOrgContext(context);
    if (org.organizationId == null) return errorResponse("No organization context available");
    const result = await knowledgePackService.evaluateAction(org.organizationId, input.actionType, input.context, org.userId);
    return successResponse(result, `Governance decision: ${result.decision}`);
  } catch (error: any) { return errorResponse(error?.message ?? String(error)); }
}

