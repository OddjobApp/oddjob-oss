import { Router, type Request, type Response } from "express";
import { missionService } from "../core/mission.service.js";
import { missionQueryService } from "../core/mission-query.service.js";
import { memoryService } from "../core/memory.service.js";
import { missionDependencyResolver } from "../core/mission-dependency-resolver.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { NotFoundError, BadRequestError, ForbiddenError } from "@server/utils/errors.js";
import { MissionAnalystService } from "../core/mission-analyst.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { graphMapper } from "../utils/graph-mapper.js";
import { z } from "zod";
import { createLogger } from "@server/utils/logger.js";
import { getUserOrgContext, requireOrgId, validateOrgAccess } from "@server/utils/auth-context.js";
import {
  buildMissionControlSystemPrompt,
  MISSION_CONTROL_REPLY_STATUSES,
  shouldScheduleMissionControlReply,
} from "../core/mission-copilot-guide.js";

const logger = createLogger("MissionsRoute");

export const missionsRouter = Router();

const missionChatSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(10_000, "Message is too long"),
});

const missionReadinessSchema = z.object({
  name: z.string().default(""),
  objective: z.string().default(""),
  budgetLimitUsd: z.coerce.number().min(0).optional(),
  executionStrategy: z.string().optional(),
  hilStrictness: z.enum(["lenient", "moderate", "strict"]).optional(),
  members: z.array(z.object({
    entityType: z.enum(["job", "pipeline"]),
    entityId: z.number().int().positive().optional(),
    role: z.string().min(1),
  })).default([]),
  knowledgeAssetCount: z.number().int().min(0).optional(),
  documentTemplateCount: z.number().int().min(0).optional(),
  sampleInput: z.string().max(10_000).optional(),
  expectedCriteria: z.string().max(10_000).optional(),
  targetMetric: z.record(z.unknown()).optional(),
});

// Require authentication for all mission routes
missionsRouter.use(requireAuth);

// Keep this literal route before /:id. Never accept an unchecked tenant id.
missionsRouter.get("/similar", asyncHandler(async (req: Request, res: Response) => {
  const { objective } = z.object({ objective: z.string().trim().min(10).max(10_000) }).parse(req.query);
  const context = await getUserOrgContext(req);
  const orgId = requireOrgId(context);
  if (!context.isSuperAdmin && !await validateOrgAccess(orgId, context.userId)) {
    throw new ForbiddenError("Organization access required");
  }
  const { missionKnowledgeBridge } = await import("../core/mission-knowledge-bridge.js");
  const missions = await missionKnowledgeBridge.findSimilarMissions(orgId, objective);
  res.json({ missions });
}));

/**
 * GET /api/missions/tools
 * Returns the full catalog of available agent tools for app deployment scoping.
 * Must be defined before /:id to avoid matching "tools" as an id.
 */
missionsRouter.get("/tools", asyncHandler(async (req: Request, res: Response) => {
  const { getAgentTools } = await import("../../tools/v1/capabilities/index.js");
  const allTools = getAgentTools();
  const tools = Object.values(allTools).map(t => ({
    name: t.name,
    label: t.label || t.name,
    group: t.group || "General",
    description: t.description || "",
  }));
  res.json({ tools });
}));

/**
 * List Mission Templates.
 */
missionsRouter.get("/templates", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : req.organizationId;
  const templates = await missionService.listTemplates(orgId as number);
  res.json(templates);
}));

/**
 * List all RAG assets available for mission attachment (org-scoped picker).
 */
missionsRouter.get("/available/rag-assets", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : (req.organizationId || null);
  const results = await missionService.getAvailableRagAssets(orgId);
  res.json(results);
}));

const planMissionSchema = z.object({
  prompt: z.string().min(1, "Mission prompt is required"),
  history: z.array(z.any()).optional().default([])
});

const updateMissionPatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  status: z.string().optional(),
  budgetLimitUsd: z.number().min(0).optional(),
  governorPolicyId: z.number().int().optional().nullable(),
  isScheduled: z.boolean().optional(),
  scheduleConfig: z.record(z.any()).optional().nullable(),
  frequency: z.string().optional(),
  reasoningProtocol: z.enum(["json_manifest", "hermes_xml"]).optional(),
  executionStrategy: z.enum(["pre_planned", "dynamic_autonomous", "rolling_wave", "parallel_fan_out", "human_driven", "reactive"]).optional(),
  hilNotificationChannels: z.array(z.string()).optional(),
  humanSteeringNudge: z.string().optional().nullable(),
  /** PSBS: Explicit human override for steering intensity [0-1]. null = let synthesis feedback control it. */
  steeringAlpha: z.number().min(0).max(1).optional().nullable(),
  isShadowMode: z.boolean().optional(),
  autoSynthesis: z.boolean().optional(),
  recursiveOptimization: z.boolean().optional(),
  evaluationConsensusThreshold: z.number().int().min(1).optional(),
  isDraft: z.boolean().optional(),
  workspacePath: z.string().optional().nullable(),
  vcsConfig: z.record(z.any()).optional(),
  isXRayIndexed: z.boolean().optional(),
  workflowBlueprint: z.record(z.any()).optional().nullable(),
  targetMetric: z.record(z.any()).optional().nullable(),
}).strict();

/**
 * AI Mission Planning.
 */
missionsRouter.post("/plan", asyncHandler(async (req: Request, res: Response) => {
  const { prompt, history } = planMissionSchema.parse(req.body);
  const userId = (req as any).user?.id;
  const orgId = req.organizationId;
  if (!userId || !orgId) throw new BadRequestError("Authenticated user with organization context required");

  const plan = await missionService.planMission(prompt, userId, orgId, history);
  res.json(plan);
}));

/**
 * Instantiate a template manually.
 */
missionsRouter.post("/templates/:id/instantiate", asyncHandler(async (req: Request, res: Response) => {
  const templateId = parseInt(req.params.id);
  const { name, viaAppSlug, scheduleConfig } = req.body;
  const userId = (req as any).user?.id || "system"; // Mock
  const orgId = req.organizationId;

  if (!name) return res.status(400).json({ error: "Name is required" });

  const newGroup = await missionService.instantiateTemplate(templateId, name, userId, orgId as number, viaAppSlug, scheduleConfig);
  res.status(201).json(newGroup);
}));

missionsRouter.get("/:id/activity", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });

  // Super admins bypass org filter; regular users are scoped to their org.
  const orgContext = await getUserOrgContext(req);
  if (!orgContext.isSuperAdmin && orgContext.organizationId) {
    const mission = await missionService.getMissionById(id, orgContext.organizationId);
    if (!mission) return res.status(404).json({ error: "Mission not found" });
  }

  logger.info(`GET /api/missions/${id}/activity`);
  const activity = await missionService.getActivity(id);
  logger.debug(`Returning ${activity.length} activity items for mission ${id}`);
  res.json(activity);
}));

/**
 * Phase 6: Promote a shadow run to a Master Blueprint.
 */
missionsRouter.post("/shadows/:id/promote-to-blueprint", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const { missionRunService } = await import("../core/mission-run.service.js");
  const template = await missionRunService.extractShadowRunToTemplate(id, name, description);
  res.status(201).json(template);
}));

/**
 * Get shared memories for a mission.
 */
missionsRouter.get("/:id/memories", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const memories = await memoryService.getRelevantMemories(id);
  res.json(memories);
}));

/**
 * Get global activity stream for an organization.
 */
missionsRouter.get("/activity/global", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : req.organizationId;
  const timeRange = (req.query.timeRange as string) || "24h";
  const activity = await missionService.listGlobalActivity(orgId as number, timeRange);
  res.json(activity);
}));

/**
 * System X-Ray Explorer Graph.
 */
missionsRouter.get("/explorer/graph", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  // Super admins may inspect a specific tenant via ?orgId=N, but the graph is
  // always rendered for exactly one organization — there is no "all orgs" view.
  const orgId = orgContext.isSuperAdmin && req.query.orgId
    ? parseInt(req.query.orgId as string, 10)
    : requireOrgId(orgContext);
  if (Number.isNaN(orgId)) throw new BadRequestError("Invalid orgId");

  const data = await graphMapper.getSystemGraph(orgId);
  res.json(data);
}));

/**
 * List all workgroups for an organization.
 * - `?orgId=N` always wins (super admins use this to view a specific tenant)
 * - Super admins without `?orgId=` see all missions across all orgs
 * - Regular users always see only their own org's missions
 */
missionsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  let orgId: number | undefined;
  if (req.query.orgId) {
    orgId = parseInt(req.query.orgId as string);
  } else if (orgContext.isSuperAdmin) {
    orgId = 0; // listMissionsWithStats treats 0 as "all orgs"
  } else {
    orgId = orgContext.organizationId ?? undefined;
  }
  const results = await missionService.listMissionsWithStats(orgId);
  res.json(results);
}));

/**
 * Launch a mission from the workgroup.
 * Triggers the Mission Supervisor with the workgroup objective + last user message.
 */
missionsRouter.post("/:id/launch-mission", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const userId = (req as any).user?.id || "user";
  const orgId = req.query.orgId ? parseInt(req.query.orgId as string) : req.organizationId;

  const workgroup = await missionService.getMissionDetail(id);
  if (!workgroup) {
    throw new NotFoundError("Workgroup not found");
  }

  const result = await missionService.launchMission(id, userId, workgroup.organizationId ?? orgId ?? null);
  if (!result.success) {
    return res.status(400).json({ error: result.error, success: false });
  }
  res.json({
    success: true,
    executionId: result.executionId,
    missionId: result.missionId,
    missionRunId: (result as any).missionRunId,
  });
}));

/**
 * Send a message to the workgroup (Mission Control).
 * Updates the blackboard with the message for agents to see.
 * Also triggers Mid-Mission Chat if a mission run is active.
 */
missionsRouter.post("/:id/chat", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    throw new Error("Invalid mission ID");
  }
  const parsedChat = missionChatSchema.safeParse(req.body);
  if (!parsedChat.success) {
    throw new BadRequestError(parsedChat.error.issues[0]?.message ?? "Invalid chat message");
  }
  const { message } = parsedChat.data;
  const userId = (req as any).user?.id || "user";

  const workgroup = await missionService.getMissionDetail(id);
  if (!workgroup) {
    throw new NotFoundError("Workgroup not found");
  }

  const currentBlackboard = (workgroup.blackboard as any) || {};
  const messages = currentBlackboard.messages || [];

  const newMessage = {
    id: Date.now().toString(),
    role: "user",
    content: message,
    sender: userId,
    timestamp: new Date().toISOString()
  };

  const updatedBlackboard = {
    ...currentBlackboard,
    messages: [...messages, newMessage],
    // Update "latest guidance" for higher priority visibility
    lastUserGuidance: {
      content: message,
      timestamp: new Date().toISOString()
    }
  };

  await missionService.queueBlackboardUpdate(
    id,
    updatedBlackboard,
    userId,
    `User chat: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`
  );

  // -------------------------------------------------------------
  // Mid-Mission Chat Intervention
  // -------------------------------------------------------------
  // Check if there's an ACTIVE mission run for this blackboard.
  // If so, spawn an asynchronous worker to analyze the chat and
  // reply natively via the system AI.
  let replyScheduled = false;
  try {
    const { missionRunService } = await import("../core/mission-run.service.js");
    const activeRuns = await (missionRunService as any).list({
      missionId: id, 
      statuses: [...MISSION_CONTROL_REPLY_STATUSES],
    });

    const replyRun = activeRuns.find((run: { status?: string }) => shouldScheduleMissionControlReply(run.status));
    if (replyRun) {
      replyScheduled = true;
      logger.info(`Mid-Mission Chat: detected run for Mission ${id} with status ${replyRun.status}, spawning response worker`);

      // Fire-and-forget: do not block the HTTP response
      setImmediate(async () => {
        try {
          const { systemAiService } = await import("../../ai/core/system-ai.service.js");
          const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

          logger.debug(`Mid-Mission Chat: fetching AI config for org ${workgroup.organizationId}`);
          const aiConfig = await systemAiService.getAiConfig('copilot', workgroup.organizationId ?? undefined);

          // Build mission RAG context for chat
          logger.debug(`Mid-Mission Chat: fetching RAG context for mission ${id}`);
          const missionRagContext = await missionService.getMissionRagContext(id);

          const systemPrompt = buildMissionControlSystemPrompt({
            missionName: workgroup.name ?? "Untitled mission",
            missionObjective: workgroup.objective ?? "No objective provided",
            missionStatus: replyRun.status,
            ragContext: missionRagContext,
          });

          if (!aiConfig || !aiConfig.apiKey) {
            throw new Error("No AI configuration found for Mission Control reply");
          }

          const client = AIClientFactory.getClient({
            provider: aiConfig.provider,
            baseUrl: aiConfig.baseUrl
          } as any);

          const aiReply = await client.execute({
            model: aiConfig.model,
            systemPrompt: systemPrompt,
            userPrompt: message,
            temperature: 0.7,
            useCache: false,
            saveOutputToFile: false,
            credentialId: aiConfig.credentialId || 0
          }, undefined, aiConfig.apiKey);

          // Update blackboard with AI response
          const botMessage = {
            id: Date.now().toString(),
            role: "assistant",
            content: aiReply.output || "I am currently processing your request.",
            sender: "Mission Control",
            timestamp: new Date().toISOString()
          };

          // Re-fetch to prevent race conditions
          const freshWorkgroup = await missionService.getMissionDetail(id);
          const freshBlackboard = (freshWorkgroup?.blackboard as any) || {};
          const freshMessages = freshBlackboard.messages || [];

          const botUpdatedBlackboard = {
            ...freshBlackboard,
            messages: [...freshMessages, botMessage]
          };

          await missionService.queueBlackboardUpdate(
            id,
            botUpdatedBlackboard,
            "system",
            `Mission Control Reply: ${aiReply.output?.slice(0, 50)}...`
          );

        } catch (botErr) {
          logger.error(`Mid-Mission Chat: failed to generate AI response`, botErr as Error);
        }
      });
    }
  } catch (err) {
    logger.error(`Mid-Mission Chat: failed checking active runs`, err as Error);
  }

  res.json({ success: true, message: newMessage, replyScheduled });
}));

/**
 * Get workgroup health score.
 */
missionsRouter.get("/:id/health", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const health = await missionService.getHealth(id);
  res.json(health);
}));

/**
 * GET /api/missions/:id/pending-approvals
 * Returns all pending HIL approval requests linked to this mission.
 */
missionsRouter.get("/:id/pending-approvals", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });

  const orgContext = await getUserOrgContext(req);
  const pending = await missionQueryService.listPendingApprovals(id, requireOrgId(orgContext));

  res.json({ approvals: pending });
}));

/**
 * Get workgroup detail with members.
 * Prunes large blackboard fields for UI stability.
 * Super admins can view any mission; regular users are scoped to their org.
 */
missionsRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const workgroup = await missionService.getMissionDetail(id);

  if (!workgroup) {
    throw new NotFoundError("Workgroup not found");
  }

  const orgContext = await getUserOrgContext(req);
  if (!orgContext.isSuperAdmin && orgContext.organizationId && workgroup.organizationId !== orgContext.organizationId) {
    throw new NotFoundError("Workgroup not found");
  }

  // PRUNING LOGIC: If blackboard exists, truncate large fields for UI stability
  const rawBB = (workgroup.blackboard as Record<string, any>) || {};
  const prunedBB: Record<string, any> = {};
  const LARGE_THRESHOLD = 50000; // 50KB

  for (const [key, value] of Object.entries(rawBB)) {
    // Only prune tool outputs and step caches, keep core variables and messages
    if (key.startsWith('tool_output_') || key.startsWith('step_')) {
      const strValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (strValue.length > LARGE_THRESHOLD) {
        prunedBB[key] = `[TRUNCATED: ${strValue.length} characters. Fetch full content via specialized API]`;
        continue;
      }
    }
    prunedBB[key] = value;
  }

  // Calculate real-time spend
  const currentSpend = await missionService.calculateTotalSpend(id);

  res.json({
    ...workgroup,
    blackboard: prunedBB,
    currentSpendUsd: currentSpend.toFixed(2)
  });
}));

/**
 * Get a specific key from the mission blackboard (full content).
 */
missionsRouter.get("/:id/blackboard/:key", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const key = req.params.key;
  const workgroup = await missionService.getMissionDetail(id);

  if (!workgroup) {
    throw new NotFoundError("Workgroup not found");
  }

  const blackboard = (workgroup.blackboard as Record<string, any>) || {};
  const value = blackboard[key];

  if (value === undefined) {
    return res.status(404).json({ error: `Key '${key}' not found on blackboard` });
  }

  res.json({ key, value });
}));

/**
 * Get blackboard history for time-travel debugging.
 */
missionsRouter.get("/:id/history", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const history = await missionService.getBlackboardHistory(id);
  res.json(history);
}));

/**
 * Add a member to the workgroup.
 */
missionsRouter.post("/:id/members", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { entityType, entityId, role } = req.body;

  if (!entityType || !entityId) {
    return res.status(400).json({ error: "Missing entityType or entityId" });
  }

  await missionService.addMember({
    missionId: id,
    entityType,
    entityId,
    role: role || "member"
  });
  res.status(201).json({ success: true });
}));

/**
 * Update member status (Pause/Resume).
 */
missionsRouter.post("/:id/members/:memberId/status", asyncHandler(async (req: Request, res: Response) => {
  const memberId = parseInt(req.params.memberId);
  const { status } = req.body;

  if (!status) return res.status(400).json({ error: "Status is required" });

  await missionService.updateMemberStatus(memberId, status);
  res.json({ success: true, status });
}));

/**
 * Remove a member from the workgroup.
 */
missionsRouter.delete("/:id/members/:entityType/:entityId", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { entityType, entityId } = req.params;

  if (!entityType || !entityId) {
    return res.status(400).json({ error: "Missing entityType or entityId" });
  }

  const success = await missionService.removeMember(id, entityType, parseInt(entityId));
  if (!success) {
    throw new NotFoundError("Member not found in mission");
  }
  res.json({ success: true });
}));

/**
 * Create a template from an existing workgroup.
 */
missionsRouter.post("/:id/template", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const { name, description } = req.body;
  // Mock user/org for now
  const userId = (req as any).user?.id || "system";
  const orgId = req.organizationId;

  if (!name) return res.status(400).json({ error: "Mission Template name is required" });

  const template = await missionService.createTemplate(missionId, name, description, userId, orgId as number);
  res.json(template);
}));

/**
 * Update workgroup details.
 */
missionsRouter.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const userId = (req as any).user?.id || "user";
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.isSuperAdmin ? null : (orgContext.organizationId ?? null);

  const parsed = updateMissionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.error(`[PATCH /api/missions/${id}] Validation failed:`, JSON.stringify(parsed.error.issues, null, 2));
    return res.status(400).json({ error: "Invalid update data", issues: parsed.error.issues });
  }

  const updated = await missionService.updateMission(id, parsed.data, userId, orgId);
  res.json(updated);
}));

/**
 * Pause a mission.
 */
missionsRouter.post("/:id/pause", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.isSuperAdmin ? null : (orgContext.organizationId ?? null);
  const result = await missionService.pauseMission(id, orgId);
  res.json(result);
}));

/**
 * Resume a mission.
 */
missionsRouter.post("/:id/resume", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.isSuperAdmin ? null : (orgContext.organizationId ?? null);
  const result = await missionService.resumeMission(id, orgId);
  res.json(result);
}));

/**
 * Terminate a mission.
 */
missionsRouter.post("/:id/terminate", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid mission id" });
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.isSuperAdmin ? null : (orgContext.organizationId ?? null);
  const result = await missionService.terminateMission(id, orgId);
  res.json(result);
}));



/**
 * Validate workgroup creation payload (dependencies, members).
 * POST /api/workgroups/validate - same body as create.
 */
missionsRouter.post("/validate", asyncHandler(async (req: Request, res: Response) => {
  const { members, organizationId } = req.body;
  const orgId = organizationId != null ? Number(organizationId) : (req.organizationId || null);
  const memberInputs = (members || []).map((m: any) => ({
    entityType: m.entityType || "job",
    entityId: m.entityId != null ? Number(m.entityId) : undefined,
    role: m.role || "member",
  }));
  const result = await missionDependencyResolver.validateAndResolve(memberInputs, orgId);
  res.json(result);
}));

/**
 * Unified mission readiness lab. This is a plan-only dry run: it validates
 * dependencies, policy, permissions, budget, knowledge, and evaluation evidence
 * without executing tools or touching external systems.
 */
missionsRouter.post("/preflight", asyncHandler(async (req: Request, res: Response) => {
  const input = missionReadinessSchema.parse(req.body);
  const orgContext = await getUserOrgContext(req);
  if (!orgContext.organizationId) throw new BadRequestError("Organization context required");
  const { missionReadinessService } = await import("../core/mission-readiness.service.js");
  res.json(await missionReadinessService.assess(input, orgContext.organizationId));
}));

/**
 * Create a new workgroup manually.
 */
missionsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { name, objective, organizationId, members, saveAsTemplate, executionStrategy, reasoningProtocol } = req.body;
  const userId = (req as any).user?.id || "system"; // Basic user tracking
  const strict = req.query.strict !== "false";

  if (!name || !objective) {
    return res.status(400).json({ error: "Name and objective are required" });
  }

  const memberInputs = (members || []).map((m: any) => ({
    entityType: m.entityType || "job",
    entityId: m.entityId != null ? Number(m.entityId) : undefined,
    role: m.role || "member",
  }));

  const validation = await missionDependencyResolver.validateAndResolve(
    memberInputs,
    organizationId != null ? Number(organizationId) : (req.organizationId || null)
  );

  if (!validation.valid && strict) {
    return res.status(400).json({
      error: "Dependencies not resolved",
      details: validation,
    });
  }

  // Budget check + personality injection when launching via app
  let personalityModifier = "";
  if (req.body.blackboard?.viaAppSlug) {
    try {
      const orgId2 = organizationId || (req.organizationId || null);
      if (orgId2) {
        const { AppDeploymentService } = await import("../../apps/app-deployment.service.js");
        // getBySlug is the non-throwing alias. getPublicDeployment throws NotFoundError,
        // which the budget catch below turns into a 400 — so an app slug with no
        // deployment used to fail mission creation outright instead of just skipping
        // personality injection, which is what the `if (dep)` guard intends.
        const publicDep = await AppDeploymentService.getBySlug(req.body.blackboard.viaAppSlug);
        const dep = publicDep?.deployment;
        if (dep) {
          const numericUserId = parseInt(userId) || 0;
          await AppDeploymentService.checkBudget(dep.id, numericUserId);

          // Build personality modifier from OCEAN traits + soul archetype
          const { buildPersonalityModifier } = await import("../../agents/core/app-personality.service.js");
          personalityModifier = buildPersonalityModifier(
            dep.oceanTraits as any,
            dep.soulArchetype ?? undefined
          );
        }
      }
    } catch (budgetErr: any) {
      return res.status(400).json({ error: budgetErr.message || "Budget limit exceeded" });
    }
  }

  const newGroup = await missionService.createMission({
    name,
    objective: personalityModifier ? `${personalityModifier}\n\n${objective}` : objective,
    // Project space context (optional): the mission is filed under it through
    // project_resources once created. projectService re-validates the project
    // against this org, so a foreign or invisible project just leaves the
    // mission unfiled rather than crossing the boundary.
    projectId: req.body.projectId ?? null,
    projectKey: req.body.projectKey ?? null,
    executionStrategy: executionStrategy || "pre_planned",
    reasoningProtocol: reasoningProtocol || "json_manifest",
    budgetLimitUsd: req.body.budgetLimitUsd,
    dynamicCycleBudgetLimitUsd: req.body.dynamicCycleBudgetLimitUsd,
    hilStrictness: req.body.hilStrictness,
    hilNotificationChannels: req.body.hilNotificationChannels,
    targetMetric: req.body.targetMetric,
    isShadowMode: req.body.isShadowMode,
    organizationId: organizationId || (req.organizationId || null),
    type: "collaborative", // Default to collaborative for now, or letting UI specify
    createdBy: userId,
    blackboard: {},
  }, userId, members || [], !!saveAsTemplate, req.body.workflow);

  res.status(201).json(newGroup);
}));

/**
 * Diagnostic: find tables blocking workgroup delete.
 * GET /api/workgroups/:id/delete-diagnostic
 */
missionsRouter.get("/:id/delete-diagnostic", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: "Invalid mission id" });
  }
  const result = await missionService.getDeleteDiagnostic(id);
  res.json(result);
}));

/**
 * Delete a workgroup.
 */
missionsRouter.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const userId = (req as any).user?.id || "user";
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.isSuperAdmin ? null : (orgContext.organizationId ?? null);

  await missionService.deleteMission(id, { organizationId: orgId, userId });
  res.json({ success: true, message: "Mission deleted" });
}));

/**
 * MISSION ANALYST & SUGGESTIONS
 */

missionsRouter.get("/:id/suggestions", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const results = await MissionAnalystService.listSuggestions(missionId);
  res.json(results);
}));

missionsRouter.post("/runs/:id/analyze", asyncHandler(async (req: Request, res: Response) => {
  const missionRunId = parseInt(req.params.id);
  const orgId = req.organizationId || (req.query.orgId ? parseInt(req.query.orgId as string) : 1);
  const suggestions = await MissionAnalystService.analyzeMissionRun(missionRunId, orgId);
  res.json(suggestions);
}));

missionsRouter.post("/suggestions/:id/apply", asyncHandler(async (req: Request, res: Response) => {
  const suggestionId = parseInt(req.params.id);
  const result = await MissionAnalystService.applySuggestion(suggestionId);
  res.json(result);
}));

missionsRouter.post("/suggestions/:id/dismiss", asyncHandler(async (req: Request, res: Response) => {
  const suggestionId = parseInt(req.params.id);
  await MissionAnalystService.dismissSuggestion(suggestionId);
  res.json({ success: true });
}));

// ============================================================================
// MISSION RAG ASSETS
// ============================================================================

/**
 * List RAG assets attached to a mission.
 */
missionsRouter.get("/:id/assets", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const attachments = await missionService.listRagAssets(missionId);
  res.json(attachments);
}));

/**
 * Attach a RAG asset to a mission.
 */
missionsRouter.post("/:id/assets", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const { ragAssetId, purpose } = req.body;
  const userId = (req as any).user?.id || "system";

  if (!ragAssetId) {
    return res.status(400).json({ error: "ragAssetId is required" });
  }

  const attached = await missionService.attachRagAsset(missionId, ragAssetId, purpose, userId);
  res.status(201).json(attached);
}));

/**
 * Detach a RAG asset from a mission.
 */
missionsRouter.delete("/:id/assets/:attachmentId", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const attachmentId = parseInt(req.params.attachmentId);

  await missionService.detachRagAsset(missionId, attachmentId);
  res.json({ success: true });
}));

// ============================================================================
// MISSION DOCUMENT TEMPLATES
// ============================================================================

/**
 * List document templates attached to a mission.
 */
missionsRouter.get("/:id/document-templates", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const attachments = await missionService.listDocumentTemplates(missionId);
  res.json(attachments);
}));

/**
 * Attach a document template to a mission.
 */
missionsRouter.post("/:id/document-templates", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const { documentTemplateId, role } = req.body;
  const userId = (req as any).user?.id || "system";

  if (!documentTemplateId) {
    return res.status(400).json({ error: "documentTemplateId is required" });
  }

  const attached = await missionService.attachDocumentTemplate(missionId, documentTemplateId, role, userId);
  res.status(201).json(attached);
}));

/**
 * Detach a document template from a mission.
 */
missionsRouter.delete("/:id/document-templates/:attachmentId", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const attachmentId = parseInt(req.params.attachmentId);

  await missionService.detachDocumentTemplate(missionId, attachmentId);
  res.json({ success: true });
}));

// ============================================================================
// MISSION FILE ATTACHMENTS
// ============================================================================

/**
 * List file attachments for a mission.
 */
missionsRouter.get("/:id/file-attachments", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const attachments = await missionService.listFileAttachments(missionId);
  res.json(attachments);
}));

/**
 * Create a new file attachment for a mission.
 */
missionsRouter.post("/:id/file-attachments", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const { fileName, contentType, fileSize, fileData, textContent, purpose } = req.body;
  const userId = (req as any).user?.id || "system";

  if (!fileName || !fileData) {
    return res.status(400).json({ error: "fileName and fileData are required" });
  }

  const attachment = await missionService.attachFile(missionId, { fileName, contentType, fileSize, fileData, textContent, purpose }, userId);
  res.json(attachment);
}));

/**
 * Delete a file attachment from a mission.
 */
missionsRouter.delete("/:id/file-attachments/:attachmentId", asyncHandler(async (req: Request, res: Response) => {
  const missionId = parseInt(req.params.id);
  const attachmentId = parseInt(req.params.attachmentId);

  await missionService.detachFile(missionId, attachmentId);
  res.json({ success: true });
}));
