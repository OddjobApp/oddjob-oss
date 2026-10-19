/**
 * Predictive Scorer for LLM Router
 * Scores models based on performance and task classification
 */

import { TaskClassification } from "./task-classifier.js";

export interface ModelPerformance {
    successRate: number;
    avgTokens: number;
}

export function scoreModel(
    model: any, 
    perf: ModelPerformance | undefined, 
    classification: TaskClassification
): number {
    const successRate = perf ? perf.successRate : 0.8; // Default to 0.8
    const avgTokens = perf ? perf.avgTokens : 500; // Default to 500 tokens
    
    // Calculate approximate cost per token
    const inputCost = model.inputCostPer1k ? model.inputCostPer1k / 1000 : 0.00001;
    const cost = avgTokens * inputCost;
    
    let score = successRate;
    
    const { isComplex, isCoding, isResearch, isCreative } = classification;
    
    // Score = successRate * qualityWeight - cost * costWeight
    // qualityWeight:costWeight ratio determines how much quality matters vs price.
    // Complex/coding: 15:2 — correctness errors are expensive to fix, cost secondary.
    // Research: 8:1 — balance quality and cost; many models handle retrieval well.
    // Creative: 10:1 — quality (coherence, style) matters more than cost for short tasks.
    // Simple: 1:10 — cheapest model wins; correctness is near-deterministic.
    if (isComplex || isCoding) {
        score = successRate * 15 - cost * 2;
    } else if (isResearch) {
        score = successRate * 8 - cost;
    } else if (isCreative) {
        score = successRate * 10 - cost;
    } else {
        score = successRate - cost * 10;
    }
    
    return score;
}
