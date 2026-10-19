/**
 * Xray Event Listeners
 *
 * Subscribes to platform events and triggers incremental indexing so the
 * composition graph stays fresh without a full nightly sweep.
 */

import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "@domain/core/infrastructure/pod-events.contract.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("XrayEventListener");

let listenersInitialized = false;

export async function initializeXrayEventListeners(): Promise<void> {
  if (listenersInitialized) return;
  listenersInitialized = true;
  logger.info("[XrayListener] Registering composition indexing listeners");

  // After a knowledge topic is created, proactively warm its node in the graph
  eventStream.on(POD_EVENTS.KNOWLEDGE.TOPIC_CREATED, async (event) => {
    const { topicId, organizationId } = event.payload ?? {};
    if (!topicId || !organizationId) return;
    // Node is created lazily on first edge write — no action needed.
  });

  // After a dataset is ingested or updated, re-index dataset relationships
  eventStream.on(POD_EVENTS.KNOWLEDGE.DOCUMENT_INGESTED, async (event) => {
    const { organizationId } = event.payload ?? {};
    if (!organizationId || typeof organizationId !== "number") return;
    try {
      const { indexDatasetEdges } = await import("../core/xray-indexing.service.js");
      await indexDatasetEdges(organizationId);
    } catch (err: any) {
      logger.warn("[XrayListener] Dataset edge indexing failed", { err: err.message });
    }
  });

  // After an app is deployed/updated, refresh its composition cache and trigger immediate container reconciliation
  eventStream.on(POD_EVENTS.APP.DEPLOYED, async (event) => {
    const { appSlug, organizationId } = event.payload ?? {};
    if (!appSlug || !organizationId) return;
    try {
      const { warmCompositionCache, indexAppMissionEdge } = await import("../core/xray-indexing.service.js");
      const { containerReconciliationService } = await import("@domain/infrastructure/container-reconciliation.service.js");
      const { db } = await import("@server/database_service.js");
      const { apps } = await import("@shared/schema/index.js");
      const { eq } = await import("drizzle-orm");
      const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, appSlug)).limit(1);
      if (app) await indexAppMissionEdge(app.id);
      await Promise.all([
        warmCompositionCache(appSlug, organizationId),
        containerReconciliationService.triggerImmediateReconciliation()
      ]);
    } catch (err: any) {
      logger.warn("[XrayListener] App deployment cache warm / reconciliation failed", { appSlug, err: err.message });
    }
  });

  // Cycle created/launched: index Cycle→Mission and Mission→Cycle edges
  eventStream.on(POD_EVENTS.CYCLE.CREATED, async (event) => {
    const { organizationId } = event.payload ?? {};
    if (!organizationId) return;
    try {
      const { indexCycleMissionEdges, indexMissionCycleEdges } = await import("../core/xray-indexing.service.js");
      await Promise.all([indexCycleMissionEdges(organizationId), indexMissionCycleEdges(organizationId)]);
    } catch (err: any) {
      logger.warn("[XrayListener] Cycle indexing failed", { err: err.message });
    }
  });

  // Mission run started: only index cycle edges if the run is cycle-linked
  eventStream.on(POD_EVENTS.MISSION.RUN_STARTED, async (event) => {
    const { organizationId, cycleId } = event.payload ?? {};
    if (!organizationId || !cycleId) return; // skip non-cycle runs
    try {
      const { indexCycleMissionEdges, indexMissionCycleEdges } = await import("../core/xray-indexing.service.js");
      await Promise.all([indexCycleMissionEdges(organizationId), indexMissionCycleEdges(organizationId)]);
    } catch (err: any) {
      logger.warn("[XrayListener] MissionRun cycle indexing failed", { err: err.message });
    }
  });

  // Mission run completed: Index graph relationships, run Peer Review Critique, update Memory Evolution & Distill Gaps
  eventStream.on(POD_EVENTS.MISSION.RUN_COMPLETED, async (event) => {
    const { organizationId, missionId, shadowRunId } = event.payload ?? {};
    if (!organizationId || typeof organizationId !== "number") return;
    try {
      const { indexMissionPipelineEdges, indexMissionCycleEdges } = await import("../core/xray-indexing.service.js");
      await Promise.all([indexMissionPipelineEdges(organizationId), indexMissionCycleEdges(organizationId)]);

      // 1. Automatic Multi-Model Critique Panel (Baseline, Challenger, Skeptic)
      let critiqueScore: number | null = null;
      let critiqueReasoning: string = "";

      if (shadowRunId) {
        const { critiqueService } = await import("@domain/mission/core/critique.service.js");
        const critique = await critiqueService.peerReview(shadowRunId);
        if (critique) {
          critiqueScore = critique.score;
          critiqueReasoning = critique.consensusReasoning;
          logger.info(`[XrayListener] Peer review completed for shadow run ${shadowRunId}: consensus score ${critique.score}/100`);

          // Closed-loop calibration: Trigger steering vector feedback calibration
          if (missionId) {
            import("@domain/ai/core/steering-vector.service.js").then(({ steeringVectorService }) => {
              steeringVectorService.recordCritiqueFeedback(missionId, critique.score, critique.consensusReasoning).catch(() => {});
            }).catch(() => {});
          }
        }
      }

      // 2. Automatic Memory Evolution & Utility Score Refresh
      const { memoryEvolutionService } = await import("@domain/knowledge/core/evolution/memory-evolution.service.js");
      await memoryEvolutionService.refreshUtilityScores(organizationId);

      // 3. Question Engine Distillation: If critique score < 60, create structured question to distill gap into knowledge entry
      if (critiqueScore !== null && critiqueScore < 60) {
        logger.info(`[XrayListener] Low critique score (${critiqueScore}) on mission ${missionId}. Triggering Question Engine distillation.`);
        const { knowledgeBaseQuestionEngineService } = await import("@domain/agents/core/knowledge-base-question-engine.service.js");
        await knowledgeBaseQuestionEngineService.createQuestion(
          organizationId,
          `mission:${missionId}`,
          "low_confidence_compaction",
          {
            missionId,
            shadowRunId,
            critiqueScore,
            critiqueReasoning,
            summary: `Low critique consensus score (${critiqueScore}/100). Reasoning: ${critiqueReasoning.slice(0, 300)}`
          }
        );
      }
    } catch (err: any) {
      logger.warn("[XrayListener] Mission→Pipeline/Cycle indexing or critique/evolution failed", { missionId, err: err.message });
    }
  });

  // --- REAL-TIME X-RAY EVENT BUS LISTENERS ---
  
  const { xrayEventBus, XrayEventType } = await import("../core/xray-event-bus.js");
  const pendingReindexTimers = new Map<number, NodeJS.Timeout>();

  xrayEventBus.on(XrayEventType.RELATIONSHIP_UPDATED, async (event) => {
    const { orgId } = event;
    if (!orgId) return;

    // Debounce reindexing per org to prevent job queue flooding during rapid updates
    if (pendingReindexTimers.has(orgId)) {
      clearTimeout(pendingReindexTimers.get(orgId)!);
    }

    const timer = setTimeout(async () => {
      pendingReindexTimers.delete(orgId);
      logger.info(`[XrayListener] Debounced RELATIONSHIP_UPDATED executing for org ${orgId}. Queuing reindex.`);
      try {
        const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");
        await queueService.xrayQueue.add(
          `incremental-reindex-${orgId}`,
          {
            type: "FULL_REINDEX",
            organizationId: orgId
          },
          { jobId: `incremental-reindex-${orgId}`, delay: 1000 }
        );
      } catch (err: any) {
        logger.error(`[XrayListener] Real-time queueing failed for org ${orgId}: ${err.message}`);
      }
    }, 1500);

    pendingReindexTimers.set(orgId, timer);
  });

  // --- CLOSED-LOOP ACTION DISPATCHER FOR HIGH/CRITICAL EVENTS ---
  eventStream.on("*", async (event) => {
    try {
      const { organizationId } = event.context ?? {};
      const { status, missionId, appSlug } = event.payload ?? {};

      if (status === "failed" || status === "error" || event.eventType.endsWith(".failed")) {
        const scope = appSlug || "oddjob";
        const subjectNodeId = missionId ? `xray:mission:${missionId}` : undefined;

        const { xrayCompositionService } = await import("../core/xray-composition.service.js");
        const { xrayOperationalGuideService } = await import("../core/xray-operational-guide.service.js");
        const { xrayContextPackageService } = await import("../core/xray-context-package.service.js");

        const graph = await xrayCompositionService.buildGraph(scope, organizationId ?? 0, { isSuperAdmin: true });
        const guide = xrayOperationalGuideService.buildGuide(graph);

        const evaluation = xrayContextPackageService.evaluateEvent(graph, guide, {
          eventType: "event.anomaly",
          subjectNodeId,
          evidence: event.payload
        });

        if (evaluation.disposition.action === "escalate" && organizationId) {
          logger.info(`[ClosedLoopDispatcher] Escalating critical event ${event.eventType} for scope ${scope}`);
          const { TaskMarketplaceService } = await import("@domain/swarm/services/task-marketplace.service.js");
          await TaskMarketplaceService.createTask({
            missionId: missionId || 1,
            requestingAgentId: null,
            description: `Automated Closed-Loop Repair Task: ${event.eventType} on ${subjectNodeId || scope}. Evidence: ${JSON.stringify(event.payload).slice(0, 200)}`,
            metadata: {
              source: "closed_loop_dispatcher",
              eventId: event.eventId,
              evaluationDisposition: evaluation.disposition
            }
          });
        }
      }
    } catch {
      // Silently swallow closed-loop evaluation errors
    }
  });
}

/**
 * Helper to parse transparent reasoning tags (<THINKING>, <PLAN>, <SCRATCHPAD>, <REFLECTION>)
 * emitted by open-weight models (Hermes 3, DeepSeek-R1, Qwen) and extract structured reasoning steps.
 */
export function parseReasoningTokens(content: string): Array<{ type: string; content: string }> {
  if (!content) return [];
  const reasoningSteps: Array<{ type: string; content: string }> = [];

  const tagPatterns = [
    { type: 'thinking', regex: /<THINKING>([\s\S]*?)<\/THINKING>/gi },
    { type: 'plan', regex: /<PLAN>([\s\S]*?)<\/PLAN>/gi },
    { type: 'scratchpad', regex: /<SCRATCHPAD>([\s\S]*?)<\/SCRATCHPAD>/gi },
    { type: 'reflection', regex: /<REFLECTION>([\s\S]*?)<\/REFLECTION>/gi }
  ];

  for (const { type, regex } of tagPatterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && match[1].trim()) {
        reasoningSteps.push({
          type,
          content: match[1].trim()
        });
      }
    }
  }

  return reasoningSteps;
}

