import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { ProposalValidationService } from "@server/domain/self-improvement/proposal-validation.service.js";

export class ValidateHarnessProposalsExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "validate_harness_proposals";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessProposals } = resolvedConfig;

    if (!harnessProposals) {
      return { success: false, output: "", status: "failure", error: "harnessProposals are required" };
    }

    // Validation writes evaluation rows and reads a baseline; both are now
    // tenant-scoped, so an unscoped job would write evidence nothing can read.
    const organizationId = job.organizationId;
    if (!Number.isInteger(organizationId) || (organizationId as number) <= 0) {
      return {
        success: false,
        output: "",
        status: "failure",
        error: "validate_harness_proposals requires an organization-scoped job; refusing to write unattributed validation evidence.",
      };
    }

    const proposalValidationService = new ProposalValidationService();
    const acceptedProposals = [];

    for (const proposal of harnessProposals) {
      const validatedProposal = await proposalValidationService.validateProposal(proposal.id, organizationId as number);
      if (validatedProposal?.validationStatus === "accepted") {
        acceptedProposals.push(validatedProposal);
      }
    }

    return { success: true, output: JSON.stringify({ acceptedProposals }), status: "success" };
  }
}