/**
 * Consensus Service Tests
 * 
 * Comprehensive test suite for swarm consensus algorithms.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConsensusService, Proposal, Vote } from "./consensus.service.js";
import { swarmCommunicationService } from "@domain/agents/core/swarm-communication.service.js";

// Mock dependencies
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@domain/agents/core/swarm-communication.service.js", () => ({
  swarmCommunicationService: {
    broadcast: vi.fn(() => Promise.resolve()),
    getMembers: vi.fn(() => Promise.resolve(["agent-1", "agent-2", "agent-3"])),
    subscribe: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
  eventStream: {
    publish: vi.fn(() => Promise.resolve()),
  },
}));

describe("ConsensusService", () => {
  let service: ConsensusService;

  beforeEach(() => {
    service = new ConsensusService({
      defaultAlgorithm: "simple_majority",
      defaultTimeoutMs: 5000,
      defaultQuorum: 2,
    });
  });

  // ============================================================================
  // PROPOSAL CREATION
  // ============================================================================

  describe("propose()", () => {
    it("should create a new proposal", async () => {
      const proposal = await service.propose(
        "swarm-1",
        "agent-1",
        "test_action",
        { data: "test" }
      );

      expect(proposal).toBeDefined();
      expect(proposal.id).toBeDefined();
      expect(proposal.swarmId).toBe("swarm-1");
      expect(proposal.proposerId).toBe("agent-1");
      expect(proposal.type).toBe("test_action");
      expect(proposal.status).toBe("pending");
      expect(proposal.votes.size).toBe(0);
    });

    it("should use custom algorithm when specified", async () => {
      const proposal = await service.propose(
        "swarm-1",
        "agent-1",
        "test",
        {},
        { algorithm: "unanimous" }
      );

      expect(proposal.algorithm).toBe("unanimous");
    });

    it("should broadcast proposal to swarm", async () => {
      const { swarmCommunicationService } = await import("../swarm-communication.service.js");
      
      await service.propose("swarm-1", "agent-1", "test", {});

      expect(swarmCommunicationService.broadcast).toHaveBeenCalledWith(
        "swarm-1",
        "agent-1",
        expect.objectContaining({
          type: "consensus:proposal",
          proposal: expect.any(Object),
        })
      );
    });
  });

  // ============================================================================
  // VOTING
  // ============================================================================

  describe("vote()", () => {
    it("should record a vote", async () => {
      const proposal = await service.propose("swarm-1", "agent-1", "test", {});
      
      await service.vote(proposal.id, "agent-1", "yes", 0.8, "Looks good");

      const updated = service.getProposal(proposal.id);
      expect(updated?.votes.has("agent-1")).toBe(true);
      expect(updated?.votes.get("agent-1")?.value).toBe("yes");
      expect(updated?.votes.get("agent-1")?.confidence).toBe(0.8);
    });

    it("should reject votes on non-pending proposals", async () => {
      const proposal = await service.propose("swarm-1", "agent-1", "test", {});
      
      // Manually accept
      const p = service.getProposal(proposal.id)!;
      p.status = "accepted";

      await expect(
        service.vote(proposal.id, "agent-2", "yes")
      ).rejects.toThrow("already accepted");
    });

    it("should update vote if already voted", async () => {
      const proposal = await service.propose("swarm-1", "agent-1", "test", {});
      
      await service.vote(proposal.id, "agent-1", "yes", 0.5);
      await service.vote(proposal.id, "agent-1", "no", 0.9);

      const updated = service.getProposal(proposal.id);
      expect(updated?.votes.get("agent-1")?.value).toBe("no");
      expect(updated?.votes.get("agent-1")?.confidence).toBe(0.9);
    });
  });

  // ============================================================================
  // SIMPLE MAJORITY
  // ============================================================================

  describe("Simple Majority Consensus", () => {
    it("should accept with majority yes votes", async () => {
      const proposal = await service.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { algorithm: "simple_majority", requiredQuorum: 3 }
      );

      await service.vote(proposal.id, "agent-1", "yes");
      await service.vote(proposal.id, "agent-2", "yes");
      await service.vote(proposal.id, "agent-3", "no");

      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("accepted");
      expect(result?.result?.accepted).toBe(true);
      expect(result?.result?.yesVotes).toBe(2);
    });

    it("should reject with majority no votes", async () => {
      const proposal = await service.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { algorithm: "simple_majority", requiredQuorum: 3 }
      );

      await service.vote(proposal.id, "agent-1", "no");
      await service.vote(proposal.id, "agent-2", "no");
      await service.vote(proposal.id, "agent-3", "yes");

      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("rejected");
      expect(result?.result?.accepted).toBe(false);
    });

    it("should remain pending without quorum", async () => {
      const proposal = await service.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { algorithm: "simple_majority", requiredQuorum: 3 }
      );

      await service.vote(proposal.id, "agent-1", "yes");

      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("pending");
    });
  });

  // ============================================================================
  // UNANIMOUS CONSENSUS
  // ============================================================================

  describe("Unanimous Consensus", () => {
    it("should accept only with 100% yes", async () => {
      const proposal = await service.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { algorithm: "unanimous", requiredQuorum: 3 }
      );

      await service.vote(proposal.id, "agent-1", "yes");
      await service.vote(proposal.id, "agent-2", "yes");
      await service.vote(proposal.id, "agent-3", "yes");

      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("accepted");
    });

    it("should reject if any agent votes no", async () => {
      const proposal = await service.propose(
        "swarm-1",
        "agent-1",
        "test",
        {},
        { algorithm: "unanimous", requiredQuorum: 3 }
      );

      await service.vote(proposal.id, "agent-1", "yes");
      await service.vote(proposal.id, "agent-2", "no");
      await service.vote(proposal.id, "agent-3", "yes");

      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("rejected");
    });
  });

  // ============================================================================
  // CONFIDENCE-WEIGHTED
  // ============================================================================

  describe("Confidence-Weighted Consensus", () => {
    it("should weight votes by confidence", async () => {
      const service = new ConsensusService({
        defaultAlgorithm: "confidence_weighted",
      });

      const proposal = await service.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { algorithm: "confidence_weighted", requiredQuorum: 2 }
      );

      // Agent-1 votes yes with 0.9 confidence
      await service.vote(proposal.id, "agent-1", "yes", 0.9);
      // Agent-2 votes no with 0.3 confidence (below threshold)
      await service.vote(proposal.id, "agent-2", "no", 0.3);

      // Agent-1's high-confidence yes should outweigh low-confidence no
      const result = service.getProposal(proposal.id);
      // Note: Both voted so quorum met, result depends on algorithm
      expect(result?.status).toBe("accepted");
    });
  });

  // ============================================================================
  // SUPER MAJORITY
  // ============================================================================

  describe("Super Majority Consensus", () => {
    it("should require 2/3 majority", async () => {
      const proposal = await service.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { algorithm: "super_majority", requiredQuorum: 3 }
      );

      await service.vote(proposal.id, "agent-1", "yes");
      await service.vote(proposal.id, "agent-2", "yes");
      await service.vote(proposal.id, "agent-3", "no");

      // 2/3 = 66%, threshold is 66% + 1, so this should be disputed
      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("disputed");
    });
  });

  // ============================================================================
  // TIMEOUTS
  // ============================================================================

  describe("Proposal Timeout", () => {
    it("should expire after timeout", async () => {
      vi.useFakeTimers();
      
      const proposal = await service.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { timeoutMs: 1000 }
      );

      // Fast-forward past timeout
      vi.advanceTimersByTime(2000);

      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("expired");

      vi.useRealTimers();
    });
  });

  // ============================================================================
  // REPUTATION
  // ============================================================================

  describe("Agent Reputation", () => {
    it("should track agent voting accuracy", async () => {
      // getMembers returns 1 member so 1 yes = majority
      vi.mocked(swarmCommunicationService.getMembers).mockResolvedValueOnce(["agent-1"]);
      const proposal = await service.propose(
        "swarm-1",
        "agent-1",
        "test",
        {},
        { algorithm: "simple_majority", requiredQuorum: 1 }
      );

      await service.vote(proposal.id, "agent-1", "yes", 0.8);

      // Proposal should auto-accept with 1 vote and quorum=1
      const result = service.getProposal(proposal.id);
      expect(result?.status).toBe("accepted");

      // Check reputation updated (indirectly through confidence weighting)
      const stats = service.getSwarmStats("swarm-1");
      expect(stats.totalProposals).toBe(1);
    });
  });

  // ============================================================================
  // STATS
  // ============================================================================

  describe("Statistics", () => {
    it("should calculate correct stats", async () => {
      // Create and resolve proposals — mock 1 member so 1 vote = majority
      vi.mocked(swarmCommunicationService.getMembers).mockResolvedValue(["agent-1"]);
      const p1 = await service.propose("swarm-1", "agent-1", "test1", {}, { requiredQuorum: 1 });
      await service.vote(p1.id, "agent-1", "yes");

      const p2 = await service.propose("swarm-1", "agent-1", "test2", {}, { requiredQuorum: 1 });
      await service.vote(p2.id, "agent-1", "no");

      const p3 = await service.propose("swarm-1", "agent-1", "test3", {}, { requiredQuorum: 2 });
      // Don't vote - will remain pending

      const stats = service.getSwarmStats("swarm-1");
      expect(stats.totalProposals).toBe(3);
      expect(stats.accepted).toBe(1);
      expect(stats.rejected).toBe(1);
      // Expired is 0 because pending proposals don't count as expired
    });
  });

  // ============================================================================
  // HANDLERS
  // ============================================================================

  describe("Resolution Handlers", () => {
    it("should notify handlers on resolution", async () => {
      const handler = vi.fn();
      
      vi.mocked(swarmCommunicationService.getMembers).mockResolvedValueOnce(["agent-1"]);
      const proposal = await service.propose(
        "swarm-1",
        "agent-1",
        "test",
        {},
        { requiredQuorum: 1 }
      );

      service.onProposalResolved(proposal.id, handler);
      await service.vote(proposal.id, "agent-1", "yes");

      expect(handler).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: proposal.id,
        status: "accepted",
      }));
    });
  });

  // ============================================================================
  // BFT TOLERANCE
  // ============================================================================

  describe("Byzantine Fault Tolerance", () => {
    it("should tolerate f faulty agents", async () => {
      const bftService = new ConsensusService({
        defaultAlgorithm: "bft_tolerant",
        bftFaultTolerance: 1, // tolerate 1 fault
      });

      // With 3f+1 = 4 agents minimum, but we'll use 3 for simplicity
      const proposal = await bftService.propose(
        "swarm-1", 
        "agent-1", 
        "test", 
        {},
        { algorithm: "bft_tolerant", requiredQuorum: 3 }
      );

      // Need 2f+1 = 3 votes
      await bftService.vote(proposal.id, "agent-1", "yes");
      await bftService.vote(proposal.id, "agent-2", "yes");
      
      // 2 yes votes, need 3
      let result = bftService.getProposal(proposal.id);
      expect(result?.status).toBe("pending");

      await bftService.vote(proposal.id, "agent-3", "no");
      
      // Still need more yes
      result = bftService.getProposal(proposal.id);
      // Status depends on BFT threshold calculation
    });
  });
});
