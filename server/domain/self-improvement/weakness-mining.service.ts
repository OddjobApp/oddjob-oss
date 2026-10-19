import { db } from "@server/database_service.js";
import { evaluationResults, failurePatterns } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { eq, and } from "drizzle-orm";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("WeaknessMiningService");

export class WeaknessMiningService {
  /**
   * Analyzes raw EvaluationResults to identify and cluster recurring FailurePatterns.
   *
   * Clustering is tenant-scoped. It previously keyed only on harness + signature,
   * so a pattern mined for one organization absorbed and was absorbed by every
   * other organization's failures on the same harness.
   *
   * @param organizationId Owning tenant. Required — mining refuses without one.
   * @param harnessId The ID of the harness being evaluated.
   * @param harnessVersion The version of the harness being evaluated.
   * @param results The raw EvaluationResult objects to analyze.
   * @returns A list of identified FailurePattern objects.
   */
  async mineWeaknesses(
    organizationId: number,
    harnessId: string,
    harnessVersion: string,
    results: typeof evaluationResults.$inferSelect[],
  ): Promise<typeof failurePatterns.$inferSelect[]> {
    // Fail closed: an unresolved tenant must not write global rows, and must not
    // be silently rewritten to a default organization.
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error(
        `WeaknessMiningService.mineWeaknesses requires a resolved organizationId; received ${String(organizationId)}.`,
      );
    }

    // Only this tenant's results can contribute to this tenant's patterns.
    const foreign = results.filter(
      (r) => r.organizationId != null && r.organizationId !== organizationId,
    );
    if (foreign.length > 0) {
      throw new Error(
        `WeaknessMiningService.mineWeaknesses received ${foreign.length} evaluation result(s) belonging to another organization.`,
      );
    }

    const failedResults = results.filter(r => r.status === 'fail' || r.status === 'partial');
    if (failedResults.length === 0) {
      logger.info(`No failed or partial results for harness ${harnessId}@${harnessVersion}. Skipping weakness mining.`);
      return [];
    }

    const client = AIClientFactory.getClient({ provider: "google" } as any);
    const identifiedPatterns: typeof failurePatterns.$inferSelect[] = [];

    // In a real implementation, this would involve more sophisticated LLM prompting
    // and potentially multiple calls to cluster and refine patterns.
    for (const failedResult of failedResults) {
      let prompt: string;
      if (harnessId === "incident-response") {
        prompt = `Analyze the following incident evaluation result for the incident response harness (ID: ${harnessId}, Version: ${harnessVersion}). Identify the core incident failure mechanism, a recurring root cause, or an inefficiency in the resolution process based on the status, metrics (like MTTR), and failure reason. Provide a structured JSON output with a 'signature' (a short, descriptive string or object that uniquely identifies the pattern, e.g., { root_cause: "db_connection_exhaustion", impact: "service_outage" }) and a brief 'description'.\n\nIncident Evaluation Result:\n${JSON.stringify(failedResult, null, 2)}`;
      } else if (harnessId === "software-audit") {
        prompt = `Analyze the following software audit evaluation result for the software audit harness (ID: ${harnessId}, Version: ${harnessVersion}). Identify the core audit failure mechanism, a recurring root cause for non-compliance or quality issues, or an inefficiency in the audit process based on the status, metrics (like critical_vulnerabilities, code_quality_score), and failure reason. Provide a structured JSON output with a 'signature' (a short, descriptive string or object that uniquely identifies the pattern, e.g., { category: "security", type: "sql_injection", file_type: "ts" }) and a brief 'description'.\n\nSoftware Audit Evaluation Result:\n${JSON.stringify(failedResult, null, 2)}`;
      } else {
        prompt = `Analyze the following evaluation result for the harness (ID: ${harnessId}, Version: ${harnessVersion}). Identify the core failure mechanism, a recurring root cause, or an inefficiency in the process based on the status, metrics, and failure reason. Provide a structured JSON output with a 'signature' (a short, descriptive string or object that uniquely identifies the pattern) and a brief 'description'.\n\nEvaluation Result:\n${JSON.stringify(failedResult, null, 2)}`;
      }

      try {
        const llmResponse = await client.execute({
          model: "gemini-2.0-flash",
          temperature: 0.3,
          maxTokens: 1000,
          isPriority: false,
          userPrompt: prompt,
          systemPrompt: "You are an expert in analyzing system failures and identifying recurring patterns. Output only valid JSON.",
          useCache: false,
          saveOutputToFile: false,
        }, undefined, developmentProviderKey());

        const parsedResponse = JSON.parse(llmResponse.output ?? "{}");

        // Check if a similar pattern already exists in our identified patterns or DB
        let existingPattern = identifiedPatterns.find(p => JSON.stringify(p.patternSignature) === JSON.stringify(parsedResponse.signature));
        if (!existingPattern) {
            const [dbExisting] = await db.select().from(failurePatterns)
                .where(and(
                    eq(failurePatterns.organizationId, organizationId),
                    eq(failurePatterns.harnessId, harnessId),
                    eq(failurePatterns.harnessVersion, harnessVersion),
                    eq(failurePatterns.patternSignature, parsedResponse.signature)
                ));
            existingPattern = dbExisting;
        }

        if (existingPattern) {
            // Update cluster size and representative traces
            await db.update(failurePatterns)
                .set({
                    clusterSize: existingPattern.clusterSize + 1,
                    representativeTraces: [...(existingPattern.representativeTraces ?? []), ...(failedResult.traceId ? [failedResult.traceId] : [])],
                })
                .where(eq(failurePatterns.id, existingPattern.id));
        } else {
            // Create new pattern
            const [newPattern] = await db.insert(failurePatterns).values({
                organizationId,
                harnessId,
                harnessVersion,
                patternSignature: parsedResponse.signature,
                clusterSize: 1,
                representativeTraces: failedResult.traceId ? [failedResult.traceId] : [],
                // Left NULL: nothing here scores actionability yet. This was a
                // hardcoded 0, which presented an unscored pattern as scored.
                actionabilityScore: null,
            }).returning();
            identifiedPatterns.push(newPattern);
        }

      } catch (err: any) {
        logger.error(`Error during LLM analysis for weakness mining: ${err.message}`, err);
      }
    }

    return identifiedPatterns;
  }
}