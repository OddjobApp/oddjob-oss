import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { operationalCycles, cycleBlueprints, adminRoles } from "@shared/schema/index.js";
import {
  findPlanGraphProblems,
  projectPlanFieldsSchema,
  type PlanWave,
  type ProjectPlanCommitResponse,
} from "@shared/project-plan-commit.js";
import type { z } from "zod";
import { BadRequestError, ConflictError, ForbiddenError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { invalidateCachePattern } from "@server/utils/cache-utils.js";
import { cacheService } from "@domain/cache/cache.service.js";
import { projectService, type ProjectCtx } from "@domain/projects/core/project.service.js";
import { crewRepository } from "@domain/crew/core/crew-repository.js";
import { emitCycleEvent } from "./cycle-manager.service.js";

const logger = createLogger("ProjectPlanCommit");

export type ProjectPlan = z.infer<typeof projectPlanFieldsSchema>;

export interface PlanCommitActor {
  organizationId: number;
  userId: string;
  isSuperAdmin?: boolean;
  isOrgAdmin?: boolean;
  /** Agent principal acting through a tool; applies its project ceiling. */
  agentId?: string;
}

export interface PlanCommitInput {
  plan: ProjectPlan;
  idempotencyKey: string;
  /** CREW room key. When the room exists and belongs to a project, that project wins. */
  sessionKey?: string;
  /** CREW room by numeric id (what the studio rail holds); same rules as sessionKey. */
  crewSessionId?: number;
  /** Project named by the caller. Must agree with the room's project when both exist. */
  projectId?: number;
  /** Project already resolved by the invoking context (e.g. a tool's active project). */
  contextProjectId?: number | null;
  /**
   * The caller's active Project Space (the header switcher). Used only when no
   * room project and no explicit project apply — a weaker signal than either.
   */
  fallbackProjectId?: number | null;
}

/** Key order must not change the digest: a retry re-serialises the same plan. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planDigest(plan: ProjectPlan, projectId: number | null): string {
  return createHash("sha256").update(canonicalJson({ projectId, plan })).digest("hex");
}

/**
 * The runtime shape `spawnBlueprintsWithDeps` reads from `metadata.blueprints`
 * when the cycle is approved.
 *
 * A human-assigned wave becomes a `milestone` that pauses the cycle rather than a
 * `mission`: a mission is an AI run, and spawning one for "Supervisory Human
 * Lead" would have an agent do the human's job. Everything the plan said about
 * the wave rides along in `config` so nothing the author entered is dropped.
 */
export function toRuntimeBlueprints(waves: PlanWave[]) {
  const nameById = new Map(waves.map((w) => [w.id, w.name]));
  return waves.map((w) => {
    const isHuman = w.assignee.type === "human";
    return {
      name: w.name,
      objective: w.objective,
      type: isHuman ? "milestone" : "mission",
      ...(isHuman ? { pauseAtMilestone: true } : {}),
      dependencies: w.dependencies.map((dep) => ({
        blueprintName: nameById.get(dep)!,
        type: "finish_to_start",
      })),
      // Unestimated waves carry no duration rather than an invented one.
      ...(w.estimatedDurationHours > 0 ? { estimatedDuration: w.estimatedDurationHours, timeUnit: "h" } : {}),
      config: {
        waveId: w.id,
        waveNumber: w.waveNumber,
        workMode: w.assignee.type,
        isCriticalPath: w.isCriticalPath,
        assignee: w.assignee,
        squad: w.squad,
        studioTarget: w.studioTarget ?? "none",
        deliverableBlueprint: w.deliverableBlueprint,
        acceptanceCriteria: w.acceptanceCriteria,
        tasks: w.tasks,
        governance: w.governance,
        knowledgeNodeIds: w.knowledgeNodeIds,
        estimate: {
          source: w.estimateSource ?? (w.estimatedDurationHours > 0 ? "estimated" : "unestimated"),
          hours: w.estimatedDurationHours,
          optimisticHours: w.optimisticHours,
          realisticHours: w.realisticHours,
          pessimisticHours: w.pessimisticHours,
        },
      },
    };
  });
}

async function resolveProjectId(input: PlanCommitInput, actor: PlanCommitActor): Promise<number | null> {
  let authoritative: number | null = input.contextProjectId ?? null;

  if (input.sessionKey || input.crewSessionId) {
    // Org-scoped lookup: a room from another tenant resolves to nothing. A room
    // nobody has spoken in yet does not exist server-side, and simply
    // contributes no project.
    const session = input.crewSessionId
      ? await crewRepository.findSessionById(actor.organizationId, input.crewSessionId)
      : await crewRepository.findSession(actor.organizationId, input.sessionKey!);
    if (session?.projectId != null) {
      if (authoritative != null && authoritative !== session.projectId) {
        throw new BadRequestError(
          "The CREW room belongs to a different project than the active one.",
          { roomProjectId: session.projectId, contextProjectId: authoritative },
          "PROJECT_MISMATCH",
        );
      }
      authoritative = session.projectId;
    }
  }

  if (input.projectId != null && authoritative != null && input.projectId !== authoritative) {
    throw new BadRequestError(
      "The plan names a different project than the one this room belongs to.",
      { requestedProjectId: input.projectId, roomProjectId: authoritative },
      "PROJECT_MISMATCH",
    );
  }

  const projectId = authoritative ?? input.projectId ?? input.fallbackProjectId ?? null;
  if (projectId == null) {
    // No project to hold the plan, so no project role to check. Creating an
    // org-level cycle is the org-admin act /api/cycles/launch gates on.
    if (!actor.isOrgAdmin && !actor.isSuperAdmin) {
      throw new ForbiddenError("Saving a plan outside a project requires an organization admin. Open the room in a project you can edit.");
    }
    return null;
  }

  const ctx: ProjectCtx = {
    organizationId: actor.organizationId,
    userId: actor.userId,
    isSuperAdmin: actor.isSuperAdmin,
    isOrgAdmin: actor.isOrgAdmin,
    agentId: actor.agentId,
  };
  // getProject is org-scoped and applies the private-project read gate (a
  // foreign or invisible project is a 404); saving a plan into it is a write.
  const project = await projectService.getProject(ctx, projectId);
  await projectService.assertCanEdit(ctx, project);
  return project.id;
}

/**
 * The requester's org roles, for callers without an HTTP request (CREW tools).
 *
 * Read from admin_roles by the authenticated user id — the same rows
 * getUserOrgContext reads. A tool context must not simply claim admin: the
 * CREW context carries no role flags, and adding them there would widen every
 * admin-gated tool at once.
 */
export async function resolvePlanActorRoles(userId: string, orgId: number): Promise<{ isOrgAdmin: boolean; isSuperAdmin: boolean }> {
  const rows = await db.select({ role: adminRoles.role, organizationId: adminRoles.organizationId })
    .from(adminRoles)
    .where(eq(adminRoles.userId, userId));
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");
  const isOrgAdmin = isSuperAdmin || rows.some((r) => r.role === "org_admin" && r.organizationId === orgId);
  return { isOrgAdmin, isSuperAdmin };
}

function toResponse(
  cycle: { id: number; name: string; status: string; projectId: number | null; blueprintCount: number | null },
  replayed: boolean,
): ProjectPlanCommitResponse {
  return {
    cycleId: cycle.id,
    name: cycle.name,
    status: cycle.status,
    projectId: cycle.projectId,
    blueprintCount: cycle.blueprintCount ?? 0,
    replayed,
    cycleUrl: `/operations/cycles/${cycle.id}`,
  };
}

/**
 * Save a Project Studio plan as an operational cycle awaiting approval.
 *
 * Persistence only: nothing is spawned and no synthesis job is queued. The cycle
 * starts when someone approves it (`POST /api/cycles/:id/approve`), which spawns
 * from `metadata.blueprints` — the same path every other pending cycle takes.
 *
 * The cycle and its blueprints are written in one transaction under an advisory
 * lock on (org, idempotency key), so a retry after a lost response — or two
 * concurrent submits — returns the one cycle instead of creating a second.
 */
export async function commitProjectPlan(
  input: PlanCommitInput,
  actor: PlanCommitActor,
): Promise<ProjectPlanCommitResponse> {
  const plan = projectPlanFieldsSchema.parse(input.plan);
  const problems = findPlanGraphProblems(plan.waves);
  if (problems.length > 0) {
    throw new BadRequestError(problems.join(" "), { problems }, "INVALID_PLAN");
  }

  const projectId = await resolveProjectId(input, actor);
  const orgId = actor.organizationId;
  const key = input.idempotencyKey;
  const digest = planDigest(plan, projectId);
  const runtimeBlueprints = toRuntimeBlueprints(plan.waves);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project-plan-commit:${orgId}:${key}`}))`);

    const [existing] = await tx
      .select()
      .from(operationalCycles)
      .where(and(
        eq(operationalCycles.organizationId, orgId),
        sql`${operationalCycles.metadata}->'planCommit'->>'key' = ${key}`,
      ))
      .limit(1);

    if (existing) {
      const previousDigest = (existing.metadata as Record<string, any> | null)?.planCommit?.digest;
      if (previousDigest !== digest) {
        throw new ConflictError(
          "This commit key was already used for a different version of the plan.",
          { code: "IDEMPOTENCY_KEY_REUSED", cycleId: existing.id },
        );
      }
      return { cycle: existing, replayed: true };
    }

    const [cycle] = await tx.insert(operationalCycles).values({
      name: plan.projectTitle,
      objective: plan.objective,
      status: "pending_approval",
      requiresApproval: 1,
      organizationId: orgId,
      projectId,
      budgetLimitUsd: plan.budgetLimitUsd.toFixed(2),
      tokenLimit: plan.tokenLimit,
      blueprintCount: plan.waves.length,
      executionPolicy: { maxParallelMissions: plan.maxParallelMissions },
      metadata: {
        source: "project_studio",
        // The approve route reads durationDays to set the end date.
        durationDays: plan.targetSlaDays,
        targetSlaDays: plan.targetSlaDays,
        planCommit: {
          key,
          digest,
          sessionKey: input.sessionKey ?? null,
          crewSessionId: input.crewSessionId ?? null,
          committedAt: new Date().toISOString(),
        },
        blueprints: runtimeBlueprints,
      },
      createdBy: actor.userId,
    }).returning();

    await tx.insert(cycleBlueprints).values(runtimeBlueprints.map((bp) => ({
      cycleId: cycle.id,
      name: bp.name,
      objective: bp.objective,
      type: bp.type,
      dependencies: bp.dependencies,
      estimatedDays: Math.max(1, Math.ceil((bp.estimatedDuration ?? 24) / 24)),
      waveIndex: bp.config.waveNumber,
      onCriticalPath: bp.config.isCriticalPath,
      config: bp.config,
      metadata: { waveId: bp.config.waveId },
    })));

    return { cycle, replayed: false };
  });

  if (!result.replayed) {
    logger.info(`[PlanCommit] Saved plan as cycle ${result.cycle.id} (pending approval, ${plan.waves.length} waves)`, {
      orgId,
      projectId,
    });
    // Everything below is notification. The rows are committed; a cache or event
    // failure must not turn a saved plan into a reported failure (and a retry).
    emitCycleEvent("cycle.created", result.cycle.id, orgId, {
      status: result.cycle.status,
      name: result.cycle.name,
      source: "project_studio",
    });
    invalidateCachePattern(`cache:cycles:org:${orgId}:*`).catch(() => {});
    cacheService.invalidate(`cycle:metadata:${result.cycle.id}`).catch(() => {});
  }

  return toResponse(result.cycle, result.replayed);
}
