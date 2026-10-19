import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { crossMissionSwarmRegistry } from "./cross-mission-swarm-registry.service.js";
import { z } from "zod";
import { assertOrgId } from "@server/utils/auth-context.js";

export const swarmRouter = Router();
swarmRouter.use(requireAuth);

const createSwarmSchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  missionId: z.number().int().positive(),
});

const joinSwarmSchema = z.object({
  missionId: z.number().int().positive(),
  agentId: z.string().min(1),
  role: z.string().optional(),
});

/**
 * GET /api/swarms
 * List all active cross-mission swarms for the org.
 */
swarmRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const swarms = await crossMissionSwarmRegistry.listActiveSwarms(orgId);
  res.json(swarms);
}));

/**
 * POST /api/swarms
 * Create a new cross-mission swarm.
 */
swarmRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const { name, goal, missionId } = createSwarmSchema.parse(req.body);
  const swarm = await crossMissionSwarmRegistry.createSwarm(orgId, missionId, goal, name);
  res.status(201).json(swarm);
}));

/**
 * GET /api/swarms/:swarmId
 * Get a specific swarm.
 */
swarmRouter.get("/:swarmId", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const swarm = await crossMissionSwarmRegistry.getSwarm(orgId, req.params.swarmId);
  if (!swarm) return res.status(404).json({ error: "Swarm not found" });
  res.json(swarm);
}));

/**
 * POST /api/swarms/:swarmId/join
 * Join a swarm from a mission's agent.
 */
swarmRouter.post("/:swarmId/join", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const { missionId, agentId, role } = joinSwarmSchema.parse(req.body);
  const result = await crossMissionSwarmRegistry.joinSwarm(
    { swarmId: req.params.swarmId, missionId, agentId, role },
    orgId
  );
  res.json(result);
}));

/**
 * POST /api/swarms/:swarmId/leave
 * Agent leaves a swarm.
 */
swarmRouter.post("/:swarmId/leave", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const { agentId } = z.object({ agentId: z.string().min(1) }).parse(req.body);
  await crossMissionSwarmRegistry.leaveSwarm(req.params.swarmId, agentId, orgId);
  res.json({ success: true });
}));

/**
 * GET /api/swarms/by-mission/:missionId
 * Get all swarms a mission is participating in.
 */
swarmRouter.get("/by-mission/:missionId", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const missionId = parseInt(req.params.missionId);
  const swarms = await crossMissionSwarmRegistry.getSwarmsByMission(orgId, missionId);
  res.json(swarms);
}));
