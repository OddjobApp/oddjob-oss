import { z } from "zod";

/**
 * Project Studio plan -> operational cycle: the one contract both commit paths use.
 *
 * Project Studio posted `{ cycleName, waves }` to `/api/cycles/launch`, whose
 * service reads `name` and `blueprints`. The insert failed on the NOT NULL name,
 * the client ignored the 500, and emitted "Committed" anyway — so no plan was
 * ever committed from the UI. The CREW tool `commit_project_plan_to_cycle`
 * wrote its own rows through a third shape that dropped dependencies.
 *
 * Committing SAVES the plan: the cycle is created `pending_approval` and nothing
 * runs until someone approves it through `POST /api/cycles/:id/approve`.
 */

export const PLAN_STUDIO_TARGETS = ["scribe", "app_studio", "media", "computer", "none"] as const;

export const planAssigneeSchema = z.object({
  type: z.enum(["human", "agent", "hybrid"]),
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(200).default(""),
  competency: z.string().max(200).optional(),
  estimatedCostUsd: z.number().finite().min(0).optional(),
  agentCardId: z.string().max(200).optional(),
  tools: z.array(z.string().max(200)).max(100).optional(),
  specialties: z.array(z.string().max(200)).max(100).optional(),
});

const planSquadMemberSchema = planAssigneeSchema.pick({ type: true, name: true, role: true });

export const planTaskSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(500),
  description: z.string().max(5000).optional(),
  isComplete: z.boolean().default(false),
  estimatedHours: z.number().finite().min(0).default(0),
  assigneeName: z.string().max(200).optional(),
  assigneeRole: z.string().max(200).optional(),
  assigneeAgentCardId: z.string().max(200).optional(),
});

export const planWaveSchema = z.object({
  /** Client-side wave identity; dependencies reference it. */
  id: z.string().trim().min(1).max(200),
  /** Becomes the blueprint name, which the runtime keys dependencies on — must be unique. */
  name: z.string().trim().min(1).max(200),
  waveNumber: z.number().int().min(1),
  objective: z.string().trim().min(1).max(5000),
  isCriticalPath: z.boolean().default(false),
  estimatedDurationHours: z.number().finite().min(0).default(0),
  estimateSource: z.enum(["estimated", "unestimated"]).optional(),
  optimisticHours: z.number().finite().min(0).optional(),
  realisticHours: z.number().finite().min(0).optional(),
  pessimisticHours: z.number().finite().min(0).optional(),
  /** IDs of predecessor waves (finish-to-start). */
  dependencies: z.array(z.string().min(1).max(200)).max(100).default([]),
  deliverableBlueprint: z.string().max(500).optional(),
  acceptanceCriteria: z.array(z.string().max(2000)).max(100).default([]),
  tasks: z.array(planTaskSchema).max(200).default([]),
  assignee: planAssigneeSchema,
  squad: z.object({
    lead: planSquadMemberSchema,
    reviewers: z.array(planSquadMemberSchema).max(20).optional(),
    sentinels: z.array(planSquadMemberSchema).max(20).optional(),
  }).optional(),
  studioTarget: z.enum(PLAN_STUDIO_TARGETS).optional(),
  knowledgeNodeIds: z.array(z.string().max(200)).max(200).optional(),
  governance: z.object({
    riskTier: z.enum(["low", "medium", "high", "critical"]),
    requiresDualSignOff: z.boolean(),
    smtInvariants: z.array(z.string().max(2000)).max(100).default([]),
  }).optional(),
});

export type PlanWave = z.infer<typeof planWaveSchema>;
export type PlanWaveInput = z.input<typeof planWaveSchema>;

/** Returns a problem description per structural fault; empty when the wave graph is sound. */
export function findPlanGraphProblems(waves: Array<Pick<PlanWave, "id" | "name" | "dependencies">>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const w of waves) {
    if (ids.has(w.id)) problems.push(`Duplicate wave id "${w.id}".`);
    ids.add(w.id);
    if (names.has(w.name)) problems.push(`Two waves are named "${w.name}"; wave names must be unique.`);
    names.add(w.name);
  }
  for (const w of waves) {
    for (const dep of w.dependencies ?? []) {
      if (dep === w.id) problems.push(`Wave "${w.name}" depends on itself.`);
      else if (!ids.has(dep)) problems.push(`Wave "${w.name}" depends on "${dep}", which is not in this plan.`);
    }
  }
  if (problems.length > 0) return problems;

  // Kahn's algorithm: whatever cannot be ordered sits on a cycle.
  const indegree = new Map(waves.map((w) => [w.id, (w.dependencies ?? []).length]));
  const dependents = new Map<string, string[]>();
  for (const w of waves) {
    for (const dep of w.dependencies ?? []) dependents.set(dep, [...(dependents.get(dep) ?? []), w.id]);
  }
  const ready = waves.filter((w) => indegree.get(w.id) === 0).map((w) => w.id);
  let ordered = 0;
  while (ready.length > 0) {
    const id = ready.pop()!;
    ordered++;
    for (const next of dependents.get(id) ?? []) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  if (ordered < waves.length) {
    const stuck = waves.filter((w) => (indegree.get(w.id) ?? 0) > 0).map((w) => w.name);
    problems.push(`Circular dependency between: ${stuck.join(", ")}.`);
  }
  return problems;
}

const planFields = {
  projectTitle: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(5000),
  budgetLimitUsd: z.number().finite().min(0).max(10_000_000),
  tokenLimit: z.number().int().min(1).max(2_000_000_000),
  maxParallelMissions: z.number().int().min(1).max(100),
  targetSlaDays: z.number().finite().positive().max(3650),
  waves: z.array(planWaveSchema).min(1).max(100),
};

/**
 * The plan itself, without the graph refinement — a plain object so a tool
 * registry can turn it into a function declaration. Whoever accepts it must
 * still run `findPlanGraphProblems` (the commit service does).
 */
export const projectPlanFieldsSchema = z.object(planFields);

const withGraphCheck =<T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((plan: any, ctx) => {
    for (const message of findPlanGraphProblems(plan.waves)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["waves"], message });
    }
  });

/**
 * Request body for `POST /api/cycles/plan-commit`.
 *
 * `idempotencyKey` identifies one commit ATTEMPT of one draft: a retry after an
 * uncertain response resends the same key and gets the same cycle back. Reusing
 * a key with a different plan is a 409, not a silent replay of the old one.
 *
 * `sessionKey` (the room key in the URL) or `crewSessionId` (the numeric id the
 * studio rail holds) names the CREW room; when it resolves, the room's project
 * is authoritative. `projectId` is for callers outside a room. With neither, the
 * server falls back to the caller's active Project Space.
 */
export const projectPlanCommitRequestSchema = withGraphCheck(z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  sessionKey: z.string().trim().min(1).max(200).optional(),
  crewSessionId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  ...planFields,
}));

export type ProjectPlanCommitRequest = z.infer<typeof projectPlanCommitRequestSchema>;
export type ProjectPlanCommitRequestInput = z.input<typeof projectPlanCommitRequestSchema>;

export const projectPlanCommitResponseSchema = z.object({
  cycleId: z.number().int(),
  name: z.string(),
  /** Always the cycle's actual stored status — `pending_approval` for a fresh commit. */
  status: z.string(),
  projectId: z.number().int().nullable(),
  blueprintCount: z.number().int(),
  /** True when this key had already committed and the existing cycle was returned. */
  replayed: z.boolean(),
  cycleUrl: z.string(),
});

export type ProjectPlanCommitResponse = z.infer<typeof projectPlanCommitResponseSchema>;

/** The plan fields a saved cycle can give back to Project Studio. */
export interface RestoredPlan {
  projectTitle: string;
  objective: string;
  budgetLimitUsd?: number;
  tokenLimit?: number;
  maxParallelMissions?: number;
  targetSlaDays?: number;
  waves: PlanWave[];
}

/**
 * Rebuild the wave plan a cycle was saved from, so reopening a cycle in Project
 * Studio shows that plan instead of the studio's built-in example.
 *
 * Reads `metadata.blueprints` as the plan-commit service writes it: each
 * blueprint's `config` carries the wave's own id and fields, and dependencies
 * are blueprint names, mapped back to wave ids here. Returns null for a cycle
 * that was not saved from a wave plan — its blueprints carry no `waveId`, and
 * inventing waves from them would show a plan nobody wrote.
 */
export function planFromCycle(cycle: {
  name?: string | null;
  objective?: string | null;
  budgetLimitUsd?: string | number | null;
  tokenLimit?: number | null;
  executionPolicy?: unknown;
  metadata?: unknown;
} | null | undefined): RestoredPlan | null {
  const meta = (cycle?.metadata ?? {}) as Record<string, any>;
  const blueprints: any[] = Array.isArray(meta.blueprints) ? meta.blueprints : [];
  if (blueprints.length === 0 || !blueprints.every((bp) => typeof bp?.config?.waveId === "string")) return null;

  const idByName = new Map<string, string>(blueprints.map((bp) => [bp.name, bp.config.waveId]));
  const waves = blueprints.map((bp, index) => {
    const c = bp.config;
    const estimate = c.estimate ?? {};
    return planWaveSchema.parse({
      id: c.waveId,
      name: bp.name,
      waveNumber: Number.isInteger(c.waveNumber) && c.waveNumber > 0 ? c.waveNumber : index + 1,
      objective: bp.objective,
      isCriticalPath: Boolean(c.isCriticalPath),
      estimatedDurationHours: Number(estimate.hours) > 0 ? Number(estimate.hours) : 0,
      estimateSource: estimate.source,
      optimisticHours: estimate.optimisticHours,
      realisticHours: estimate.realisticHours,
      pessimisticHours: estimate.pessimisticHours,
      dependencies: (Array.isArray(bp.dependencies) ? bp.dependencies : [])
        .map((d: any) => idByName.get(d?.blueprintName))
        .filter((id: string | undefined): id is string => Boolean(id)),
      deliverableBlueprint: c.deliverableBlueprint,
      acceptanceCriteria: c.acceptanceCriteria ?? [],
      tasks: c.tasks ?? [],
      assignee: c.assignee,
      squad: c.squad,
      studioTarget: c.studioTarget,
      knowledgeNodeIds: c.knowledgeNodeIds,
      governance: c.governance,
    });
  });

  const policy = (cycle?.executionPolicy ?? {}) as Record<string, any>;
  const budget = Number(cycle?.budgetLimitUsd);
  return {
    projectTitle: cycle?.name ?? "",
    objective: cycle?.objective ?? "",
    budgetLimitUsd: Number.isFinite(budget) ? budget : undefined,
    tokenLimit: cycle?.tokenLimit ?? undefined,
    maxParallelMissions: Number.isInteger(policy.maxParallelMissions) ? policy.maxParallelMissions : undefined,
    targetSlaDays: Number(meta.targetSlaDays) > 0 ? Number(meta.targetSlaDays) : undefined,
    waves,
  };
}
