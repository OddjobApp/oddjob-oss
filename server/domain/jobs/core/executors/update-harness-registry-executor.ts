import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { HarnessRegistryService } from "@server/domain/self-improvement/harness-registry.service.js";
import { SELF_MODIFICATION_TOOLS } from "@server/domain/tools/v1/capabilities/self-modification.js";

export class UpdateHarnessRegistryExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "update_harness_registry";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessId, newHarnessVersion, acceptedProposals } = resolvedConfig;

    if (!harnessId || !newHarnessVersion || !acceptedProposals) {
      return { success: false, output: "", status: "failure", error: "harnessId, newHarnessVersion, and acceptedProposals are required" };
    }

    const harnessRegistryService = new HarnessRegistryService();

    // Retrieve the current harness definition from the registry or file system
    // For simplicity, let's assume we read it from the file system based on the first accepted proposal
    if (acceptedProposals.length === 0) {
        return { success: true, output: "No proposals applied, registry not updated.", status: "success" };
    }
    const filePath = acceptedProposals[0].proposedChange.filePath;
    const currentHarnessDefinition = await SELF_MODIFICATION_TOOLS.code_read.execute({ filePath }, { isSuperAdmin: true, userId: "System", named: {}, positional: {} });
    
    if (typeof currentHarnessDefinition !== 'string' || currentHarnessDefinition.startsWith('Error')) {
        return { success: false, output: "", status: "failure", error: `Failed to read current harness definition from ${filePath}` };
    }

    // Save the new version of the harness definition in the registry
    await harnessRegistryService.saveHarnessVersion(harnessId, newHarnessVersion, currentHarnessDefinition);

    // Optionally, activate the new harness version if desired
    await harnessRegistryService.activateHarness(harnessId, newHarnessVersion);

    return { success: true, output: `Harness ${harnessId} updated to version ${newHarnessVersion}`, status: "success" };
  }
}