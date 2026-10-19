/**
 * Constitutional AI with Debate Mechanism
 * 
 * Research: "Constitutional AI: Harmlessness from AI Feedback" (Anthropic, 2022) + "AI Debate" (Irving et al., 2018)
 * 
 * This service implements multi-agent debate for constitutional enforcement.
 * Agents debate each other's outputs to ensure safety and compliance.
 * 
 * Expected Impact: Enhanced safety, better compliance, reduced harmful outputs
 */

import { createLogger } from "../../../../utils/logger.js";
import { AIClientFactory } from "../../../ai/core/ai-client.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("ConstitutionalDebate");

export interface DebateAgent {
  id: string;
  role: "prosecutor" | "defender" | "judge";
  constitution: string;
  perspective: string;
}

export interface DebateRound {
  roundNumber: number;
  prosecutorArgument: string;
  defenderArgument: string;
  judgeEvaluation: string;
  winner: "prosecutor" | "defender" | "tie";
  confidence: number;
}

export interface DebateResult {
  finalVerdict: "safe" | "unsafe" | "needs_revision";
  rounds: DebateRound[];
  finalArgument: string;
  safetyScore: number;
  requiredChanges: string[];
}

export class DebateMechanismService {
  private debateHistory: Map<string, DebateResult[]> = new Map();
  private maxRounds = 3;

  /**
   * Run a debate to determine if an output is constitutionally safe
   */
  async debateSafety(
    output: string,
    constitution: string,
    context?: any
  ): Promise<DebateResult> {
    logger.info("[DebateMechanism] Starting constitutional debate");

    const rounds: DebateRound[] = [];
    let finalVerdict: "safe" | "unsafe" | "needs_revision" = "needs_revision";
    let safetyScore = 0.5;

    // Initialize debate agents
    const prosecutor: DebateAgent = {
      id: "prosecutor",
      role: "prosecutor",
      constitution,
      perspective: "Identify potential violations and harmful content"
    };

    const defender: DebateAgent = {
      id: "defender",
      role: "defender",
      constitution,
      perspective: "Defend the output as safe and compliant"
    };

    const judge: DebateAgent = {
      id: "judge",
      role: "judge",
      constitution,
      perspective: "Evaluate arguments impartially based on the constitution"
    };

    // Run debate rounds
    for (let round = 1; round <= this.maxRounds; round++) {
      logger.debug(`[DebateMechanism] Round ${round}/${this.maxRounds}`);

      const roundResult = await this.runDebateRound(
        output,
        prosecutor,
        defender,
        judge,
        round,
        rounds
      );

      rounds.push(roundResult);

      // Early termination if clear winner
      if (roundResult.confidence > 0.9) {
        logger.info(`[DebateMechanism] Early termination at round ${round} with ${roundResult.confidence.toFixed(2)} confidence`);
        break;
      }
    }

    // Determine final verdict
    finalVerdict = this.determineFinalVerdict(rounds);
    safetyScore = this.calculateSafetyScore(rounds);

    const requiredChanges = finalVerdict === "needs_revision" 
      ? this.extractRequiredChanges(rounds)
      : [];

    const result: DebateResult = {
      finalVerdict,
      rounds,
      finalArgument: rounds[rounds.length - 1].judgeEvaluation,
      safetyScore,
      requiredChanges
    };

    // Record debate history
    const history = this.debateHistory.get(context?.taskId || "default") || [];
    history.push(result);
    this.debateHistory.set(context?.taskId || "default", history.slice(-10));

    logger.info(`[DebateMechanism] Debate complete: ${finalVerdict} (safety: ${safetyScore.toFixed(2)})`);
    return result;
  }

  /**
   * Run a single debate round
   */
  private async runDebateRound(
    output: string,
    prosecutor: DebateAgent,
    defender: DebateAgent,
    judge: DebateAgent,
    roundNumber: number,
    previousRounds: DebateRound[]
  ): Promise<DebateRound> {
    // Prosecutor argues against the output
    const prosecutorArgument = await this.generateArgument(
      prosecutor,
      output,
      previousRounds,
      "prosecutor"
    );

    // Defender argues for the output
    const defenderArgument = await this.generateArgument(
      defender,
      output,
      previousRounds,
      "defender"
    );

    // Judge evaluates both arguments
    const judgeEvaluation = await this.judgeArguments(
      judge,
      prosecutorArgument,
      defenderArgument,
      output,
      judge.constitution
    );

    // Determine winner
    const { winner, confidence } = this.parseJudgeDecision(judgeEvaluation);

    return {
      roundNumber,
      prosecutorArgument,
      defenderArgument,
      judgeEvaluation,
      winner,
      confidence
    };
  }

  /**
   * Generate an argument for a debate agent
   */
  private async generateArgument(
    agent: DebateAgent,
    output: string,
    previousRounds: DebateRound[],
    role: string
  ): Promise<string> {
    let prompt = `You are a ${role} in a constitutional AI debate.\n\n`;
    prompt += `CONSTITUTION:\n${agent.constitution}\n\n`;
    prompt += `YOUR PERSPECTIVE: ${agent.perspective}\n\n`;
    prompt += `OUTPUT TO EVALUATE:\n${output}\n\n`;

    if (previousRounds.length > 0) {
      prompt += `PREVIOUS ROUNDS:\n`;
      previousRounds.forEach((r, i) => {
        prompt += `Round ${i + 1}:\n`;
        prompt += `Prosecutor: ${r.prosecutorArgument}\n`;
        prompt += `Defender: ${r.defenderArgument}\n`;
        prompt += `Judge: ${r.judgeEvaluation}\n\n`;
      });
    }

    prompt += `Provide your argument in 2-3 sentences. Be specific and reference the constitution.`;

    try {
      const client = AIClientFactory.getClient({ provider: "google", model: "gemini-2.0-flash" } as any);
      const response = await client.execute({
        systemPrompt: `You are a constitutional AI debate agent. Provide clear, concise arguments based on the constitution.`,
        userPrompt: prompt,
        temperature: 0.7,
        model: "gemini-2.0-flash",
        useCache: false,
        saveOutputToFile: false,
        enableQueryExpansion: false,
      }, undefined, developmentProviderKey());

      if (!response.success) {
        throw new Error(`Argument generation failed: ${response.error}`);
      }

      return response.output || "";
    } catch (error) {
      logger.error("[DebateMechanism] Argument generation failed:", error);
      return "Error in argument generation";
    }
  }

  /**
   * Judge the arguments and determine winner
   */
  private async judgeArguments(
    judge: DebateAgent,
    prosecutorArgument: string,
    defenderArgument: string,
    output: string,
    constitutionText: string
  ): Promise<string> {
    let prompt = `You are an impartial judge in a constitutional AI debate.\n\n`;
    prompt += `CONSTITUTION:\n${constitutionText}\n\n`;
    prompt += `OUTPUT UNDER REVIEW:\n${output}\n\n`;
    prompt += `PROSECUTOR ARGUMENT:\n${prosecutorArgument}\n\n`;
    prompt += `DEFENDER ARGUMENT:\n${defenderArgument}\n\n`;
    prompt += `Evaluate both arguments impartially. Determine which side makes a stronger case based on the constitution.\n\n`;
    prompt += `Provide your evaluation in this format:\n`;
    prompt += `WINNER: [prosecutor|defender|tie]\n`;
    prompt += `CONFIDENCE: [0-1]\n`;
    prompt += `REASONING: [your evaluation]`;

    try {
      const client = AIClientFactory.getClient({ provider: "google", model: "gemini-2.0-flash" } as any);
      const response = await client.execute({
        systemPrompt: "You are an impartial judge. Evaluate arguments fairly based on the constitution.",
        userPrompt: prompt,
        temperature: 0.3,
        model: "gemini-2.0-flash",
        useCache: false,
        saveOutputToFile: false,
        enableQueryExpansion: false,
      }, undefined, developmentProviderKey());

      if (!response.success) {
        throw new Error(`Judgment failed: ${response.error}`);
      }

      return response.output || "";
    } catch (error) {
      logger.error("[DebateMechanism] Judgment failed:", error);
      return "WINNER: tie\nCONFIDENCE: 0.5\nREASONING: Error in judgment";
    }
  }

  /**
   * Parse judge's decision
   */
  private parseJudgeDecision(evaluation: string): { winner: "prosecutor" | "defender" | "tie"; confidence: number } {
    const winnerMatch = evaluation.match(/WINNER:\s*(prosecutor|defender|tie)/i);
    const confidenceMatch = evaluation.match(/CONFIDENCE:\s*([0-9.]+)/i);

    const winner = (winnerMatch ? winnerMatch[1].toLowerCase() : "tie") as "prosecutor" | "defender" | "tie";
    const confidence = confidenceMatch ? Math.min(Math.max(parseFloat(confidenceMatch[1]), 0), 1) : 0.5;

    return { winner, confidence };
  }

  /**
   * Determine final verdict from all rounds
   */
  private determineFinalVerdict(rounds: DebateRound[]): "safe" | "unsafe" | "needs_revision" {
    if (rounds.length === 0) return "needs_revision";

    const prosecutorWins = rounds.filter(r => r.winner === "prosecutor").length;
    const defenderWins = rounds.filter(r => r.winner === "defender").length;
    const ties = rounds.filter(r => r.winner === "tie").length;

    const totalRounds = rounds.length;

    // Clear prosecutor majority = unsafe
    if (prosecutorWins > totalRounds / 2) {
      return "unsafe";
    }

    // Clear defender majority = safe
    if (defenderWins > totalRounds / 2) {
      return "safe";
    }

    // Mixed or ties = needs revision
    return "needs_revision";
  }

  /**
   * Calculate overall safety score
   */
  private calculateSafetyScore(rounds: DebateRound[]): number {
    if (rounds.length === 0) return 0.5;

    const defenderWins = rounds.filter(r => r.winner === "defender").length;
    const avgConfidence = rounds.reduce((sum, r) => sum + r.confidence, 0) / rounds.length;

    // Base score from defender win rate
    const winRateScore = defenderWins / rounds.length;

    // Adjust by average confidence
    const confidenceAdjustment = (avgConfidence - 0.5) * 0.2;

    return Math.max(0, Math.min(1, winRateScore + confidenceAdjustment));
  }

  /**
   * Extract required changes from debate rounds
   */
  private extractRequiredChanges(rounds: DebateRound[]): string[] {
    const changes: string[] = [];

    rounds.forEach(round => {
      // Extract concerns from prosecutor arguments
      const prosecutorText = round.prosecutorArgument.toLowerCase();
      if (prosecutorText.includes("should") || prosecutorText.includes("must")) {
        const sentences = round.prosecutorArgument.split(/[.!?]/);
        sentences.forEach(sentence => {
          if (sentence.includes("should") || sentence.includes("must")) {
            changes.push(sentence.trim());
          }
        });
      }
    });

    return [...new Set(changes)]; // Deduplicate
  }

  /**
   * Multi-agent critique for enhanced safety
   */
  async multiAgentCritique(
    output: string,
    constitutions: string[],
    context?: any
  ): Promise<{
    overallSafe: boolean;
    critiques: Array<{ constitution: string; safe: boolean; reasoning: string }>;
    consensus: string;
  }> {
    logger.info(`[DebateMechanism] Running multi-agent critique with ${constitutions.length} constitutions`);

    const critiques = await Promise.all(
      constitutions.map(async (constitution) => {
        const debateResult = await this.debateSafety(output, constitution, context);
        return {
          constitution,
          safe: debateResult.finalVerdict === "safe",
          reasoning: debateResult.finalArgument
        };
      })
    );

    const overallSafe = critiques.every(c => c.safe);
    const consensus = overallSafe 
      ? "All constitutions agree the output is safe"
      : "Some constitutions flag concerns - review required";

    return {
      overallSafe,
      critiques,
      consensus
    };
  }

  /**
   * Get debate statistics
   */
  getStats(): {
    totalDebates: number;
    averageRounds: number;
    averageSafetyScore: number;
    verdictDistribution: { safe: number; unsafe: number; needs_revision: number };
  } {
    let totalDebates = 0;
    let totalRounds = 0;
    let totalSafetyScore = 0;
    const verdictDistribution = { safe: 0, unsafe: 0, needs_revision: 0 };

    for (const history of this.debateHistory.values()) {
      history.forEach(debate => {
        totalDebates++;
        totalRounds += debate.rounds.length;
        totalSafetyScore += debate.safetyScore;
        verdictDistribution[debate.finalVerdict]++;
      });
    }

    return {
      totalDebates,
      averageRounds: totalDebates > 0 ? totalRounds / totalDebates : 0,
      averageSafetyScore: totalDebates > 0 ? totalSafetyScore / totalDebates : 0,
      verdictDistribution
    };
  }

  /**
   * Clear debate history
   */
  clearHistory(): void {
    this.debateHistory.clear();
  }
}

// Singleton instance
export const debateMechanismService = new DebateMechanismService();
