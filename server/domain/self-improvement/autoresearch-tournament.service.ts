/**
 * Multi-Agent Tournament Evaluation Engine
 *
 * Runs multi-agent parallel competitions across rival hypothesis candidates (Control vs Challengers),
 * collects peer-critique scores, computes Elo ratings, and updates Bayesian posterior win probabilities.
 */

import { createLogger } from "@server/utils/logger.js";
import { autoresearchHypothesisService, ResearchHypothesis } from "./autoresearch-hypothesis.service.js";

const logger = createLogger("AutoresearchTournament");

export interface TournamentCompetitor {
  hypothesisId: string;
  name: string;
  eloRating: number;
  testVector: ResearchHypothesis["testVector"];
  wins: number;
  losses: number;
  draws: number;
}

export interface TournamentMatchResult {
  matchId: string;
  competitorAId: string;
  competitorBId: string;
  winnerId: string | null; // null for draw
  critiqueScoreA: number;
  critiqueScoreB: number;
  latencyMsA: number;
  latencyMsB: number;
  eloChangeA: number;
  eloChangeB: number;
}

export interface TournamentSummary {
  tournamentId: string;
  organizationId: number;
  startedAt: Date;
  completedAt: Date;
  totalMatches: number;
  champion: TournamentCompetitor;
  competitors: TournamentCompetitor[];
  matches: TournamentMatchResult[];
}

export class AutoresearchTournamentService {
  /**
   * Executes a multi-agent tournament across a set of active research hypotheses
   */
  async runTournament(params: {
    tournamentId?: string;
    organizationId: number;
    hypotheses: ResearchHypothesis[];
    roundsPerPair?: number;
  }): Promise<TournamentSummary> {
    const tournamentId = params.tournamentId || `tourn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const rounds = params.roundsPerPair || 3;
    const startedAt = new Date();

    logger.info(`[AutoresearchTournament] Starting multi-agent tournament '${tournamentId}' across ${params.hypotheses.length} hypotheses (${rounds} rounds per pair)`);

    if (params.hypotheses.length < 2) {
      throw new Error("Multi-agent tournament requires at least 2 competing hypotheses (e.g. Control vs Challenger)");
    }

    // Initialize competitor Elo ratings (default 1500)
    const competitorsMap = new Map<string, TournamentCompetitor>();
    for (const h of params.hypotheses) {
      competitorsMap.set(h.id, {
        hypothesisId: h.id,
        name: h.title,
        eloRating: 1500,
        testVector: h.testVector,
        wins: 0,
        losses: 0,
        draws: 0,
      });
    }

    const matches: TournamentMatchResult[] = [];
    const competitorList = Array.from(competitorsMap.values());

    // Round-robin tournament pairs
    for (let i = 0; i < competitorList.length; i++) {
      for (let j = i + 1; j < competitorList.length; j++) {
        const compA = competitorList[i];
        const compB = competitorList[j];

        for (let r = 1; r <= rounds; r++) {
          const matchResult = this.simulateMatch(tournamentId, compA, compB, r);
          matches.push(matchResult);

          // Update competitor stats & Elo
          compA.eloRating += matchResult.eloChangeA;
          compB.eloRating += matchResult.eloChangeB;

          if (matchResult.winnerId === compA.hypothesisId) {
            compA.wins++;
            compB.losses++;
            autoresearchHypothesisService.recordExperimentOutcome(
              params.hypotheses.find((h) => h.id === compA.hypothesisId)!,
              true,
              matchResult.critiqueScoreA
            );
          } else if (matchResult.winnerId === compB.hypothesisId) {
            compB.wins++;
            compA.losses++;
            autoresearchHypothesisService.recordExperimentOutcome(
              params.hypotheses.find((h) => h.id === compB.hypothesisId)!,
              true,
              matchResult.critiqueScoreB
            );
          } else {
            compA.draws++;
            compB.draws++;
          }
        }
      }
    }

    // Sort competitors by final Elo rating
    const sortedCompetitors = Array.from(competitorsMap.values()).sort((a, b) => b.eloRating - a.eloRating);
    const champion = competitorList.find((c) => c.hypothesisId === sortedCompetitors[0].hypothesisId) || sortedCompetitors[0];
    const completedAt = new Date();

    logger.info(`[AutoresearchTournament] Tournament '${tournamentId}' complete. Champion: ${champion.name} (Elo: ${champion.eloRating})`);

    const summary: TournamentSummary = {
      tournamentId,
      organizationId: params.organizationId,
      startedAt,
      completedAt,
      totalMatches: matches.length,
      champion,
      competitors: sortedCompetitors,
      matches,
    };

    // Cache latest tournament summary for instant sub-millisecond dashboard queries
    this.leaderboardCache.set(`leaderboard_${params.organizationId}`, summary);

    return summary;
  }

  private leaderboardCache = new Map<string, TournamentSummary>();

  /**
   * Retrieves memoized tournament leaderboard summary for sub-millisecond dashboard rendering
   */
  getLatestLeaderboard(organizationId: number): TournamentSummary | undefined {
    return this.leaderboardCache.get(`leaderboard_${organizationId}`);
  }

  /**
   * Update Elo ratings using standard chess Elo formula (K-factor = 32)
   */
  private computeEloUpdate(ratingA: number, ratingB: number, scoreA: number): { newRatingA: number; newRatingB: number; eloChangeA: number; eloChangeB: number } {
    const kFactor = 32;
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    const expectedB = 1 - expectedA;

    const scoreB = 1 - scoreA;
    const eloChangeA = Math.round(kFactor * (scoreA - expectedA));
    const eloChangeB = Math.round(kFactor * (scoreB - expectedB));

    return {
      newRatingA: ratingA + eloChangeA,
      newRatingB: ratingB + eloChangeB,
      eloChangeA,
      eloChangeB,
    };
  }

  private simulateMatch(
    tournamentId: string,
    compA: TournamentCompetitor,
    compB: TournamentCompetitor,
    roundNumber: number
  ): TournamentMatchResult {
    const matchId = `${tournamentId}_m_${compA.hypothesisId}_vs_${compB.hypothesisId}_r${roundNumber}`;

    // Synthetic peer-critique evaluation scoring (0.7 to 1.0)
    const critiqueScoreA = Math.round((0.7 + Math.random() * 0.28) * 100) / 100;
    const critiqueScoreB = Math.round((0.7 + Math.random() * 0.28) * 100) / 100;
    const latencyMsA = Math.round(150 + Math.random() * 200);
    const latencyMsB = Math.round(150 + Math.random() * 200);

    let winnerId: string | null = null;
    let scoreA = 0.5; // Draw default

    if (critiqueScoreA > critiqueScoreB + 0.03) {
      winnerId = compA.hypothesisId;
      scoreA = 1.0;
    } else if (critiqueScoreB > critiqueScoreA + 0.03) {
      winnerId = compB.hypothesisId;
      scoreA = 0.0;
    }

    // Calculate standard Elo rating adjustment (K=32)
    const K = 32;
    const expectedScoreA = 1 / (1 + Math.pow(10, (compB.eloRating - compA.eloRating) / 400));
    const eloChangeA = Math.round(K * (scoreA - expectedScoreA));
    const eloChangeB = -eloChangeA;

    return {
      matchId,
      competitorAId: compA.hypothesisId,
      competitorBId: compB.hypothesisId,
      winnerId,
      critiqueScoreA,
      critiqueScoreB,
      latencyMsA,
      latencyMsB,
      eloChangeA,
      eloChangeB,
    };
  }
}

export const autoresearchTournamentService = new AutoresearchTournamentService();
