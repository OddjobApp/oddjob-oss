import { db } from "@server/database_service.js";
import { failurePatterns, harnessProposals } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("HarnessProposerService");

export class HarnessProposerService {
  /**
   * Generates candidate HarnessProposals based on identified FailurePatterns.
   * @param harnessId The ID of the harness to propose changes for.
   * @param parentHarnessVersion The version of the harness these proposals are based on.
   * @param patterns A list of FailurePattern objects identified by the WeaknessMiningService.
   * @returns A list of generated HarnessProposal objects.
   */
  async proposeChanges(
    organizationId: number,
    harnessId: string,
    parentHarnessVersion: string,
    patterns: typeof failurePatterns.$inferSelect[],
  ): Promise<typeof harnessProposals.$inferSelect[]> {
    // Fail closed: these rows carry a staged source diff. An unattributed one is
    // both unreadable by every scoped query and exposed to every unscoped one.
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error(
        `HarnessProposerService.proposeChanges requires a resolved organizationId; received ${String(organizationId)}.`,
      );
    }

    const foreign = patterns.filter(
      (p) => p.organizationId != null && p.organizationId !== organizationId,
    );
    if (foreign.length > 0) {
      throw new Error(
        `HarnessProposerService.proposeChanges received ${foreign.length} failure pattern(s) belonging to another organization.`,
      );
    }

    if (patterns.length === 0) {
      logger.info(`No failure patterns provided for harness ${harnessId}@${parentHarnessVersion}. Skipping proposal generation.`);
      return [];
    }

    const client = AIClientFactory.getClient({ provider: "google" } as any);
    const generatedProposals: typeof harnessProposals.$inferSelect[] = [];

    for (const pattern of patterns) {
      let prompt: string;

      if (harnessId === "incident-response") {
        prompt = `Based on the following incident failure pattern, propose a minimal and targeted change to the incident response harness definition (ID: ${harnessId}, Version: ${parentHarnessVersion}). The change should be represented as a JSON object with 'filePath' (e.g., path/to/incident-response.cycle.yaml, path/to/runbook.sh, path/to/monitoring_config.json), 'oldContent', 'newContent' suitable for the self-modification.ts tools. Also provide a 'rationale' for the proposed change, explaining how it addresses the incident failure pattern.\n\nIncident Failure Pattern:\n${JSON.stringify(pattern, null, 2)}\n\nExample of proposed change structure (for a YAML cycle file):\n{\n  "filePath": "server/cycles/incident-response.cycle.yaml",\n  "oldContent": "- step_code: TI-1\\n        action: analyze_alert",\n  "newContent": "- step_code: TI-1\\n        action: analyze_alert\\n      - step_code: TI-1.1\\n        action: check_db_metrics\\n        description: \"Check database connection metrics for anomalies.\"\\n        estimated_duration_minutes: 2",\n  "rationale": "Added a step to proactively check database metrics during triage to prevent recurrence of connection pool exhaustion incidents."
}\nOutput only valid JSON.`;
      } else if (harnessId === "software-audit") {
        prompt = `Based on the following software audit failure pattern, propose a minimal and targeted change to the software audit harness definition (ID: ${harnessId}, Version: ${parentHarnessVersion}). The change should be represented as a JSON object with 'filePath' (e.g., path/to/software-audit.cycle.yaml, path/to/code_quality_rules.json, path/to/security_policy.yaml), 'oldContent', 'newContent' suitable for the self-modification.ts tools. Also provide a 'rationale' for the proposed change, explaining how it addresses the software audit failure pattern.\n\nSoftware Audit Failure Pattern:\n${JSON.stringify(pattern, null, 2)}\n\nExample of proposed change structure (for a YAML cycle file):\n{\n  "filePath": "server/cycles/software-audit.cycle.yaml",\n  "oldContent": "- step_code: SCS-1\\n            action: trigger_sast_scan",\n  "newContent": "- step_code: SCS-1\\n            action: trigger_sast_scan\\n          - step_code: SCS-1.1\\n            action: update_sast_rules\\n            description: \"Update SAST rules to include new vulnerability checks.\"\\n            estimated_duration_minutes: 5",\n  "rationale": "Added a step to regularly update SAST rules to improve vulnerability detection."
}\nOutput only valid JSON.`;
      } else {
        prompt = `Based on the following failure pattern, propose a minimal and targeted change to the harness definition (ID: ${harnessId}, Version: ${parentHarnessVersion}). The change should be represented as a JSON object with 'filePath', 'oldContent', 'newContent' suitable for the self-modification.ts tools. Also provide a 'rationale' for the proposed change, explaining how it addresses the failure pattern.\n\nFailure Pattern:\n${JSON.stringify(pattern, null, 2)}\n\nOutput only valid JSON.`;
      }

      try {
        const llmResponse = await client.execute({
          model: "gemini-2.0-flash",
          temperature: 0.7,
          maxTokens: 2000,
          isPriority: false,
          userPrompt: prompt,
          systemPrompt: "You are an expert in harness engineering and can propose precise, minimal changes to YAML configurations and code to address identified failure patterns. Output only valid JSON.",
          useCache: false,
          saveOutputToFile: false,
        }, undefined, developmentProviderKey());

        const parsedResponse = JSON.parse(llmResponse.output ?? "{}");

        const [newProposal] = await db.insert(harnessProposals).values({
          organizationId,
          harnessId,
          parentHarnessVersion,
          proposedChange: { filePath: parsedResponse.filePath, oldContent: parsedResponse.oldContent, newContent: parsedResponse.newContent },
          rationale: parsedResponse.rationale,
          proposedByAgentId: "HarnessProposerAI", // Could be dynamic based on LLM used
          validationStatus: "pending",
          validationResults: {}, // Will be filled during validation
        }).returning();
        generatedProposals.push(newProposal);

      } catch (err: any) {
        logger.error(`Error during LLM analysis for harness proposal: ${err.message}`, err);
      }
    }

    return generatedProposals;
  }
}