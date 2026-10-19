import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
    STUDIO_CONTRIBUTION_PROPOSAL,
    STUDIO_CONTRIBUTION_APPLIED,
    type StudioContributionProposal,
    type ContributionTargetStudio,
    type ContributionDiffItem,
    applyContributionMessage,
    parseContributionApply,
    findContributionProposal,
} from "@shared/studio-contribution.js";
import { requireToolOrgId } from "./org-context.js";
import type { ToolContext, ToolDefinition } from "./types.js";

export {
    STUDIO_CONTRIBUTION_PROPOSAL,
    STUDIO_CONTRIBUTION_APPLIED,
    applyContributionMessage,
    parseContributionApply,
    findContributionProposal,
};

/**
 * Studio Contribution tools.
 *
 * An agent can introduce a suggestion to any live studio and surface it to the
 * user as a HIL approval card. Nothing is written until the person clicks Apply.
 *
 * Design constraints:
 *  - Agents MUST call this tool when they want to modify a Flow, Scribe doc,
 *    Form, Signal feed, or any other studio on behalf of the user.
 *  - Suggestions use this card. Explicitly requested draft edits may use the
 *    available mutation tools directly, with their existing permission checks.
 *  - The applyAction field carries the downstream tool call so the crew service
 *    executes it after the card is approved, with no second LLM turn needed.
 */

const DiffItemSchema = z.object({
    label: z.string().min(1).max(200).describe('Short label, e.g. "Add step", "New section".'),
    description: z.string().min(1).max(2000).describe("Full description of what is changing."),
    before: z.string().optional().describe("Current value (for replacements/edits)."),
    after: z.string().optional().describe("New value or addition."),
    reversible: z.boolean().optional().default(true),
});

const ApplyActionSchema = z.object({
    tool: z.string().min(1).max(120).describe("Tool name to call when the user approves."),
    args: z.record(z.any()).describe("Arguments to pass to that tool."),
});

export const STUDIO_CONTRIBUTION_TOOLS: Record<string, ToolDefinition> = {
    propose_studio_contribution: {
        name: "propose_studio_contribution",
        label: "Propose a Studio Contribution",
        group: "StudioCollaboration",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Introduces the agent's own suggestion to a live studio (Flow, Scribe, Form, Signal, Prediction, Media, " +
            "Project, or Computer Use) and surfaces it to the user as a Human-In-The-Loop approval card. " +
            "Nothing is written until the user clicks Apply.\n\n" +
            "WHEN TO USE: Call this whenever you want to add a step to a flow, insert a Scribe section, add a form " +
            "field, activate a signal feed, or suggest another change that the user has not requested. For an " +
            "explicitly requested draft edit, use the available studio mutation tool directly, respecting its permissions and lifecycle checks.\n\n" +
            "For requested archive/delete operations, use this card with targetId matching the action's resource ID. " +
            "Supported actions: form_archive(formId), scribe_delete_station(nodeId), media_delete_scene(sceneId), " +
            "signal_disable_feed(feedId), project_archive(projectId), agent_disable_card(agentId), computer_archive_skill(skillId). " +
            "The server adds confirmation after the user applies the card; service permissions still apply. " +
            "HOW IT WORKS: Supply the targetStudio and targetLabel so the card knows what is being changed, a " +
            "diff list of what you are proposing (each item has a label and description), your rationale, and " +
            "optionally an applyAction with the downstream tool call and its arguments. When the user approves, " +
            "the crew service calls that tool automatically — no second turn needed.",
        parameters: z.object({
            targetStudio: z
                .enum(["flow", "scribe", "form", "signal", "prediction", "media", "project", "computer", "agent"])
                .describe("Which studio the contribution targets."),
            targetLabel: z
                .string()
                .min(1)
                .max(300)
                .describe('Human name of what is being changed, e.g. "Loan Triage Flow", "Incident Report".'),
            targetId: z
                .union([z.string(), z.number()])
                .optional()
                .describe(
                    "ID of the specific pipeline, document, form, or feed being changed. Omit for new items.",
                ),
            rationale: z
                .string()
                .min(1)
                .max(2000)
                .describe("Why you are suggesting this — shown to the user on the card."),
            diff: z
                .array(DiffItemSchema)
                .min(1)
                .max(20)
                .describe("What you are proposing, as a list of changes."),
            checks: z
                .array(z.string().min(1).max(500))
                .optional()
                .describe("Non-blocking notices the user should know before approving."),
            requiresApproval: z
                .boolean()
                .optional()
                .default(true)
                .describe(
                    "Whether a human must approve before the change is applied. Almost always true. " +
                    "Set to false only when the user has explicitly said they trust you to make this change without review.",
                ),
            applyAction: ApplyActionSchema.optional().describe(
                "Tool call to execute after approval. The crew service calls this tool with these args — " +
                "the user never has to type a follow-up message.",
            ),
        }),
        execute: async (
            params: {
                targetStudio: ContributionTargetStudio;
                targetLabel: string;
                targetId?: string | number;
                rationale: string;
                diff: ContributionDiffItem[];
                checks?: string[];
                requiresApproval?: boolean;
                applyAction?: { tool: string; args: Record<string, unknown> };
            },
            context: ToolContext,
        ) => {
            requireToolOrgId(context); // ensures org-scoping gate passes

            const proposal: StudioContributionProposal & { type: string } = {
                type: STUDIO_CONTRIBUTION_PROPOSAL,
                proposalId: `contrib_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
                targetStudio: params.targetStudio,
                targetLabel: params.targetLabel,
                ...(params.targetId != null ? { targetId: params.targetId } : {}),
                rationale: params.rationale,
                diff: params.diff,
                ...(params.checks?.length ? { checks: params.checks } : {}),
                requiresApproval: params.requiresApproval !== false,
                ...(params.applyAction ? { applyAction: params.applyAction } : {}),
            };

            return JSON.stringify(proposal);
        },
    },

    apply_studio_contribution: {
        name: "apply_studio_contribution",
        label: "Apply an Approved Contribution",
        group: "StudioCollaboration",
        idempotency: "none",
        riskLevel: "medium",
        description:
            "Applies a studio contribution the user approved on its card. " +
            "Do not call this directly — it is called automatically by the crew service after the user clicks Apply " +
            "on a StudioContributionProposalCard. If the proposal carried an applyAction, the crew service " +
            "chains that tool call immediately after this one completes.",
        parameters: z.object({
            proposalId: z.string().min(8).max(64).describe("The proposal id from the card."),
        }),
        execute: async (params: { proposalId: string }, context: ToolContext) => {
            requireToolOrgId(context);
            // The actual mutation is in the applyAction — handled by the crew service.
            // This tool just writes the 'applied' marker so the card knows to stop offering Apply.
            const result = {
                type: STUDIO_CONTRIBUTION_APPLIED,
                proposalId: params.proposalId,
                appliedAt: new Date().toISOString(),
            };
            return JSON.stringify(result);
        },
    },
};
