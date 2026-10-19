import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { SELF_MODIFICATION_TOOLS } from "@server/domain/tools/v1/capabilities/self-modification.js";
import { isProposalDualApproved } from "@server/services/self-modification-admin.service.js";

export class ApplyAcceptedProposalsExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "apply_accepted_proposals";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { acceptedProposals } = resolvedConfig;

    if (!acceptedProposals || acceptedProposals.length === 0) {
      return { success: true, output: "No accepted proposals to apply.", status: "success" };
    }

    const appliedResults = [];
    for (const proposal of acceptedProposals) {
      if (!proposal.humanApprovedAt) {
        console.warn(`Skipping proposal ${proposal.id}: awaiting human approval before it can be applied.`);
        appliedResults.push({ proposalId: proposal.id, result: "Skipped: awaiting human approval." });
        continue;
      }

      if (!isProposalDualApproved(proposal)) {
        const filePath = proposal.proposedChange?.filePath || "unknown";
        console.warn(`Skipping proposal ${proposal.id}: critical path '${filePath}' requires dual-maintainer approval (Four-Eyes Principle).`);
        appliedResults.push({
          proposalId: proposal.id,
          result: "Skipped: requires dual-maintainer approval (Four-Eyes Principle).",
        });
        continue;
      }

      // Apply the change using the self-modification tool
      const applyResult = await SELF_MODIFICATION_TOOLS.code_edit.execute({
        filePath: proposal.proposedChange.filePath,
        oldContent: proposal.proposedChange.oldContent,
        newContent: proposal.proposedChange.newContent,
        commitMessage: `Self-Harness: Apply accepted proposal ${proposal.id}`,
      }, { isSuperAdmin: true, userId: "System", named: {}, positional: {} }); // Context for self-modification tool

      appliedResults.push({ proposalId: proposal.id, result: applyResult });

      if (applyResult.startsWith("Error")) {
        // Handle error, maybe update proposal status to 'failed_to_apply'
        // For now, just log and continue.
        console.error(`Failed to apply proposal ${proposal.id}: ${applyResult}`);
      }
    }

    return { success: true, output: JSON.stringify({ appliedResults }), status: "success" };
  }
}