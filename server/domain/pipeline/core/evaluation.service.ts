
import { db } from "@server/database_service.js";
import { scoringRules, scoringEvents, type ScoringRule, agentChatMessages, evaluationTestSets, evaluationTestCases, evaluationRuns, evaluationRunResults } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { agentService } from "@domain/agents/agent.service.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { fineTuningService } from "@domain/ai/core/fine-tuning.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

export const evaluationService = {
    /**
     * Evaluate an agent's response against active scoring rules.
     * Records any rule matches as scoring events.
     */
    async evaluateResponse(messageId: number, content: string, context: { jobId?: number, userId?: string } = {}) {
        try {
            // 1. Fetch active evaluation rules
            const rules = await db.select()
                .from(scoringRules)
                .where(and(
                    eq(scoringRules.enabled, true),
                    eq(scoringRules.ruleType, 'agent_evaluation')
                ));

            if (rules.length === 0) return;

            console.log(`[EvaluationService] Evaluating message ${messageId} against ${rules.length} rules.`);

            // 2. Evaluate each rule
            for (const rule of rules) {
                const isMatch = await this.checkRule(rule, content);

                if (isMatch) {
                    await this.recordMatch(messageId, rule, context);
                }
            }

        } catch (error) {
            console.error("[EvaluationService] Error evaluating response:", error);
        }
    },

    /**
     * Check if a specific rule matches the content
     */
    async checkRule(rule: ScoringRule, content: string): Promise<boolean> {
        const config = rule.evaluationConfig;
        if (!config) return false;

        try {
            switch (config.method) {
                case 'regex':
                    const regex = new RegExp(config.criteria, 'i');
                    return regex.test(content);

                case 'keyword':
                    const keywords = config.criteria.split(',').map(k => k.trim().toLowerCase());
                    const lowerContent = content.toLowerCase();
                    // Match if ANY keyword is present
                    return keywords.some(k => lowerContent.includes(k));

                case 'llm_judge':
                    return await this.evaluateWithLLM(content, config.criteria, config.model);

                default:
                    console.warn(`[EvaluationService] Unknown evaluation method: ${config.method}`);
                    return false;
            }
        } catch (e) {
            console.error(`[EvaluationService] Rule check failed for "${rule.name}":`, e);
            return false;
        }
    },

    /**
     * Use an LLM to judge the content based on criteria.
     * Criteria should be a Yes/No question or assertion.
     */
    async evaluateWithLLM(content: string, criteria: string, modelOverride?: string): Promise<boolean> {
        try {
            // Get AI Config (defaulting to a fast/cheap model if possible)
            const config = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-flash' };
            const modelToUse = modelOverride || config.model;

            const apiKey = this.resolveApiKey(config);
            const aiClient = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

            const prompt = `
            You are an impartial judge evaluating an AI Agent's response.
            
            AGENT RESPONSE:
            "${content}"
            
            EVALUATION CRITERIA:
            ${criteria}
            
            INSTRUCTIONS:
            - Determine if the response MEETS the criteria.
            - Respond with ONLY "YES" or "NO".
            `;

            const result = await aiClient.execute({
                model: modelToUse,
                userPrompt: prompt,
                temperature: 0, // Deterministic
                systemPrompt: "You are a strict evaluation engine. Output only YES or NO."
            } as any, undefined, apiKey);

            if (!result.success || !result.output) return false;

            const verdict = result.output.trim().toUpperCase();
            return verdict.includes("YES");

        } catch (error) {
            console.error("[EvaluationService] LLM Judge error:", error);
            return false;
        }
    },

    /**
     * Record a successful rule match
     */
    async recordMatch(messageId: number, rule: ScoringRule, context: any) {
        console.log(`[EvaluationService] Rule Matched: "${rule.name}" (Vector: ${rule.vector})`);

        await db.insert(scoringEvents).values({
            sessionId: context.jobId ? `job-${context.jobId}` : 'unknown',
            eventType: 'rule_match',
            ruleId: rule.id,
            actionType: rule.triggeredAction?.type || 'log_event',
            actionConfig: rule.triggeredAction?.config || {},
            vectorState: { [rule.vector]: rule.weight },
            confidence: 1.0,
            location: `message-${messageId}`,
        });

        // --- AUTO-RATING LOGIC (Closing the Loop) ---
        // If the rule indicates a positive Outcome (O), rate the message as Good (+1)
        // If the rule indicates a negative Symptom (S), rate the message as Bad (-1)

        let newRating: number | null = null;
        if (rule.vector === 'O') newRating = 1;
        if (rule.vector === 'S') newRating = -1;

        if (newRating !== null) {
            console.log(`[EvaluationService] Auto-Rating message ${messageId} as ${newRating} (Vector: ${rule.vector})`);
            await db.update(agentChatMessages)
                .set({ rating: newRating })
                .where(eq(agentChatMessages.id, messageId));
        }
    },

    resolveApiKey(config: any): string {
        let apiKey = config?.apiKey;
        if (!apiKey) {
            if (config?.provider === 'openai') apiKey = developmentProviderKey("openai");
            if (config?.provider === 'anthropic') apiKey = developmentProviderKey("anthropic");
            if (!apiKey || config?.provider === 'google') apiKey = developmentProviderKey();
        }
        return apiKey || developmentProviderKey();
    },

    /**
     * Run a test set: for each test case, call agent chat and evaluate response.
     */
    async runTestSet(testSetId: number, organizationId: number): Promise<{ runId: number }> {
        const [set] = await db.select().from(evaluationTestSets)
            .where(and(eq(evaluationTestSets.id, testSetId), eq(evaluationTestSets.organizationId, organizationId)))
            .limit(1);
        if (!set) throw new Error("Test set not found");

        // agentService.chat loads the job by id and adopts the job's own org, so
        // a set naming another tenant's job would run that tenant's agent under
        // a system context and file its answers here. Sets are checked on
        // create; this covers sets saved before that check existed.
        if (set.jobId != null) {
            const { jobUsableByOrg } = await import("./evaluation-studio.service.js");
            if (!(await jobUsableByOrg(set.jobId, organizationId))) {
                throw new Error("Test set's job is not available in this organization");
            }
        }

        const [run] = await db.insert(evaluationRuns).values({ testSetId, status: "running" }).returning();
        if (!run) throw new Error("Failed to create run");

        const cases = await db.select().from(evaluationTestCases).where(eq(evaluationTestCases.testSetId, testSetId));
        const jobId = set.jobId;

        for (const tc of cases) {
            let passed = false;
            let agentResponse = "";
            let messageId: number | undefined;

            try {
                const chatResult = await agentService.chat({
                    message: tc.inputPrompt,
                    context: {
                        jobId: jobId ?? undefined,
                        supervisionLevel: "none",
                        ...(jobId === 1 ? {
                            _assetContext: JSON.stringify({
                                assetId: "AST-001",
                                name: "Break Room Coffee Machine",
                                type: "coffee_vending",
                                building: "HQ West",
                                floor: "3rd Floor",
                                room: "Room 302",
                                lastServiceDate: "2025-11-15",
                                warrantyExpiry: "2026-06-01",
                                inventory: [
                                    { item: "Coffee Beans", stock: 100 },
                                    { item: "Oat Milk", stock: 5 },
                                    { item: "Sugar", stock: 80 }
                                ]
                            }, null, 2)
                        } : {})
                    } as any,
                    userContext: getSystemOrgContext(organizationId),
                });
                const content = (chatResult as any)?.response ?? String(chatResult);
                agentResponse = typeof content === "string" ? content : JSON.stringify(content);
                messageId = (chatResult as any)?.messageId;

                passed = await this.checkRule(
                    { name: "", evaluationConfig: { method: (tc.method || "llm_judge") as "regex" | "keyword" | "llm_judge", criteria: tc.expectedCriteria } } as ScoringRule,
                    agentResponse
                );
            } catch (e: any) {
                agentResponse = `Error: ${e.message}`;
            }

            await db.insert(evaluationRunResults).values({
                runId: run.id,
                testCaseId: tc.id,
                passed,
                agentResponse,
                messageId,
            });

            // Feed the outcome back into the fine-tuning flywheel. PASS becomes
            // an SFT golden example; FAIL with a usable expectedCriteria becomes
            // a DPO preference (chosen=expected, rejected=actual). Fire-and-forget
            // so registration failures never break the test run.
            this.feedEvalOutcomeToTraining({
                organizationId,
                jobId,
                setName: set.name,
                setId: set.id,
                inputPrompt: tc.inputPrompt,
                agentResponse,
                passed,
                expectedCriteria: tc.expectedCriteria,
                method: tc.method,
            }).catch(() => { });
        }

        await db.update(evaluationRuns).set({ status: "completed", completedAt: new Date() }).where(eq(evaluationRuns.id, run.id));
        return { runId: run.id };
    },

    /**
     * Bridge: convert an evaluation outcome into a fine-tuning sample.
     *
     * - PASS  -> registerExample (SFT). The agent answered well; learn from it.
     * - FAIL  -> registerPreference (DPO) when expectedCriteria looks like an
     *            actual reference answer (not a yes/no judge prompt). We use
     *            `method === 'regex' | 'keyword'` as a weak signal that
     *            expectedCriteria is plain text and not a judge directive.
     */
    async feedEvalOutcomeToTraining(opts: {
        organizationId: number;
        jobId: number | null;
        setName: string;
        setId: number;
        inputPrompt: string;
        agentResponse: string;
        passed: boolean;
        expectedCriteria: string;
        method: string | null;
    }) {
        const agentTag = opts.jobId ? `job:${opts.jobId}` : "job:none";
        const setTag = `eval:set:${opts.setId}`;
        const datasetName = `Eval Feedback - ${opts.setName}`;

        if (opts.passed) {
            await fineTuningService.registerExample(
                datasetName,
                {
                    input: opts.inputPrompt,
                    output: opts.agentResponse,
                    inputContext: { source: "eval", setId: opts.setId },
                    tags: [agentTag, setTag, "eval:passed"],
                    humanConfidence: 90, // automated golden; high but not perfect
                    sourceJobId: opts.jobId ?? undefined,
                },
                opts.organizationId,
            );
            return;
        }

        // FAIL path - only when expectedCriteria is a usable answer, not an
        // llm_judge directive that says "the answer mentions X".
        const usableAsChosen = (opts.method === "regex" || opts.method === "keyword")
            && opts.expectedCriteria
            && opts.expectedCriteria.length > 0
            && opts.expectedCriteria !== opts.agentResponse;
        if (!usableAsChosen) return;

        await fineTuningService.registerPreference(
            datasetName,
            {
                prompt: opts.inputPrompt,
                chosenResponse: opts.expectedCriteria,
                rejectedResponse: opts.agentResponse,
                humanConfidence: 75,
                sourceJobId: opts.jobId ?? undefined,
            },
            opts.organizationId,
        );
    },

    /**
     * Get results for an evaluation run.
     */
    async getRunResults(runId: number, organizationId: number) {
        const [run] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)).limit(1);
        if (!run) return [];

        const [set] = await db.select().from(evaluationTestSets)
            .where(and(eq(evaluationTestSets.id, run.testSetId), eq(evaluationTestSets.organizationId, organizationId)))
            .limit(1);
        if (!set) return [];

        const results = await db.select().from(evaluationRunResults).where(eq(evaluationRunResults.runId, runId));
        const cases = await db.select().from(evaluationTestCases).where(eq(evaluationTestCases.testSetId, run.testSetId));
        const caseMap = Object.fromEntries(cases.map((c) => [c.id, c]));

        return results.map((r) => ({
            ...r,
            testCase: caseMap[r.testCaseId],
        }));
    },

    /**
     * Fetch recent negative feedback for the feedback loop.
     */
    async getNegativeFeedback(limit: number = 20) {
        const negativeMessages = await db.select({
            id: agentChatMessages.id,
            content: agentChatMessages.content,
            feedback: agentChatMessages.feedback,
            feedbackReason: agentChatMessages.feedbackReason,
            jobId: agentChatMessages.jobId,
            createdAt: agentChatMessages.createdAt
        })
            .from(agentChatMessages)
            .where(eq(agentChatMessages.rating, -1))
            .orderBy(desc(agentChatMessages.createdAt))
            .limit(limit);

        return negativeMessages;
    },

    /**
     * Get a high-level summary of an evaluation run.
     */
    async getRunSummary(runId: number) {
        const results = await db.select().from(evaluationRunResults).where(eq(evaluationRunResults.runId, runId));
        const total = results.length;
        const passed = results.filter(r => r.passed).length;
        const failed = total - passed;
        const passRate = total > 0 ? (passed / total) * 100 : 0;

        return {
            runId,
            total,
            passed,
            failed,
            passRate: parseFloat(passRate.toFixed(2)),
            results
        };
    }
};


