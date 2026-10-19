import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("AutoresearchWeaknessesExecutor");

export class AutoresearchWeaknessesExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "autoresearch_weaknesses";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessId, harnessVersion, failurePatterns } = resolvedConfig;

    if (!harnessId || !harnessVersion) {
      return { success: false, output: "", status: "failure", error: "harnessId and harnessVersion are required" };
    }

    logger.info(`Starting autoresearch for ${harnessId}@${harnessVersion} with ${failurePatterns?.length || 0} failure patterns`);

    try {
      // If no failure patterns, return early with empty insights
      if (!failurePatterns || failurePatterns.length === 0) {
        return {
          success: true,
          output: "No failure patterns provided. Skipping autoresearch.",
          status: "success",
          outputs: { autoresearchInsights: [] },
        } as any;
      }

      const client = AIClientFactory.getClient({ provider: "google" } as any);
      const insights: any[] = [];

      // For each failure pattern, research external knowledge and internal patterns
      for (const pattern of failurePatterns) {
        const patternSignature = pattern.patternSignature || {};
        const patternDescription = typeof patternSignature === 'string' 
          ? patternSignature 
          : JSON.stringify(patternSignature);

        const prompt = `You are an expert in system reliability and harness engineering. 
Given the following failure pattern from a harness (ID: ${harnessId}, Version: ${harnessVersion}), 
research and propose novel improvements by:

1. Analyzing the failure mechanism and identifying root causes
2. Considering industry best practices for similar issues
3. Proposing innovative solutions that go beyond simple patches
4. Suggesting architectural improvements that could prevent recurrence

Failure Pattern:
${patternDescription}

Cluster Size: ${pattern.clusterSize}
Representative Traces: ${pattern.representativeTraces?.length || 0}

Provide a structured JSON response with:
- "improvementCategory": (e.g., "monitoring", "redundancy", "circuit_breaker", "caching", "async_processing")
- "novelApproach": A brief description of an innovative solution
- "implementationComplexity": (low/medium/high)
- "expectedImpact": (low/medium/high)
- "relatedBestPractices": Array of industry best practice names

Output only valid JSON.`;

        try {
          const llmResponse = await client.execute({
            model: "gemini-2.0-flash",
            temperature: 0.7,
            maxTokens: 1500,
            isPriority: false,
            userPrompt: prompt,
            systemPrompt: "You are an expert in system reliability research. Output only valid JSON.",
            useCache: false,
            saveOutputToFile: false,
          }, undefined, developmentProviderKey());

          const parsedResponse = JSON.parse(llmResponse.output ?? "{}");
          
          insights.push({
            patternId: pattern.id,
            patternSignature: pattern.patternSignature,
            autoresearchInsight: parsedResponse,
            researchedAt: new Date().toISOString(),
          });

        } catch (err: any) {
          logger.error(`Autoresearch failed for pattern ${pattern.id}: ${err.message}`);
          // Continue with other patterns even if one fails
        }
      }

      logger.info(`Autoresearch complete for ${harnessId}. Generated ${insights.length} insights.`);

      return {
        success: true,
        output: `Autoresearch complete. Generated ${insights.length} improvement insights from ${failurePatterns.length} failure patterns.`,
        status: "success",
        outputs: { autoresearchInsights: insights },
      } as any;

    } catch (error: any) {
      logger.error(`Autoresearch failed for ${harnessId}:`, error);
      return {
        success: false,
        output: "",
        status: "failure",
        error: `Autoresearch failed: ${error.message}`,
      };
    }
  }
}
