import { z } from "zod";

export const knowledgePackToolDefinitions = [
  {
    name: "list_knowledge_packs",
    description: "List knowledge packs installed for the current organization, including staged/certified/active status and immutable pack versions.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_applicable_governance",
    description: "Return active organization knowledge-pack controls applicable to an intended action. This is a read-only preview; evaluate_governed_action is the authoritative decision gate.",
    inputSchema: { type: "object" as const, properties: { actionType: { type: "string" } }, required: ["actionType"] },
  },
  {
    name: "evaluate_governed_action",
    description: "Deterministically evaluate a proposed action against all active organization knowledge packs and write reproducible decision evidence. BLOCK, APPROVAL_REQUIRED, and INSUFFICIENT_CONTEXT must prevent execution.",
    inputSchema: { type: "object" as const, properties: { actionType: { type: "string" }, context: { type: "object", additionalProperties: true } }, required: ["actionType", "context"] },
  },
];

export const GetApplicableGovernanceInput = z.object({ actionType: z.string().min(1) });
export const EvaluateGovernedActionInput = z.object({ actionType: z.string().min(1), context: z.record(z.unknown()) });

