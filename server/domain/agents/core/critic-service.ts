
import { db } from "@server/database_service.js";
import { agentCritiques } from "@shared/schema/agent/critiques.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { desc, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { ORG_AI_KEY_MISSING, resolveOrgTextAiKey } from "@domain/ai/core/org-gemini-key.js";

// Zod Schema for Structured Output
const AssessmentSchema = z.object({
    score: z.number().min(0).max(10),
    criticism: z.string(),
    issues: z.array(z.string()),
    correction: z.string().optional()
});

export class CriticService {
    private client = AIClientFactory.getClient({ provider: "google" }); // Force Gemini for Gemini-like intelligence :)

    /**
     * Analyze a User/Agent interaction and store the critique.
     * @param interactionId - ID of the chat message or run
     * @param userQuery - The original prompt
     * @param agentResponse - The answer to critique
     * @param retrievedContext - Optional context snippet used by agent
     */
    async assessInteraction(interactionId: number, userQuery: string, agentResponse: string, retrievedContext?: string) {
        try {
            console.log(`[Critic] Assessing interaction #${interactionId}...`);

            const prompt = `
                Role: Expert AI Quality Assurance Auditor.
                Task: Critically review the following Agent interaction.
                
                Input:
                - User Query: "${userQuery}"
                - Agent Response: "${agentResponse}"
                ${retrievedContext ? `- Context Used: "${retrievedContext.substring(0, 500)}..."` : ""}

                General Criteria:
                1. Accuracy: specific hallucinated facts?
                2. Relevance: Did it answer the specific question?
                3. Stale Data: Did it cite old info (check dates if visible)?

                UI-RENDER Criteria — if the Agent Response contains a rendered UI (JSON with "type":"instant_app", "instant_app_surface", or "assistant_form", OR prose describing an assembled app/form/dashboard/calculator), these DOMINATE the score for that response:
                4. Interaction match: does the chosen block match what the user will DO? An INPUT task (form, CALCULATOR, data-entry) rendered as a read-only DISPLAY block (Metric Grid, table, timeline) is a SEVERE failure → score <= 3, issue "Wrong-Block-Kind". Calculators should use an assistant_form / render_intake_form with number + computed (formula) fields.
                5. Populated: will every tile show real content, or empty/zeros/error tiles? Empty tiles → "Empty-Tiles".
                6. Honesty: does the prose claim controls (inputs, buttons, live calculation) the render does NOT actually have? → "Fabricated-Controls".
                7. Clarify-first: was the request vague enough (e.g. "build me an app", "a calculator" of what?) that a clarifying question should have been asked BEFORE rendering a guess? → "Should-Have-Clarified".
                8. Usability: short labels, readable in the narrow single-column chat sheet? → "Poor-Layout".

                Output JSON ONLY:
                {
                    "score": <0-10>,
                    "criticism": "<concise, specific — name the block and the concrete fix>",
                    "issues": ["Hallucination", "Off-Topic", "Stale Data", "Vague", "Wrong-Block-Kind", "Empty-Tiles", "Fabricated-Controls", "Should-Have-Clarified", "Poor-Layout", "Perfect"],
                    "correction": "<the better render/approach if score < 8, e.g. 'Use render_intake_form with number inputs + computed formula fields for the tip calculator'>"
                }
            `;

            const apiKey = await resolveOrgTextAiKey(null);
            if (!apiKey) {
                console.warn(`[Critic] Skipping assessment: ${ORG_AI_KEY_MISSING}.`);
                return;
            }

            const result = await this.client.execute({
                model: "gemini-1.5-flash", // Stable model
                userPrompt: prompt,
                temperature: 0,
                requestType: "json",
                useCache: false,
                credentialId: 0, // Dummy ID since we provide apiKey directly
                enableQueryExpansion: false,
                saveOutputToFile: false,
            }, undefined, apiKey);

            if (!result.success || !result.output) {
                console.warn("[Critic] AI check failed:", result.error);
                return;
            }

            // Parse valid JSON
            const data = JSON.parse(result.output);
            const assessment = AssessmentSchema.parse(data);

            // Store in DB
            await db.insert(agentCritiques).values({
                interactionId: interactionId > 0 ? interactionId : 0,
                criticism: assessment.criticism,
                score: assessment.score, // DB uses integer
                issues: assessment.issues,
                correction: assessment.correction
            });

            console.log(`[Critic] Assessment saved. Score: ${assessment.score}/10. Issues: ${assessment.issues.join(", ")}`);
            return assessment;

        } catch (error) {
            console.error("[Critic] Failed to assess interaction:", error);
            return null;
        }
    }

    /**
     * Retrieve past low-scoring critiques relevant to the current query.
     * Uses keyword overlap against stored criticism text to surface actionable lessons.
     */
    async getRelevantCritiques(query: string, limit = 3): Promise<Array<{ score: number; criticism: string; issues: string[]; correction?: string }>> {
        try {
            // Fetch recent low-scoring critiques (score <= 6 out of 10)
            const recent = await db
                .select({
                    score: agentCritiques.score,
                    criticism: agentCritiques.criticism,
                    issues: agentCritiques.issues,
                    correction: agentCritiques.correction,
                })
                .from(agentCritiques)
                .where(lte(agentCritiques.score, 6))
                .orderBy(desc(agentCritiques.createdAt))
                .limit(50);

            if (recent.length === 0) return [];

            // Keyword-match: score by how many query words appear in the criticism text
            const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
            const scored = recent.map(c => {
                const text = (c.criticism || "").toLowerCase();
                const hits = queryWords.filter(w => text.includes(w)).length;
                return { ...c, hits };
            });

            return scored
                .filter(c => c.hits > 0)
                .sort((a, b) => b.hits - a.hits)
                .slice(0, limit)
                .map(({ hits, issues, correction, ...rest }) => ({
                    ...rest,
                    issues: Array.isArray(issues) ? (issues as string[]) : [],
                    correction: correction || undefined
                }));
        } catch (err) {
            console.warn("[Critic] Failed to fetch relevant critiques:", err);
            return [];
        }
    }
    /**
     * Get a summary of recent critiques for reporting.
     */
    async getCritiqueSummary(limit = 10) {
        try {
            const results = await db.select()
                .from(agentCritiques)
                .orderBy(desc(agentCritiques.createdAt))
                .limit(limit);

            const avgScore = results.length > 0 
                ? results.reduce((acc, curr: any) => acc + curr.score, 0) / results.length 
                : 0;

            const commonIssues = new Set<string>();
            results.forEach(r => {
                if (Array.isArray(r.issues)) {
                    r.issues.forEach(i => commonIssues.add(i));
                }
            });

            return {
                avgScore: parseFloat(avgScore.toFixed(2)),
                totalAssessed: results.length,
                commonIssues: Array.from(commonIssues),
                recent: results.map((r: any) => ({
                    score: r.score,
                    criticism: r.criticism,
                    issues: r.issues
                }))
            };
        } catch (err) {
            console.warn("[Critic] Failed to get critique summary:", err);
            return null;
        }
    }
}

export const criticService = new CriticService();


