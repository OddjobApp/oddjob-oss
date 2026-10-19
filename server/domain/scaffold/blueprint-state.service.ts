import { and, eq } from "drizzle-orm";
import { DAGResolver, type StageStatusReport } from "./dag-resolver.js";
import type { AssemblyBlueprint, BlueprintStage } from "@shared/schema/assembly-blueprint.js";
import { blueprintSessions } from "@shared/schema/blueprint-sessions.js";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BlueprintStateService");

export interface BlueprintSession {
  id: string;
  orgId: number;
  blueprint: AssemblyBlueprint;
  verifiedStageIds: Set<string>;
  activeStageId?: string;
  stageConfigs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Raised when a session does not exist *for this organization*. */
export class BlueprintSessionNotFoundError extends Error {
  public readonly status = 404;
  constructor(sessionId: string) {
    super(`Blueprint session not found: '${sessionId}'`);
    this.name = "BlueprintSessionNotFoundError";
  }
}

export interface BlueprintSessionSummary {
  id: string;
  blueprintId: string;
  blueprintName: string;
  category: string;
  progressPercent: number;
  totalStages: number;
  verifiedCount: number;
  activeStage?: BlueprintStage;
  activePodComponent?: string;
  isAssemblyReady: boolean;
  stages: StageStatusReport[];
  mermaidChart: string;
  /** Outputs recorded per completed stage. The client resolves stage input
   *  bindings from this rather than keeping its own results bag. */
  stageConfigs: Record<string, unknown>;
  verifiedStageIds: string[];
}

export class BlueprintStateService {
  private resolver = new DAGResolver();

  /** Rehydrate a stored row into the in-memory session shape. */
  private toSession(row: typeof blueprintSessions.$inferSelect): BlueprintSession {
    return {
      id: row.id,
      orgId: row.orgId,
      blueprint: row.blueprint as AssemblyBlueprint,
      verifiedStageIds: new Set<string>((row.verifiedStageIds as string[]) ?? []),
      activeStageId: row.activeStageId ?? undefined,
      stageConfigs: (row.stageConfigs as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  public async createSession(
    sessionId: string,
    blueprint: AssemblyBlueprint,
    orgId: number,
    createdBy?: string,
  ): Promise<BlueprintSessionSummary> {
    logger.info(`[BlueprintStateService] Initializing session '${sessionId}' for blueprint '${blueprint.id}' (org ${orgId})`);

    // Verify stage order and circular dependencies
    const sortedStages = this.resolver.resolveStageOrder(blueprint.stages);
    const initialBlueprint = { ...blueprint, stages: sortedStages };
    const firstStage = sortedStages[0];

    await db.insert(blueprintSessions).values({
      id: sessionId,
      orgId,
      blueprintId: blueprint.id,
      blueprint: initialBlueprint,
      verifiedStageIds: [],
      activeStageId: firstStage?.id ?? null,
      stageConfigs: {},
      createdBy: createdBy ?? null,
    });

    return this.getSessionSummary(sessionId, orgId);
  }

  /**
   * Load a session. Scoped by org on every read: a session id alone must never be
   * sufficient to reach another tenant's run, and an out-of-org id is reported as
   * not-found rather than forbidden so the endpoint does not confirm it exists.
   */
  public async getSession(sessionId: string, orgId: number): Promise<BlueprintSession | undefined> {
    const [row] = await db
      .select()
      .from(blueprintSessions)
      .where(and(eq(blueprintSessions.id, sessionId), eq(blueprintSessions.orgId, orgId)))
      .limit(1);
    return row ? this.toSession(row) : undefined;
  }

  public async getSessionSummary(sessionId: string, orgId: number): Promise<BlueprintSessionSummary> {
    const session = await this.getSession(sessionId, orgId);
    if (!session) throw new BlueprintSessionNotFoundError(sessionId);
    return this.summarize(session);
  }

  private summarize(session: BlueprintSession): BlueprintSessionSummary {
    const { blueprint, verifiedStageIds, activeStageId } = session;
    const stagesReport = this.resolver.computeStageReadiness(
      blueprint.stages,
      verifiedStageIds,
      activeStageId
    );

    const verifiedCount = verifiedStageIds.size;
    const totalStages = blueprint.stages.length;
    const progressPercent = totalStages === 0 ? 100 : Math.round((verifiedCount / totalStages) * 100);
    const isAssemblyReady = verifiedCount === totalStages;

    const activeStage = blueprint.stages.find(s => s.id === activeStageId);
    const mermaidChart = this.generateMermaidChart(stagesReport);

    return {
      id: session.id,
      blueprintId: blueprint.id,
      blueprintName: blueprint.name,
      category: blueprint.category,
      progressPercent,
      totalStages,
      verifiedCount,
      activeStage,
      activePodComponent: activeStage?.podComponent,
      isAssemblyReady,
      stages: stagesReport,
      mermaidChart,
      stageConfigs: session.stageConfigs,
      verifiedStageIds: Array.from(verifiedStageIds),
    };
  }

  /**
   * Record a stage completion and advance.
   *
   * The prerequisite check is the reason this lives server-side: a client-held
   * state machine can be driven out of order by anyone who can call the endpoint.
   */
  public async submitStageCompletion(
    sessionId: string,
    stageId: string,
    payload: Record<string, unknown>,
    orgId: number,
  ): Promise<BlueprintSessionSummary> {
    const session = await this.getSession(sessionId, orgId);
    if (!session) throw new BlueprintSessionNotFoundError(sessionId);

    const stage = session.blueprint.stages.find(s => s.id === stageId);
    if (!stage) {
      throw Object.assign(
        new Error(`Stage '${stageId}' not found in blueprint '${session.blueprint.id}'`),
        { status: 400 },
      );
    }

    const missing = stage.requires.filter(reqId => !session.verifiedStageIds.has(reqId));
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`Cannot complete stage '${stageId}': Missing prerequisites: ${missing.join(", ")}`),
        { status: 409 },
      );
    }

    logger.info(`[BlueprintStateService] Stage '${stageId}' completed for session '${sessionId}'`);
    session.verifiedStageIds.add(stageId);
    session.stageConfigs[stageId] = payload;

    const updatedReport = this.resolver.computeStageReadiness(
      session.blueprint.stages,
      session.verifiedStageIds
    );
    const nextReady = updatedReport.find(r => r.readiness === "ready");
    session.activeStageId = nextReady?.stage.id;

    await db
      .update(blueprintSessions)
      .set({
        verifiedStageIds: Array.from(session.verifiedStageIds),
        activeStageId: session.activeStageId ?? null,
        stageConfigs: session.stageConfigs,
        updatedAt: new Date(),
      })
      .where(and(eq(blueprintSessions.id, sessionId), eq(blueprintSessions.orgId, orgId)));

    return this.summarize(session);
  }

  public generateMermaidChart(stagesReport: StageStatusReport[]): string {
    const lines: string[] = ["graph TD"];
    lines.push("    classDef verified fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;");
    lines.push("    classDef active fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#fff;");
    lines.push("    classDef ready fill:#3b82f6,stroke:#2563eb,stroke-width:2px,color:#fff;");
    lines.push("    classDef blocked fill:#1e293b,stroke:#475569,stroke-dasharray: 5 5,color:#94a3b8;");
    lines.push("");

    for (const item of stagesReport) {
      const safeId = item.stage.id.replace(/[^a-zA-Z0-9_]/g, "_");
      const statusLabel = item.readiness.toUpperCase();
      lines.push(`    ${safeId}["${item.stage.name} [${statusLabel}]"]:::${item.readiness}`);
    }

    lines.push("");
    for (const item of stagesReport) {
      const safeId = item.stage.id.replace(/[^a-zA-Z0-9_]/g, "_");
      for (const req of item.stage.requires) {
        const safeReq = req.replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`    ${safeReq} --> ${safeId}`);
      }
    }

    return lines.join("\n");
  }
}

export const blueprintStateService = new BlueprintStateService();
