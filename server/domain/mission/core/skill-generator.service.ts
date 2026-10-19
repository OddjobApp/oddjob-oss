import { createLogger } from "@server/utils/logger.js";
import { EvidenceStorageService } from "@domain/core/infrastructure/evidence-storage.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { db } from "@server/database_service.js";
import { skills, skillVersionHistory, approvalRequests, missionRuns } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { resolveOrgGeminiKey, developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import type { Skill, SkillVersionHistory } from "@shared/schema/skills.js";

const logger = createLogger("SkillGeneratorService");

export interface EvolutionProposal {
  skillId: string;
  strategyDescription: string;
  modifiedContext: Record<string, any>;
  recommendedModelId: string;
  newVersion: string;
  proposedCode?: string;
}

export interface SynthesizeFromInterventionOptions {
  approvalRequestId?: number;
  missionRunId?: number;
  organizationId: number;
  skillName?: string;
  userId?: string;
  customInstructions?: string;
}

export interface SynthesizedSkillResult {
  skill: Skill;
  version: SkillVersionHistory;
  strategyDescription: string;
  sourceIntervention: {
    approvalRequestId?: number;
    missionRunId?: number;
    toolName?: string;
    operatorComments?: string;
  };
}

export class SkillGeneratorService {
  /**
   * Generates a proposal for agent evolution based on failures and TrustGraph context.
   */
  async generateProposal(skillId: string, failures: any[], graphContextUrl: string): Promise<EvolutionProposal> {
    logger.info(`[SkillGenerator] Generating evolution proposal for skill ${skillId}`);

    // 1. Fetch Skill Details
    let skill: any = { name: skillId, metadata: {} };
    if (!isNaN(Number(skillId))) {
      const skillRes = await db.select().from(skills).where(eq(skills.id, Number(skillId))).limit(1);
      if (skillRes[0]) skill = skillRes[0];
    }

    // 2. Retrieve TrustGraph Context
    let contextData = null;
    if (graphContextUrl) {
      contextData = await EvidenceStorageService.retrieve(graphContextUrl);
    }

    // 3. Resolve AI config from system settings (respects local/Ollama if configured)
    const aiConfig = await systemAiService.getAiConfig("copilot");
    const provider = aiConfig?.provider || process.env.AI_PROVIDER || "google";
    const model = aiConfig?.model || process.env.AI_MODEL || "gemini-2.0-flash";
    const apiKey = aiConfig?.apiKey || developmentProviderKey();
    const baseUrl = aiConfig?.baseUrl;

    // 4. Prepare AI Prompt
    const systemPrompt = `You are the Oddjob Evolution Engine.
Your goal is to analyze agent failures and synthesize an improved strategy.
You have access to:
1. The original skill configuration.
2. Recent failure logs (signatures).
3. TrustGraph Context Core (relational memory of the mission environment).

Provide a JSON proposal with:
- strategyDescription: Why the failure happened and what to change.
- modifiedContextPatch: JSON object to merge into the mission context.
- recommendedModelId: Best model for this specific task.
- proposedCode: (Optional) If the failure is logic-based, provide an improved Javascript snippet for the skill.`;

    const userPrompt = `
Skill Name: ${skill.name}
Original Config: ${JSON.stringify((skill.metadata as any)?.config || {})}
Failures: ${JSON.stringify(failures.map((f: any) => f.attributes))}
TrustGraph Context: ${JSON.stringify(contextData)}

Synthesize the evolution path.`;

    // 5. Call AI using system-configured provider
    const aiClient = AIClientFactory.getClient({ provider, baseUrl } as any);
    const response = await aiClient.execute(
      { model, systemPrompt, userPrompt, useCache: false, provider, baseUrl } as any,
      userPrompt,
      apiKey,
    );

    if (!response.success || !response.output) {
      throw new Error(`AI Synthesis failed: ${response.error}`);
    }

    try {
      // Strip markdown fences if present (common with Ollama/Gemini outputs)
      const cleaned = response.output.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const result = JSON.parse(cleaned);
      return {
        skillId,
        strategyDescription: result.strategyDescription || "Autonomous refinement based on failure patterns.",
        modifiedContext: result.modifiedContextPatch || {},
        recommendedModelId: result.recommendedModelId || model,
        newVersion: `${(skill.metadata as any)?.version || "1.0"}.evolved.${Date.now()}`,
        proposedCode: result.proposedCode,
      };
    } catch (err) {
      logger.error("Failed to parse AI evolution proposal", err);
      // Fallback proposal
      return {
        skillId,
        strategyDescription: "Basic retry with increased temperature (fallback strategy).",
        modifiedContext: { temperature: 0.8 },
        recommendedModelId: model,
        newVersion: "v_fallback",
      };
    }
  }

  /**
   * Synthesize an automated, reusable skill directly from verified Human-In-The-Loop
   * operator interventions, corrections, and approval overrides.
   *
   * Pipes human corrections (modifiedOutput, comments, parameter overrides) through
   * the AI synthesis engine to generate production-ready executable code and records
   * linear version history snapshot under source: 'hil_synthesis'.
   */
  async synthesizeFromIntervention(
    options: SynthesizeFromInterventionOptions,
  ): Promise<SynthesizedSkillResult> {
    if (options.organizationId == null) {
      throw new BadRequestError("organizationId is required for skill synthesis");
    }

    if (!options.approvalRequestId && !options.missionRunId) {
      throw new BadRequestError("Either approvalRequestId or missionRunId must be specified for skill synthesis");
    }

    let approval: any = null;
    let run: any = null;

    // 1. Resolve Approval Context
    if (options.approvalRequestId) {
      const [foundApproval] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, options.approvalRequestId))
        .limit(1);

      if (!foundApproval) {
        throw new NotFoundError(`Approval request #${options.approvalRequestId} not found`);
      }

      if (foundApproval.organizationId !== null && foundApproval.organizationId !== options.organizationId) {
        throw new ForbiddenError(`Approval request #${options.approvalRequestId} belongs to another organization`);
      }

      approval = foundApproval;
    }

    // 2. Resolve Mission Run Context
    if (options.missionRunId) {
      const [foundRun] = await db
        .select()
        .from(missionRuns)
        .where(eq(missionRuns.id, options.missionRunId))
        .limit(1);

      if (!foundRun) {
        throw new NotFoundError(`Mission run #${options.missionRunId} not found`);
      }

      if (foundRun.organizationId !== null && foundRun.organizationId !== options.organizationId) {
        throw new ForbiddenError(`Mission run #${options.missionRunId} belongs to another organization`);
      }

      run = foundRun;

      // If approval was not explicitly specified, find most recent approval linked to run
      if (!approval && run.missionId) {
        const [linkedApproval] = await db
          .select()
          .from(approvalRequests)
          .where(and(
            eq(approvalRequests.missionId, run.missionId),
            eq(approvalRequests.organizationId, options.organizationId),
          ))
          .orderBy(desc(approvalRequests.createdAt))
          .limit(1);

        if (linkedApproval) {
          approval = linkedApproval;
        }
      }
    }

    const toolName = approval?.toolName || "agent_intervention";
    const originalToolArgs = approval?.toolArgs || {};
    const modifiedOutput = approval?.modifiedOutput || {};
    const operatorComments = approval?.comments || "";
    const selectionList = approval?.selectionList || [];
    const missionName = run?.name || "Autonomous Mission";
    const dynamicTrace = Array.isArray(run?.dynamicTrace) ? run.dynamicTrace.slice(-10) : [];

    logger.info(
      `[SkillGenerator] Synthesizing skill from HIL intervention (tool: ${toolName}, approval: ${options.approvalRequestId || "none"}, run: ${options.missionRunId || "none"})`,
    );

    // 3. Resolve Provider & BYOK Credentials
    const aiConfig = await systemAiService.getAiConfig("copilot");
    const provider = aiConfig?.provider || process.env.AI_PROVIDER || "google";
    const model = aiConfig?.model || process.env.AI_MODEL || "gemini-2.0-flash";
    const baseUrl = aiConfig?.baseUrl;
    const orgApiKey = await resolveOrgGeminiKey(options.organizationId);
    const apiKey = orgApiKey || aiConfig?.apiKey || developmentProviderKey();

    // 4. Construct AI Prompts
    const systemPrompt = `You are the Oddjob Autonomous Skill Synthesis Engine.
Your objective is to transform verified human operator corrections, overrides, and approvals into reusable, deterministic procedural skills.
When an AI agent encountered an obstacle, ambiguity, or failure, a human operator intervened and provided the correct action, modified parameters, or override logic.

Your task is to synthesize a production-ready, reusable JavaScript skill that codifies the operator's intervention pattern. In future runs, agents will invoke this skill directly rather than escalating to human approval.

Return ONLY a valid JSON object matching this schema:
{
  "skillName": "slug_style_skill_name_without_spaces",
  "description": "Clear explanation of what the skill does and when to invoke it",
  "strategyDescription": "Explanation of how the operator's intervention was codified to prevent future escalations",
  "triggerConditions": ["Condition 1", "Condition 2"],
  "parametersSchema": {
    "type": "object",
    "properties": {
      "key": { "type": "string", "description": "Description of argument" }
    },
    "required": []
  },
  "code": "async function execute(params = {}, context = {}) {\\n  // Codified logic based on operator intervention\\n  return { success: true, result: ... };\\n}\\nmodule.exports = { execute };"
}`;

    const userPrompt = `
Intervention Data:
- Tool Name: ${toolName}
- Agent Proposed Args: ${JSON.stringify(originalToolArgs, null, 2)}
- Human Operator Corrected Output / Payload: ${JSON.stringify(modifiedOutput, null, 2)}
- Operator Comments & Instructions: ${operatorComments || "No comment supplied"}
- Selected Items: ${JSON.stringify(selectionList, null, 2)}
- Mission Name: ${missionName}
- Recent Mission Trace: ${JSON.stringify(dynamicTrace, null, 2)}
${options.customInstructions ? `- Custom Instructions: ${options.customInstructions}` : ""}

Synthesize the autonomous skill JSON object now.`;

    let parsed: {
      skillName?: string;
      description?: string;
      strategyDescription?: string;
      triggerConditions?: string[];
      parametersSchema?: Record<string, any>;
      code?: string;
    } = {};

    try {
      const aiClient = AIClientFactory.getClient({ provider, baseUrl } as any);
      const response = await aiClient.execute(
        { model, systemPrompt, userPrompt, useCache: false, provider, baseUrl } as any,
        userPrompt,
        apiKey,
      );

      if (response.success && response.output) {
        const cleaned = response.output.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        parsed = JSON.parse(cleaned);
      }
    } catch (err) {
      logger.warn("[SkillGenerator] AI synthesis encountered an error; falling back to deterministic template", undefined, err);
    }

    // 5. Build Final Synthesis Properties (with robust fallbacks)
    const baseSlug = (options.skillName || parsed.skillName || `hil_${toolName}_resolution`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50);

    const description =
      parsed.description ||
      `Autonomously synthesized skill from human operator intervention on tool '${toolName}'.`;

    const strategyDescription =
      parsed.strategyDescription ||
      `Codified human override (${operatorComments ? `"${operatorComments}"` : "parameter correction"}) into automated execution handler.`;

    const triggerConditions = Array.isArray(parsed.triggerConditions) && parsed.triggerConditions.length > 0
      ? parsed.triggerConditions
      : [`When '${toolName}' encounters parameters resembling human override from approval #${options.approvalRequestId || "manual"}`];

    const parametersSchema = parsed.parametersSchema || {
      type: "object",
      properties: {
        overrides: { type: "object", description: "Optional dynamic parameter overrides" },
      },
    };

    const code =
      parsed.code ||
      `/**
 * Autonomously synthesized skill from Human-In-The-Loop intervention.
 * Tool: ${toolName}
 * Operator Rationale: ${operatorComments || "Manual correction"}
 */
async function execute(params = {}, context = {}) {
  const defaultCorrection = ${JSON.stringify(modifiedOutput || {}, null, 2)};
  const finalPayload = { ...params, ...defaultCorrection };
  
  return {
    success: true,
    data: finalPayload,
    appliedCorrection: true,
    synthesizedFrom: "hil_synthesis",
    timestamp: new Date().toISOString()
  };
}

module.exports = { execute };`;

    // 6. Ensure Unique Skill Name within Organization / System
    let finalSkillName = baseSlug;
    const existing = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.name, finalSkillName))
      .limit(1);

    if (existing.length > 0) {
      finalSkillName = `${baseSlug}_${Date.now().toString(36)}`;
    }

    // 7. Persist to `skills` Table
    const [insertedSkill] = await db
      .insert(skills)
      .values({
        name: finalSkillName,
        description,
        language: "javascript",
        code,
        isInstalled: true,
        isPublic: false,
        organizationId: options.organizationId,
        metadata: {
          synthesizedFromIntervention: true,
          source: "hil_synthesis",
          approvalRequestId: options.approvalRequestId ?? null,
          missionRunId: options.missionRunId ?? null,
          triggerConditions,
          parametersSchema,
          synthesizedAt: new Date().toISOString(),
          version: "1.0.0",
        },
      })
      .returning();

    // 8. Snapshot Linear Version History
    const [insertedVersion] = await db
      .insert(skillVersionHistory)
      .values({
        skillId: insertedSkill.id,
        code: insertedSkill.code,
        metadata: insertedSkill.metadata as Record<string, any>,
        source: "hil_synthesis",
        strategyDescription,
        promotedBy: options.userId || "operator_hil",
      })
      .returning();

    // 9. Update Approval Request to mark evolutionary link
    if (options.approvalRequestId) {
      await db
        .update(approvalRequests)
        .set({ isEvolutionary: true })
        .where(eq(approvalRequests.id, options.approvalRequestId));
    }

    logger.info(
      `[SkillGenerator] Successfully synthesized skill #${insertedSkill.id} ('${insertedSkill.name}') with version #${insertedVersion.id}`,
    );

    return {
      skill: insertedSkill,
      version: insertedVersion,
      strategyDescription,
      sourceIntervention: {
        approvalRequestId: options.approvalRequestId,
        missionRunId: options.missionRunId,
        toolName,
        operatorComments,
      },
    };
  }
}

export const skillGeneratorService = new SkillGeneratorService();
