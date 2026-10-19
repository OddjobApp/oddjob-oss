import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { HarnessProposerService } from "@server/domain/self-improvement/harness-proposer.service.js";

export class ProposeHarnessChangesExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "propose_harness_changes";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessId, harnessVersion, failurePatterns } = resolvedConfig;

    if (!harnessId || !harnessVersion || !failurePatterns) {
      return { success: false, output: "", status: "failure", error: "harnessId, harnessVersion, and failurePatterns are required" };
    }

    // Proposals stage a source diff for self-modification; they must be owned.
    const organizationId = job.organizationId;
    if (!Number.isInteger(organizationId) || (organizationId as number) <= 0) {
      return {
        success: false,
        output: "",
        status: "failure",
        error: "propose_harness_changes requires an organization-scoped job; refusing to stage an unattributed code change.",
      };
    }

    const harnessProposerService = new HarnessProposerService();
    const harnessProposals = await harnessProposerService.proposeChanges(
      organizationId as number,
      harnessId,
      harnessVersion,
      failurePatterns,
    );

    return { success: true, output: JSON.stringify({ harnessProposals }), status: "success" };
  }
}