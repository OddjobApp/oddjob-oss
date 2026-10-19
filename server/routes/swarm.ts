/**
 * Swarm System API Routes
 * 
 * REST API for multi-agent swarm coordination.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgAdminOrSuper } from "../utils/auth-context.js";
import { swarmCoordinator, consensusService, conflictResolutionService, sharedBlackboardService } from "@domain/agents/core/swarm/index.js";
import { z } from "zod";
import { asyncHandler } from "@server/middleware/error-handler.js";

const router = Router();

// Validation schemas
const createSwarmSchema = z.object({
  name: z.string(),
  missionId: z.number().optional(),
  goal: z.string().optional(),
  defaultConsensusAlgorithm: z.enum(["simple_majority", "super_majority", "unanimous", "confidence_weighted", "bft_tolerant"]).optional(),
});

const joinSwarmSchema = z.object({
  agentId: z.string(),
  role: z.enum(["coordinator", "strategist", "executor", "critic", "researcher", "innovator", "communicator", "monitor", "arbiter"]).optional(),
  autoAssignRole: z.boolean().default(true),
});

const proposeSchema = z.object({
  proposerId: z.string(),
  type: z.string(),
  payload: z.any(),
  algorithm: z.enum(["simple_majority", "super_majority", "unanimous", "confidence_weighted", "bft_tolerant"]).optional(),
  timeoutMs: z.number().min(1000).max(300000).optional(),
  requiredQuorum: z.number().min(1).max(100).optional(),
});

const voteSchema = z.object({
  agentId: z.string(),
  value: z.enum(["yes", "no", "abstain"]),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
});

const writeBlackboardSchema = z.object({
  agentId: z.string(),
  key: z.string(),
  value: z.any(),
  ttl: z.number().optional(),
});

// ============================================================================
// SWARM MANAGEMENT
// ============================================================================

/**
 * POST /api/swarms
 * Create a new swarm
 */
router.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const data = createSwarmSchema.parse(req.body);

  const swarm = await swarmCoordinator.createSwarm({
    ...data,
    organizationId: orgId,
  });

  res.status(201).json(swarm);
}));

/**
 * GET /api/swarms
 * List swarms for organization
 */
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const swarms = swarmCoordinator.listSwarms(orgId);
  res.json({ swarms, count: swarms.length });
}));

/**
 * GET /api/swarms/:swarmId
 * Get swarm details
 */
router.get("/:swarmId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const swarm = swarmCoordinator.getSwarm(req.params.swarmId);
  if (!swarm) return res.status(404).json({ error: "Swarm not found" });

  res.json(swarm);
}));

/**
 * POST /api/swarms/:swarmId/join
 * Add agent to swarm
 */
router.post("/:swarmId/join", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = joinSwarmSchema.parse(req.body);
  
  const swarm = await swarmCoordinator.joinSwarm(
    req.params.swarmId,
    data.agentId,
    { role: data.role, autoAssignRole: data.autoAssignRole }
  );

  res.json(swarm);
}));

/**
 * POST /api/swarms/:swarmId/leave
 * Remove agent from swarm
 */
router.post("/:swarmId/leave", requireAuth, async (req, res) => {
  try {
    const { agentId } = z.object({ agentId: z.string() }).parse(req.body);
    
    const swarm = await swarmCoordinator.leaveSwarm(req.params.swarmId, agentId);
    res.json(swarm);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/swarms/:swarmId/dissolve
 * Dissolve a swarm (admin only)
 */
router.post("/:swarmId/dissolve", requireOrgAdminOrSuper, async (req, res) => {
  try {
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
    
    await swarmCoordinator.dissolveSwarm(req.params.swarmId, reason);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// CONSENSUS
// ============================================================================

/**
 * POST /api/swarms/:swarmId/proposals
 * Create a new proposal
 */
router.post("/:swarmId/proposals", requireAuth, async (req, res) => {
  try {
    const data = proposeSchema.parse(req.body);
    
    const proposal = await swarmCoordinator.propose(
      req.params.swarmId,
      data.proposerId,
      data.type,
      data.payload,
      {
        algorithm: data.algorithm,
        timeoutMs: data.timeoutMs,
        requiredQuorum: data.requiredQuorum,
      }
    );

    res.status(201).json(proposal);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/swarms/:swarmId/proposals
 * List proposals for swarm
 */
router.get("/:swarmId/proposals", requireAuth, async (req, res) => {
  try {
    const swarm = swarmCoordinator.getSwarm(req.params.swarmId);
    if (!swarm) return res.status(404).json({ error: "Swarm not found" });

    const proposals = swarm.activeProposals
      .map(id => consensusService.getProposal(id))
      .filter(p => p !== undefined);

    res.json({ proposals, count: proposals.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/swarms/:swarmId/proposals/:proposalId
 * Get proposal details
 */
router.get("/:swarmId/proposals/:proposalId", requireAuth, async (req, res) => {
  try {
    const proposal = consensusService.getProposal(req.params.proposalId);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });

    res.json({
      ...proposal,
      votes: Array.from(proposal.votes.entries()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/swarms/:swarmId/proposals/:proposalId/vote
 * Vote on a proposal
 */
router.post("/:swarmId/proposals/:proposalId/vote", requireAuth, async (req, res) => {
  try {
    const data = voteSchema.parse(req.body);
    
    await swarmCoordinator.vote(
      req.params.swarmId,
      data.agentId,
      req.params.proposalId,
      data.value,
      data.confidence,
      data.reasoning
    );

    const proposal = consensusService.getProposal(req.params.proposalId);
    res.json(proposal);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// BLACKBOARD
// ============================================================================

/**
 * GET /api/swarms/:swarmId/blackboard/:namespace
 * Read from blackboard
 */
router.get("/:swarmId/blackboard/:namespace/:key", requireAuth, async (req, res) => {
  try {
    const { agentId } = req.query as { agentId?: string };
    
    const blackboard = sharedBlackboardService.getOrCreate(
      req.params.swarmId, 
      req.params.namespace
    );
    
    const value = await blackboard.read(req.params.key, agentId);
    res.json({ key: req.params.key, value });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/swarms/:swarmId/blackboard/:namespace
 * Write to blackboard
 */
router.post("/:swarmId/blackboard/:namespace", requireAuth, async (req, res) => {
  try {
    const data = writeBlackboardSchema.parse(req.body);
    
    const result = await swarmCoordinator.writeToBlackboard(
      req.params.swarmId,
      data.agentId,
      data.key,
      data.value
    );

    res.json({ success: true, version: result.version });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/swarms/:swarmId/blackboard/:namespace
 * List keys in blackboard namespace
 */
router.get("/:swarmId/blackboard/:namespace", requireAuth, async (req, res) => {
  try {
    const blackboard = sharedBlackboardService.getOrCreate(
      req.params.swarmId,
      req.params.namespace
    );
    
    const pattern = req.query.pattern as string || "*";
    const keys = await blackboard.listKeys(pattern);
    
    res.json({ keys, namespace: req.params.namespace });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// CONFLICTS
// ============================================================================

/**
 * GET /api/swarms/:swarmId/conflicts
 * Get active conflicts
 */
router.get("/:swarmId/conflicts", requireAuth, async (req, res) => {
  try {
    const conflicts = swarmCoordinator.getActiveConflicts(req.params.swarmId);
    res.json({ conflicts, count: conflicts.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/swarms/:swarmId/conflicts/:conflictId/resolve
 * Trigger conflict resolution
 */
router.post("/:swarmId/conflicts/:conflictId/resolve", requireAuth, async (req, res) => {
  try {
    const conflict = conflictResolutionService.getConflict(req.params.conflictId);
    if (!conflict) return res.status(404).json({ error: "Conflict not found" });

    const resolved = await conflictResolutionService.resolve(req.params.conflictId);
    res.json(resolved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// METRICS & HEALTH
// ============================================================================

/**
 * GET /api/swarms/:swarmId/health
 * Get swarm health status
 */
router.get("/:swarmId/health", requireAuth, async (req, res) => {
  try {
    const health = swarmCoordinator.getSwarmHealth(req.params.swarmId);
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/swarms/:swarmId/metrics
 * Get swarm metrics
 */
router.get("/:swarmId/metrics", requireAuth, async (req, res) => {
  try {
    const metrics = swarmCoordinator.getSwarmMetrics(req.params.swarmId);
    if (!metrics) return res.status(404).json({ error: "Swarm not found" });

    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/swarms/:swarmId/heartbeat
 * Agent heartbeat
 */
router.post("/:swarmId/heartbeat", requireAuth, async (req, res) => {
  try {
    const { agentId } = z.object({ agentId: z.string() }).parse(req.body);
    
    await swarmCoordinator.heartbeat(req.params.swarmId, agentId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
