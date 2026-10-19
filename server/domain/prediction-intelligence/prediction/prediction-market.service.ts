import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { llmRouterService } from "@server/domain/ai/core/llm-router.service.js";
import { fineTuningDatasets, fineTuningPreferences } from "@shared/schema/training.js";
import { and, eq } from "drizzle-orm";

const logger = createLogger("PredictionMarket");

export interface PersonaPrediction {
    persona: "analytical" | "optimistic" | "pessimistic";
    probability: number;
    confidence: number;
    reasoning: string;
    rawResponse: string;
}

export interface ActiveMarket {
    marketId: string; // matches candidateId
    prompt: string;
    datasetId?: number;
    jobId?: number;
    orgId?: number;
    predictions: PersonaPrediction[];
    variance: number;
    stdDev: number;
    isHighVariance: boolean;
    createdAt: Date;
}

class PredictionMarketService {
    private activeMarkets = new Map<string, ActiveMarket>();

    /**
     * Run a multi-agent prediction market for a candidate predicate or blueprint
     */
    async runMarket(
        candidateId: string,
        prompt: string,
        options?: { datasetId?: number; jobId?: number; orgId?: number }
    ): Promise<ActiveMarket> {
        logger.info(`[PredictionMarket] Spawning prediction jury for candidate: ${candidateId}`);

        const personas = [
            {
                name: "analytical" as const,
                systemPrompt: `You are an analytical and cautious shadow agent. Your job is to predict the success of this mission candidate based on the objective. Be extremely critical, watch for resource limits, type safety, and potential edge cases. 
You must output a valid JSON object ONLY, with no other text, comments or markdown backticks, conforming to the schema:
{
  "successProbability": <0.0 to 1.0>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<detailed analysis>"
}`
            },
            {
                name: "optimistic" as const,
                systemPrompt: `You are an optimistic shadow agent. Your job is to predict the success of this mission candidate based on the objective. Focus on how the happy path works, the strength of the design, and its success potential. 
You must output a valid JSON object ONLY, with no other text, comments or markdown backticks, conforming to the schema:
{
  "successProbability": <0.0 to 1.0>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<detailed analysis>"
}`
            },
            {
                name: "pessimistic" as const,
                systemPrompt: `You are a pessimistic shadow agent. Your job is to predict the success of this mission candidate based on the objective. Focus entirely on what could go wrong: API failures, timeouts, lack of validation, and edge case bugs. 
You must output a valid JSON object ONLY, with no other text, comments or markdown backticks, conforming to the schema:
{
  "successProbability": <0.0 to 1.0>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<detailed analysis>"
}`
            }
        ];

        const predictions: PersonaPrediction[] = [];

        // Run the 3 personas in parallel
        await Promise.all(
            personas.map(async (p) => {
                try {
                    const response = await llmRouterService.complete({
                        messages: [
                            { role: "system", content: p.systemPrompt },
                            { role: "user", content: `Mission Objective / Request: ${prompt}` }
                        ],
                        temperature: 0.2,
                        jsonMode: true,
                        routingStrategy: "cost" // use cheap models for shadow verification
                    }, options?.orgId);

                    let parsed: { successProbability?: number; confidence?: number; reasoning?: string } = {};
                    try {
                        const { safeJsonParse } = await import("@server/utils/json-repair.js");
                        parsed = safeJsonParse(response.content);
                    } catch (e) {
                        const match = response.content.match(/\{[\s\S]*\}/);
                        if (match) parsed = JSON.parse(match[0]);
                    }

                    predictions.push({
                        persona: p.name,
                        probability: typeof parsed.successProbability === "number" ? parsed.successProbability : 0.5,
                        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
                        reasoning: parsed.reasoning || "Could not parse reasoning from model response",
                        rawResponse: response.content
                    });
                } catch (err: any) {
                    logger.error(`[PredictionMarket] Persona ${p.name} failed to predict: ${err.message}`);
                    predictions.push({
                        persona: p.name,
                        probability: 0.5,
                        confidence: 0.3,
                        reasoning: `Failure in prediction LLM invocation: ${err.message}`,
                        rawResponse: ""
                    });
                }
            })
        );

        // Calculate variance (standard deviation)
        const probs = predictions.map(p => p.probability);
        const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
        const variance = probs.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / probs.length;
        const stdDev = Math.sqrt(variance);
        const isHighVariance = stdDev > 0.15; // Threshold for disagreement (e.g., [0.9, 0.5, 0.2] has stdDev ~0.28)

        if (isHighVariance) {
            logger.warn(`[PredictionMarket] High prediction variance (${stdDev.toFixed(3)}) detected for candidate ${candidateId}. Flagging as High Value Training Example.`);
        }

        const market: ActiveMarket = {
            marketId: candidateId,
            prompt,
            datasetId: options?.datasetId,
            jobId: options?.jobId,
            orgId: options?.orgId,
            predictions,
            variance,
            stdDev,
            isHighVariance,
            createdAt: new Date()
        };

        this.activeMarkets.set(candidateId, market);
        return market;
    }

    /**
     * Resolve the prediction market once ground truth is collected
     */
    async resolveMarket(candidateId: string, actualSuccess: boolean): Promise<void> {
        const market = this.activeMarkets.get(candidateId);
        if (!market) {
            logger.warn(`[PredictionMarket] Active market not found for candidate ${candidateId}`);
            return;
        }

        logger.info(`[PredictionMarket] Resolving market for ${candidateId}. Actual success: ${actualSuccess}`);

        const targetValue = actualSuccess ? 1.0 : 0.0;

        // Winner has lowest absolute error
        const winner = market.predictions.reduce((best, curr) => 
            Math.abs(curr.probability - targetValue) < Math.abs(best.probability - targetValue) ? curr : best
        );

        // Loser has highest absolute error
        const loser = market.predictions.reduce((worst, curr) => 
            Math.abs(curr.probability - targetValue) > Math.abs(worst.probability - targetValue) ? curr : worst
        );

        logger.info(`[PredictionMarket] Winner: ${winner.persona} (prob: ${winner.probability}), Loser: ${loser.persona} (prob: ${loser.probability})`);

        // If it was flagged as high-variance, record it as a DPO preference
        if (market.isHighVariance) {
            try {
                // Resolve dataset name
                const datasetName = market.jobId 
                    ? `Agent ${market.jobId} Specialized Dataset`
                    : `Global Prediction Market Dataset`;

                const orgId = market.orgId ?? 0;
                let [dataset] = await db.select().from(fineTuningDatasets)
                    .where(and(eq(fineTuningDatasets.name, datasetName), eq(fineTuningDatasets.organizationId, orgId)))
                    .limit(1);

                if (!dataset) {
                    [dataset] = await db.insert(fineTuningDatasets).values({
                        name: datasetName,
                        description: market.jobId 
                            ? `Automatically generated training data for Agent ${market.jobId}`
                            : `Global prediction market training data`,
                        organizationId: market.orgId || null
                    }).returning();
                }

                // Construct Chosen vs Rejected responses
                const chosenResponse = `${winner.persona.toUpperCase()} prediction (Success Probability: ${winner.probability}, Confidence: ${winner.confidence}):\n${winner.reasoning}`;
                const rejectedResponse = `${loser.persona.toUpperCase()} prediction (Success Probability: ${loser.probability}, Confidence: ${loser.confidence}):\n${loser.reasoning}`;

                await db.insert(fineTuningPreferences).values({
                    datasetId: dataset.id,
                    prompt: market.prompt,
                    chosenResponse,
                    rejectedResponse,
                    humanConfidence: 90, // Calibrated by Ground Truth
                    sourceJobId: market.jobId || null
                });

                logger.info(`[PredictionMarket] Logged DPO preference record for high-value example ${candidateId}`);
            } catch (err: any) {
                logger.error(`[PredictionMarket] Failed to store DPO preference: ${err.message}`);
            }
        }

        // Clean up active market
        this.activeMarkets.delete(candidateId);
    }
}

export const predictionMarketService = new PredictionMarketService();
