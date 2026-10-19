
import { db } from "@server/database_service.js";
import {
    missionRuns,
    missionSuggestions,
    missionRetrospectives,
    pipelineExecutions,
    pipelineStepExecutions,
    forensicEventLog,
    missions,
    PipelineStepExecution,
    ForensicEvent
} from "@shared/schema/index.js";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("MissionAnalystService");

/**
 * Filter out obvious CSS/JS noise from text snippets
 */
function cleanSnippet(text: string | null | undefined): string {
    if (!text) return "";
    let clean = text;
    // Remove CSS-like blocks: .name { ... }
    clean = clean.replace(/\.[a-zA-Z0-9_\-]+\s*\{[^}]+\}/g, " ");
    // Remove @media blocks
    clean = clean.replace(/@media[^{]+\{[^}]+\}/g, " ");
    // Remove extra whitespace
    clean = clean.replace(/\s+/g, " ").trim();
    return clean.substring(0, 800);
}

export class MissionAnalystService {
    /**
     * Analyze a mission run and generate suggestions for improvement.
     */
    static async analyzeMissionRun(missionRunId: number, orgId?: number) {
        logger.info(`[MissionAnalyst] Analyzing mission run ${missionRunId}`);

        // 1. Fetch relevant data
        const [missionRun] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!missionRun) throw new Error("Mission run not found");

        const [mission] = await db.select().from(missions).where(eq(missions.id, missionRun.missionId!)).limit(1);

        let lastExec: any = null;
        let execs: any[] = [];

        // Prioritize the specific execution attached to this run
        if (missionRun.pipelineExecutionId) {
            const [exactExec] = await db.select().from(pipelineExecutions)
                .where(eq(pipelineExecutions.id, missionRun.pipelineExecutionId))
                .limit(1);
            if (exactExec) {
                lastExec = exactExec;
                execs = [exactExec];
            }
        }

        // Fallback to recent mission history if specific run exec is not found
        if (!lastExec && missionRun.missionId) {
            execs = await db.select().from(pipelineExecutions)
                .where(eq(pipelineExecutions.missionId, missionRun.missionId))
                .orderBy(desc(pipelineExecutions.startedAt))
                .limit(5);
            lastExec = execs[0];
        }

        let steps: PipelineStepExecution[] = [];
        let logs: ForensicEvent[] = [];

        if (lastExec) {
            steps = await db.select().from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, lastExec.id))
                .orderBy(pipelineStepExecutions.stepOrder);

            if (lastExec.traceId) {
                logs = await db.select().from(forensicEventLog)
                    .where(eq(forensicEventLog.traceId, lastExec.traceId))
                    .limit(50);
            }
        }

        // 2. Prepare context for AI
        const contextData = {
            missionName: missionRun.name,
            objective: mission?.objective,
            status: missionRun.status,
            executionHistory: execs.map(e => ({
                id: e.id,
                status: e.status,
                error: e.error,
                startedAt: e.startedAt
            })),
            steps: steps.map(s => ({
                order: s.stepOrder,
                jobId: s.jobId,
                status: s.status,
                error: s.error,
                outputSnippet: cleanSnippet(s.output)
            })),
            recentLogs: logs.map(l => ({
                status: l.status,
                message: l.errorMessage || (l.attributes as any)?.message,
                jobType: l.jobType
            }))
        };

        // Sanitization Middleware: Redact technical noise for strategic analysis
        let contextJson = JSON.stringify(contextData, null, 2);
        const technicalLeakRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
        const databaseIdRegex = /\b(id|uuid|key):?\s*[a-z0-9_-]{20,}\b/gi;

        contextJson = contextJson.replace(technicalLeakRegex, "[REDACTED-UUID]");
        contextJson = contextJson.replace(databaseIdRegex, (match) => {
            const prefix = match.split(':')[0];
            return `${prefix}: [REDACTED-ID]`;
        });

        // 3. Call AI for Analysis
        const aiConfig = await systemAiService.getAiConfig('copilot', orgId);
        if (!aiConfig || !aiConfig.apiKey) {
            logger.warn("No AI config for analyst");
            return [];
        }

        const model = "gemini-1.5-pro";
        const client = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);

        const prompt = `
You are a "Mission Analyst Agent". Your goal is to conduct a forensic review of a completed (or failed) mission run and provide actionable suggestions for the next iteration.

MISSION CONTEXT:
${contextJson}

FOCUS AREAS:
1. **Error Mitigation**: Why did it fail? How can we prevent it (e.g., more robust error handling, different temperature, retries)?
2. **Tool Choice Selection**: Were the right tools/agents used? Would a different agent be better?
3. **Mission Quality**: How was the output quality? Was it complete?
4. **Mission Performance**: Cost and latency analysis.

For each suggestion, provide:
- type: one of 'error_mitigation', 'tool_choice', 'quality', 'performance'
- title: Short descriptive title
- content: Detailed explanation and reasoning
- suggestedAction: A JSON object describing the fix. Supported types:
    * { "type": "update_objective", "value": "New mission goal" }
    * { "type": "add_step", "jobId": NUMBER_ID, "name": "Step Name" }
    * { "type": "update_step", "stepId": NUMBER_ID, "runOnCondition": "always" }
    * { "type": "update_blackboard", "key": "remediation_config", "value": { ... } }
    * { "type": "checkpoint", "name": "Decision Point", "reason": "..." }

Return ONLY a JSON array of suggestions.
`;

        const res = await client.execute({
            model: aiConfig.model || "gemini-1.5-pro",
            systemPrompt: "You are a mission optimization expert. Output ONLY valid JSON array.",
            userPrompt: prompt,
            requestType: "json"
        } as any, undefined, aiConfig.apiKey);

        if (!res.success || !res.output) {
            throw new Error(`Analyst failed: ${res.error}`);
        }

        let suggestions: any[] = [];
        try {
            const cleanOutput = res.output.replace(/```json\s*|```/g, '').trim();
            const parsed = JSON.parse(cleanOutput);
            if (Array.isArray(parsed)) {
                suggestions = parsed;
            } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).suggestions)) {
                suggestions = (parsed as any).suggestions;
            } else if (parsed && typeof parsed === 'object') {
                // If it's just one object, wrap it
                suggestions = [parsed];
            }
        } catch (e) {
            logger.error(`Failed to parse analyst output primary: ${res.output.slice(0, 200)}...`);
            // Fallback attempt to find array in text
            const match = res.output.match(/\[\s*\{.*\}\s*\]/s);
            if (match) {
                try {
                    suggestions = JSON.parse(match[0]);
                } catch (e2) {
                    throw new Error("Could not parse analyst suggestions from AI response.");
                }
            } else {
                // Last ditch: try to find any object
                const objMatch = res.output.match(/\{.*\}/s);
                if (objMatch) {
                    try {
                        const obj = JSON.parse(objMatch[0]);
                        suggestions = Array.isArray(obj) ? obj : [obj];
                    } catch (e3) {
                        throw new Error("AI Analyst did not return a valid JSON structure.");
                    }
                } else {
                    throw new Error("AI Analyst did not return any recognizable JSON.");
                }
            }
        }

        // 4. Save suggestions to DB
        const savedSuggestions = [];
        for (const s of suggestions) {
            const title = s.title || s.Title || 'Analyst Suggestion';
            
            // DE-DUPLICATION: Avoid flooding with identical pending suggestions for this run
            const existing = await db.query.missionSuggestions.findFirst({
                where: and(
                    eq(missionSuggestions.missionRunId, missionRun.id),
                    eq(missionSuggestions.title, title),
                    eq(missionSuggestions.status, 'pending')
                )
            });

            if (existing) {
                logger.debug(`[MissionAnalyst] Skipping duplicate pending suggestion for run ${missionRun.id}: ${title}`);
                continue;
            }

            const [saved] = await db.insert(missionSuggestions).values({
                missionId: missionRun.missionId!,
                missionRunId: missionRun.id,
                type: s.type || s.Type || 'quality',
                title: title,
                content: s.content || s.Content || '',
                suggestedAction: s.suggestedAction || s.suggested_action || s.SuggestedAction,
                status: 'pending'
            }).returning();
            savedSuggestions.push(saved);
        }

        return savedSuggestions;
    }

    /**
     * Generates a retrospective for a completed or failed mission run.
     */
    static async generateRetrospective(missionRunId: number, organizationId?: number) {
        try {
            logger.info(`Starting retrospective for mission run ${missionRunId}`);

            const runResult = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId));

            if (runResult.length === 0) {
                throw new Error(`Mission run ${missionRunId} not found`);
            }

            const run = runResult[0];

            if (run.status !== 'completed' && run.status !== 'failed') {
                logger.warn(`Mission run ${missionRunId} is not finished (status: ${run.status}). Skipping retrospective.`);
                return { success: false, reason: "Run not finished" };
            }

            // In a full implementation, we would gather:
            // 1. Tool execution analytics
            // 2. The event stream for this run
            // 3. Blackboard state
            const summaryContext = JSON.stringify(run.missionContext || {});

            // Call LLM to evaluate the mission
            const aiConfig = await systemAiService.getAiConfig("copilot") || { provider: "google", model: "gemini-1.5-pro", apiKey: developmentProviderKey() };
            const aiClient = AIClientFactory.getClient(aiConfig as any);

            const prompt = `
      You are the Chief Mission Analyst. Evaluate the following mission run data and output a structured retrospective JSON.
      
      Mission Name: ${run.name}
      Final Status: ${run.status}
      Context/State:
      ${summaryContext}

      Respond strictly with JSON in the following format:
      {
        "successScore": 0-100,
        "budgetEfficiency": 0.0-1.0,
        "timeEfficiency": 0.0-1.0,
        "anomaliesEncountered": ["issue 1", "issue 2"],
        "learnedContext": [{"pattern": "...", "heuristic": "..."}]
      }
      `;

            let analysisResult;
            try {
                const result = await aiClient.execute({
                    model: aiConfig.model,
                    systemPrompt: "You are an analytical AI that strictly outputs JSON retrospectives.",
                    userPrompt: prompt,
                    responseFormat: "json_object"
                } as any, undefined, aiConfig.apiKey as string);

                if (result.success && result.output) {
                    analysisResult = JSON.parse(result.output);
                } else {
                    throw new Error("AI evaluation failed");
                }
            } catch (err) {
                logger.error("Failed to parse LLM response", { error: err });
                // Fallback dummy data if LLM parsing fails
                analysisResult = {
                    successScore: run.status === 'completed' ? 100 : 0,
                    budgetEfficiency: 1.0,
                    timeEfficiency: 1.0,
                    anomaliesEncountered: ["Failed to generate deep analysis"],
                    learnedContext: []
                };
            }

            // Save to database
            const [retro] = await db.insert(missionRetrospectives).values({
                missionRunId: run.id,
                successScore: analysisResult.successScore || 0,
                budgetEfficiency: (analysisResult.budgetEfficiency || 1.0).toString(),
                timeEfficiency: (analysisResult.timeEfficiency || 1.0).toString(),
                anomaliesEncountered: analysisResult.anomaliesEncountered || [],
                learnedContext: analysisResult.learnedContext || [],
                analyzedBy: "mission-analyst-agent"
            }).returning();

            logger.info(`Saved retrospective for mission run ${run.id}`);
            return { success: true, retrospectiveId: retro.id };

        } catch (error: any) {
            logger.error(`Failed to generate retrospective for mission run ${missionRunId}`, { error });
            return { success: false, error: error.message };
        }
    }

    /**
     * Apply a suggestion to the mission.
     * Delegates to suggestionApplyService for full action dispatch.
     */
    static async applySuggestion(suggestionId: number) {
        const { suggestionApplyService } = await import("./suggestion-apply.service.js");
        return await suggestionApplyService.apply(suggestionId);
    }

    static async listSuggestions(missionId: number) {
        return await db.select().from(missionSuggestions)
            .where(eq(missionSuggestions.missionId, missionId))
            .orderBy(desc(missionSuggestions.createdAt));
    }

    static async dismissSuggestion(suggestionId: number) {
        await db.update(missionSuggestions)
            .set({ status: 'dismissed' })
            .where(eq(missionSuggestions.id, suggestionId));
        return { success: true };
    }

    /**
     * Compatibility wrapper for AuditWorker.
     * Conducts a full mission run analysis and formats it for the forensic audit log.
     */
    static async analyzeTrace(missionRunId: number, trace: any[]) {
        logger.info(`[MissionAnalyst] Audit-triggered analysis for Run ${missionRunId}`);
        const suggestions = await this.analyzeMissionRun(missionRunId);
        
        return {
            summary: `Audit complete. Identified ${suggestions.length} optimization patterns.`,
            rootCause: suggestions.find(s => s.type === 'error_mitigation')?.content || "No major execution roadblocks identified.",
            suggestions
        };
    }

    /**
     * Evaluates the clarity of a mission objective using SMART criteria.
     * Returns a score (0-100) and specific feedback.
     */
    static async validateObjectiveClarity(objective: string, orgId?: number) {
        if (!objective || objective.length < 10) {
            return { score: 0, feedback: "Objective is too short or missing." };
        }

        const aiConfig = await systemAiService.getAiConfig('copilot', orgId);
        if (!aiConfig || !aiConfig.apiKey) {
            return { score: 80, feedback: "AI validation unavailable. Using default safety score." };
        }

        const aiClient = AIClientFactory.getClient(aiConfig as any);
        const prompt = `
Evaluate the following mission objective using SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound).
Objective: "${objective}"

Return ONLY a JSON object:
{
  "score": 0-100,
  "isSmart": boolean,
  "feedback": "...",
  "suggestions": ["suggestion 1", ...]
}
`;

        // 30s Timeout Wrapper
        const timeoutPromise = new Promise<{ score: number, feedback: string }>((resolve) => {
            setTimeout(() => resolve({ score: 70, feedback: "Validation timed out. Proceeding with caution." }), 30000);
        });

        const executionPromise = (async () => {
            const res = await aiClient.execute({
                model: aiConfig.model || "gemini-1.5-flash",
                systemPrompt: "You are an objective alignment specialist. Output ONLY valid JSON.",
                userPrompt: prompt,
                requestType: "json"
            } as any, undefined, aiConfig.apiKey ?? "");

            if (!res.success || !res.output) {
                return { score: 50, feedback: "Failed to evaluate objective clarity." };
            }

            try {
                return JSON.parse(res.output.replace(/```json\s*|```/g, '').trim());
            } catch {
                return { score: 50, feedback: "Invalid evaluation response structure." };
            }
        })();

        return await Promise.race([executionPromise, timeoutPromise]);
    }
}

export const missionAnalystService = MissionAnalystService;


