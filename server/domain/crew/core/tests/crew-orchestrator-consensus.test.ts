/**
 * Unit Tests for CREW Room Consensus & Speaker Orchestration
 */

import { describe, expect, it } from "vitest";
import {
  calculateConsensusMetrics,
  restatementScore,
  agentRelevanceScore,
} from "../crew-orchestrator.service.js";

describe("CREW Room Orchestration & Consensus Metrics", () => {
  describe("calculateConsensusMetrics", () => {
    it("returns converged=true for unified agreement across participants", () => {
      const turns = [
        {
          agentCardId: 1,
          content: "I agree with the proposed architecture. We should proceed with database partitioning.",
        },
        {
          agentCardId: 2,
          content: "I concur and support database partitioning as well. The metrics align with our goals.",
        },
        {
          agentCardId: 3,
          content: "Makes sense, confirmed. Everything aligns on my end.",
        },
      ];

      const metrics = calculateConsensusMetrics(turns, 0.75);
      expect(metrics.consensusRatio).toBeGreaterThanOrEqual(0.75);
      expect(metrics.converged).toBe(true);
      expect(metrics.conflictCount).toBe(0);
      expect(metrics.activeSpeakerCount).toBe(3);
    });

    it("detects conflict and marks converged=false when agents disagree", () => {
      const turns = [
        {
          agentCardId: 1,
          content: "We must deploy immediately without additional test gates.",
        },
        {
          agentCardId: 2,
          content: "I disagree with this plan. I cannot support skipping the security verification gates.",
        },
      ];

      const metrics = calculateConsensusMetrics(turns, 0.75);
      expect(metrics.conflictCount).toBeGreaterThan(0);
      expect(metrics.converged).toBe(false);
      expect(metrics.consensusRatio).toBeLessThan(0.75);
    });

    it("handles single-turn or empty rounds safely", () => {
      expect(calculateConsensusMetrics([])).toEqual({
        consensusRatio: 1.0,
        converged: false,
        activeSpeakerCount: 0,
        conflictCount: 0,
      });

      expect(calculateConsensusMetrics([{ agentCardId: 1, content: "Initial proposal" }])).toEqual({
        consensusRatio: 1.0,
        converged: true,
        activeSpeakerCount: 1,
        conflictCount: 0,
      });
    });
  });

  describe("restatementScore", () => {
    it("assigns high score to near-identical turns", () => {
      const turnA = "We need to verify the database migrations before proceeding with the deployment.";
      const turnB = "We need to verify the database migrations before proceeding.";
      const score = restatementScore(turnA, turnB);
      expect(score).toBeGreaterThan(0.7);
    });

    it("assigns low score to distinct discussion turns", () => {
      const turnA = "Let us configure the H3 spatial analytics engine for geospatial telemetry.";
      const turnB = "The user authentication token expired and needs refreshing.";
      const score = restatementScore(turnA, turnB);
      expect(score).toBeLessThan(0.2);
    });
  });

  describe("agentRelevanceScore", () => {
    it("weights agent name, capabilities, and description against user message terms", () => {
      const card = {
        id: 1,
        name: "Security Auditor",
        capabilities: ["dependency_audit", "vulnerability_scan", "auth_check"],
        description: "Specialized security agent",
      } as any;

      const highRelevance = agentRelevanceScore("Can we run a security audit on our dependencies?", card);
      const lowRelevance = agentRelevanceScore("What is the weather in Vancouver?", card);

      expect(highRelevance).toBeGreaterThan(lowRelevance);
      expect(lowRelevance).toBe(0);
    });
  });
});
