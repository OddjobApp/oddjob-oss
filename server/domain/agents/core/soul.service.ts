import { db } from "@server/database_service.js";
import { agentDeployments } from "@shared/schema/agent-deployments.js";
import { appDeployments } from "@shared/schema/apps.js";
import { agentPerformances } from "@shared/schema/agent-performance.js";
import { performanceSnapshots } from "@shared/schema/performance-snapshots.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemConfigService } from "@domain/system/system-config.service.js";

const logger = createLogger("SoulService");


export interface OceanTraits {
  o: number; // Openness
  c: number; // Conscientiousness
  e: number; // Extraversion
  a: number; // Agreeableness
  n: number; // Neuroticism
}

export class SoulService {
  /**
   * Get all available archetypes from system config
   */
  static async getArchetypes(): Promise<Record<string, OceanTraits>> {
    const config = await systemConfigService.getGlobalConfig();
    return config.soulConstants.archetypeTraits;
  }

  /**
   * Generates the "Oddjob Protocol" prompt modifiers based on OCEAN traits.
   */
  static generateSoulPrompt(traits: OceanTraits, archetype: string): string {
    let prompt = `\n\n### ODDJOB PROTOCOL: SOUL LAYER [ARCHETYPE: ${archetype}]\n`;
    
    // Trait-based steering
    if (traits.o > 0.8) prompt += "- Maintain high intellectual curiosity; explore unconventional solutions.\n";
    if (traits.c > 0.8) prompt += "- Be extremely methodical; cross-reference all intelligence before reporting.\n";
    if (traits.e < 0.3) prompt += "- Remain laconic and professional; prioritize data over dialogue.\n";
    if (traits.a > 0.7) prompt += "- Prioritize operative safety and collaboration; use a supportive tone.\n";
    if (traits.n > 0.6) prompt += "- Exercise high caution; flag even minor anomalies as potential threats.\n";

    // Archetype-specific mannerisms
    switch (archetype) {
      case "Ghost Analyst":
        prompt += "- Use detached, clinical language. Refer to findings as 'Signals' and 'Noise'.\n";
        break;
      case "The Quartermaster":
        prompt += "- Focus on efficiency and resource allocation. Use technical jargon frequently.\n";
        break;
      case "Lead Directive":
        prompt += "- Maintain an authoritative 'Command' tone. Use bulleted action items.\n";
        break;
    }

    return prompt + "### END PROTOCOL\n";
  }

  /**
   * Calculates the drift for a soul based on mission performance.
   */
  static calculateEvolutionDrift(currentTraits: OceanTraits, success: boolean, failureReason?: string): Partial<OceanTraits> {
    const drift: Partial<OceanTraits> = {};
    const step = 0.05;

    if (success) {
      // Reinforce the current successful profile
      drift.c = Math.min(1, currentTraits.c + step); // Success increases conscientiousness
      drift.o = Math.min(1, currentTraits.o + (currentTraits.o > 0.5 ? step : -step)); // Polarize openness
    } else if (failureReason?.includes("hallucination") || failureReason?.includes("accuracy")) {
      // Accuracy failures trigger a shift toward extreme Conscientiousness and Neuroticism (Caution)
      drift.c = Math.min(1, currentTraits.c + step * 2);
      drift.n = Math.min(1, currentTraits.n + step);
    }

    return drift;
  }

  static async updateAgentSoul(deploymentId: number, isApp: boolean, success: boolean, failureReason?: string, missionRunId?: number) {
    const table: any = isApp ? appDeployments : agentDeployments;
    
    try {
      const [dep] = await db.select().from(table).where(eq(table.id, deploymentId)).limit(1);
      if (!dep || !dep.oceanTraits) {
        logger.warn(`No deployment or traits found for ${isApp ? 'App' : 'Agent'} ${deploymentId}`);
        return;
      }

      const currentTraits = (dep.oceanTraits || {}) as Partial<OceanTraits>;
      const baseTraits: OceanTraits = {
        o: typeof currentTraits.o === 'number' ? currentTraits.o : 0.5,
        c: typeof currentTraits.c === 'number' ? currentTraits.c : 0.5,
        e: typeof currentTraits.e === 'number' ? currentTraits.e : 0.5,
        a: typeof currentTraits.a === 'number' ? currentTraits.a : 0.5,
        n: typeof currentTraits.n === 'number' ? currentTraits.n : 0.5,
      };

      const drift = this.calculateEvolutionDrift(baseTraits, success, failureReason);
      
      if (Object.keys(drift).length === 0) {
        logger.debug(`No drift calculated for ${isApp ? 'App' : 'Agent'} ${deploymentId}`);
        return;
      }

      const newTraits: OceanTraits = {
        o: Math.max(0, Math.min(1, baseTraits.o + (drift.o || 0))),
        c: Math.max(0, Math.min(1, baseTraits.c + (drift.c || 0))),
        e: Math.max(0, Math.min(1, baseTraits.e + (drift.e || 0))),
        a: Math.max(0, Math.min(1, baseTraits.a + (drift.a || 0))),
        n: Math.max(0, Math.min(1, baseTraits.n + (drift.n || 0))),
      };

      await db.update(table)
        .set({ 
          oceanTraits: newTraits, 
          updatedAt: new Date() 
        } as any)
        .where(eq(table.id, deploymentId));

      logger.info(`Evolution complete for ${isApp ? 'App' : 'Agent'} ${deploymentId}`, { traits: newTraits });

      // Capture performance snapshot after OCEAN drift update
      if (missionRunId && !isApp) {
        await this.capturePerformanceSnapshot(deploymentId, missionRunId, newTraits, success);
      }
    } catch (err: any) {
      logger.error(`Failed to update soul for ${isApp ? 'App' : 'Agent'} ${deploymentId}: ${err.message}`);
    }
  }

  /**
   * Captures a performance snapshot for the agent after a mission run.
   * Pulls aggregate metrics from agent_performances and records them alongside the OCEAN traits.
   */
  private static async capturePerformanceSnapshot(
    agentDeploymentId: number, 
    missionRunId: number, 
    oceanTraits: OceanTraits, 
    success: boolean
  ): Promise<void> {
    try {
      // Look up the agent's jobId to find their performance record
      const [dep] = await db.select({ jobId: agentDeployments.jobId, organizationId: agentDeployments.organizationId })
        .from(agentDeployments)
        .where(eq(agentDeployments.id, agentDeploymentId))
        .limit(1);

      if (!dep) return;

      // Query aggregate metrics from agent_performances (keyed by "{jobId}-{orgId}")
      const perfId = `${dep.jobId}-${dep.organizationId}`;
      const [perfRecord] = await db.select()
        .from(agentPerformances)
        .where(eq(agentPerformances.id, perfId))
        .limit(1);

      const runOutcome: string = success ? 'success' : 'failure';

      await db.insert(performanceSnapshots).values({
        agentDeploymentId,
        missionRunId,
        successRate: perfRecord?.successRate ?? "0",
        costUsd: perfRecord?.avgCostPerMission ?? "0",
        efficiencyScore: perfRecord?.efficiencyScore ?? "0",
        oceanTraitsSnapshot: oceanTraits,
        runOutcome,
      });

      logger.info(`Performance snapshot captured for deployment ${agentDeploymentId}, run ${missionRunId}`);
    } catch (err: any) {
      logger.warn(`Failed to capture performance snapshot for deployment ${agentDeploymentId}: ${err.message}`);
    }
  }

  /**
   * Evolves the agent's Legend (Operational Philosophy) based on mission outcomes.
   */
  static async evolveLegend(agentId: number, missionInsights: string) {
    logger.info(`Evolving Legend for Agent ${agentId}...`);

    try {
      const [dep] = await db.select().from(agentDeployments).where(eq(agentDeployments.jobId, agentId)).limit(1);
      if (!dep) return;

      const currentLegend = dep.legend || `I am an Oddjob Agent specializing in ${dep.title}. My mission is to provide premium assistance.`;

      // Use AI to synthesize the new Legend
      const aiConfig = await (await import("../../ai/core/system-ai.service.js")).systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-flash' };
      const { AIClientFactory } = await import("../../ai/core/ai-client.service.js");
      const client = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);

      const prompt = `
      You are the "Soul Architect." You are responsible for evolving an agent's "Legend" (their core identity and philosophy).
      
      CURRENT LEGEND:
      "${currentLegend}"
      
      NEW MISSION INSIGHTS:
      "${missionInsights}"
      
      TASK:
      Update the Legend to incorporate the new insights. The Legend should be written in a "Premium, Authoritative, and First-Person" tone (e.g., "I have mastered...", "I prioritize...").
      Maintain the agent's core archetype but show growth.
      
      Format: Return ONLY the updated Legend text.
      `;

      const result = await client.execute({
        model: aiConfig.model,
        userPrompt: prompt,
        temperature: 0.3
      } as any, undefined, aiConfig.apiKey || "");

      if (result.success && result.output) {
        await db.update(agentDeployments)
          .set({ 
            legend: result.output.trim(),
            updatedAt: new Date() 
          })
          .where(eq(agentDeployments.id, dep.id));
        logger.info(`Legend for Agent ${agentId} evolved successfully.`);
      }
    } catch (err: any) {
      logger.error(`Failed to evolve legend for Agent ${agentId}: ${err.message}`);
    }
  }
}


