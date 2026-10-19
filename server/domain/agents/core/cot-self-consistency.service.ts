/**
 * Chain-of-Thought with Self-Consistency (CoT-SC) Service
 * 
 * Research: "Self-Consistency Improves Chain of Thought Reasoning" (Wang et al., 2023)
 * 
 * This service implements multi-path reasoning with voting to improve complex reasoning tasks.
 * It generates multiple reasoning paths, selects the most consistent answer, and provides
 * confidence scoring based on path agreement.
 * 
 * Expected Impact: 15-30% improvement in complex reasoning tasks, better explainability
 */

import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";

const logger = createLogger("CoTSelfConsistency");

export interface CoTConfig {
  enabled: boolean;
  numPaths: number; // Number of reasoning paths to generate (default: 3-5)
  temperature: number; // Temperature for path generation (default: 0.7)
  votingStrategy: "majority" | "weighted" | "all";
  minConfidence: number; // Minimum confidence threshold (default: 0.6)
}

export interface ReasoningPath {
  id: string;
  reasoning: string;
  answer: string;
  confidence: number;
  tokensUsed: number;
}

export interface CoTResult {
  finalAnswer: string;
  confidence: number;
  selectedPathId: string;
  allPaths: ReasoningPath[];
  votingSummary: Map<string, number>;
  reasoningSummary: string;
}

export class CoTSelfConsistencyService {
  private defaultConfig: CoTConfig = {
    enabled: true,
    numPaths: 3,
    temperature: 0.7,
    votingStrategy: "majority",
    minConfidence: 0.6
  };

  /**
   * Apply Chain-of-Thought with Self-Consistency to a reasoning task
   */
  async applyCoT(
    question: string,
    context: string,
    config: Partial<CoTConfig> = {},
    metadata?: any
  ): Promise<CoTResult> {
    const finalConfig = { ...this.defaultConfig, ...config };

    if (!finalConfig.enabled) {
      // Fallback to single-path reasoning
      return this.singlePathReasoning(question, context, metadata);
    }

    logger.info(`[CoT-SC] Starting multi-path reasoning with ${finalConfig.numPaths} paths`);

    // Generate multiple reasoning paths in parallel
    const paths: ReasoningPath[] = await Promise.all(
      Array.from({ length: finalConfig.numPaths }, (_, i) =>
        this.generateReasoningPath(question, context, i, finalConfig, metadata)
      )
    );

    // Vote on the most consistent answer
    const result = this.voteOnAnswer(paths, finalConfig);

    logger.info(`[CoT-SC] Selected answer with confidence: ${result.confidence.toFixed(2)}`);
    return result;
  }

  /**
   * Generate a single reasoning path
   */
  private async generateReasoningPath(
    question: string,
    context: string,
    pathIndex: number,
    config: CoTConfig,
    metadata?: any
  ): Promise<ReasoningPath> {
    const client = AIClientFactory.getClient(metadata?.provider || { provider: "google" });

    const cotPrompt = this.buildCoTPrompt(question, context);

    try {
      const response = await client.execute({
        model: metadata?.model || "gpt-4o",
        systemPrompt: this.getSystemPrompt(),
        userPrompt: cotPrompt,
        temperature: config.temperature,
        maxTokens: 2000
      } as any, 'cot-self-consistency', '');

      const content = (typeof response.output === "string" ? response.output : JSON.stringify(response.output)) || "";
      const { reasoning, answer } = this.parseCoTResponse(content);

      // Calculate confidence based on reasoning quality
      const confidence = this.calculateConfidence(reasoning, answer);

      return {
        id: `path-${pathIndex}`,
        reasoning,
        answer,
        confidence,
        tokensUsed: (response as any).tokensUsed || 0
      };
    } catch (error) {
      logger.error(`[CoT-SC] Failed to generate path ${pathIndex}:`, error);
      // Return a low-confidence fallback path
      return {
        id: `path-${pathIndex}`,
        reasoning: "Error in reasoning generation",
        answer: "Unable to determine",
        confidence: 0,
        tokensUsed: 0
      };
    }
  }

  /**
   * Build the Chain-of-Thought prompt
   */
  private buildCoTPrompt(question: string, context: string): string {
    return `Context:
${context}

Question: ${question}

Please think through this step-by-step. Show your reasoning clearly, then provide your final answer.

Format your response as:
REASONING: [your step-by-step reasoning]
ANSWER: [your final answer]`;
  }

  /**
   * Get the system prompt for CoT reasoning
   */
  private getSystemPrompt(): string {
    return `You are an expert reasoning assistant. Your task is to think through problems step-by-step, showing clear logical reasoning before arriving at your final answer.

Key principles:
1. Break down complex problems into smaller steps
2. Show your work explicitly
3. Consider alternative perspectives
4. Verify your reasoning before concluding
5. Provide clear, concise final answers`;
  }

  /**
   * Parse the CoT response to extract reasoning and answer
   */
  private parseCoTResponse(response: string): { reasoning: string; answer: string } {
    const reasoningMatch = response.match(/REASONING:\s*(.*?)(?=ANSWER:|$)/s);
    const answerMatch = response.match(/ANSWER:\s*(.*)/s);

    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : response;
    const answer = answerMatch ? answerMatch[1].trim() : response;

    return { reasoning, answer };
  }

  /**
   * Calculate confidence based on reasoning quality
   */
  private calculateConfidence(reasoning: string, answer: string): number {
    let score = 0.5; // Base score

    // Reasoning length (longer reasoning = more thorough)
    if (reasoning.length > 200) score += 0.1;
    if (reasoning.length > 500) score += 0.1;

    // Presence of reasoning indicators
    if (reasoning.includes("because")) score += 0.05;
    if (reasoning.includes("therefore")) score += 0.05;
    if (reasoning.includes("however")) score += 0.05;
    if (reasoning.includes("consider")) score += 0.05;

    // Answer specificity
    if (answer.length > 10) score += 0.05;
    if (!answer.toLowerCase().includes("unsure")) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Vote on the most consistent answer using the configured strategy
   */
  private voteOnAnswer(paths: ReasoningPath[], config: CoTConfig): CoTResult {
    const votingSummary = new Map<string, number>();

    // Normalize answers for comparison (case-insensitive, trimmed)
    const normalizedAnswers = paths.map(p => ({
      ...p,
      normalizedAnswer: p.answer.toLowerCase().trim()
    }));

    // Count votes for each unique answer
    normalizedAnswers.forEach(path => {
      const count = votingSummary.get(path.normalizedAnswer) || 0;
      votingSummary.set(path.normalizedAnswer, count + 1);
    });

    // Select winning answer based on voting strategy
    let selectedPath: ReasoningPath;
    let finalAnswer: string;
    let confidence: number;

    if (config.votingStrategy === "majority") {
      // Simple majority vote
      const maxVotes = Math.max(...votingSummary.values());
      const winners = Array.from(votingSummary.entries())
        .filter(([_, count]) => count === maxVotes)
        .map(([answer, _]) => answer);

      // If tie, select the one with highest average confidence
      if (winners.length > 1) {
        const tiePaths = normalizedAnswers.filter(p => winners.includes(p.normalizedAnswer));
        selectedPath = tiePaths.reduce((best, current) =>
          current.confidence > best.confidence ? current : best
        );
      } else {
        selectedPath = normalizedAnswers.find(p => p.normalizedAnswer === winners[0])!;
      }

      finalAnswer = selectedPath.answer;
      confidence = maxVotes / paths.length;
    } else if (config.votingStrategy === "weighted") {
      // Weighted vote based on confidence
      const weightedVotes = new Map<string, number>();
      normalizedAnswers.forEach(path => {
        const current = weightedVotes.get(path.normalizedAnswer) || 0;
        weightedVotes.set(path.normalizedAnswer, current + path.confidence);
      });

      const maxWeight = Math.max(...weightedVotes.values());
      const winner = Array.from(weightedVotes.entries())
        .find(([_, weight]) => weight === maxWeight)!;

      selectedPath = normalizedAnswers.find(p => p.normalizedAnswer === winner[0])!;
      finalAnswer = selectedPath.answer;
      confidence = maxWeight / paths.length;
    } else {
      // "all" strategy - return all paths for human review
      selectedPath = normalizedAnswers.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );
      finalAnswer = selectedPath.answer;
      confidence = selectedPath.confidence;
    }

    // Build reasoning summary
    const reasoningSummary = this.buildReasoningSummary(normalizedAnswers, votingSummary);

    return {
      finalAnswer,
      confidence,
      selectedPathId: selectedPath.id,
      allPaths: paths,
      votingSummary,
      reasoningSummary
    };
  }

  /**
   * Build a summary of all reasoning paths
   */
  private buildReasoningSummary(paths: ReasoningPath[], votingSummary: Map<string, number>): string {
    let summary = "Reasoning Paths Summary:\n\n";
    
    paths.forEach((path, index) => {
      const votes = votingSummary.get(path.answer.toLowerCase().trim()) || 0;
      summary += `Path ${index + 1} (Confidence: ${(path.confidence * 100).toFixed(0)}%, Votes: ${votes}):\n`;
      summary += `${path.reasoning.substring(0, 200)}...\n\n`;
    });

    return summary;
  }

  /**
   * Fallback to single-path reasoning when CoT-SC is disabled
   */
  private async singlePathReasoning(
    question: string,
    context: string,
    metadata?: any
  ): Promise<CoTResult> {
    const path = await this.generateReasoningPath(question, context, 0, this.defaultConfig, metadata);

    return {
      finalAnswer: path.answer,
      confidence: path.confidence,
      selectedPathId: path.id,
      allPaths: [path],
      votingSummary: new Map([[path.answer.toLowerCase().trim(), 1]]),
      reasoningSummary: `Single reasoning path:\n${path.reasoning}`
    };
  }
}

// Singleton instance
export const cotService = new CoTSelfConsistencyService();
