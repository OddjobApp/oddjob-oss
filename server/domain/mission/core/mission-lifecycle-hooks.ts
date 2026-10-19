import { db } from "@server/database_service.js";
import { missionRuns, missionMembers, jobs, operationalCycles, missions } from "@shared/schema/index.js";
import { eq, and, ne, isNull, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionLifecycleHooks");

export class MissionLifecycleHooks {
  /**
   * Primary entry point for terminal state side-effects.
   * Handles TrustGraph, Soul Evolution, Skill Evolution, and Hierarchical Sync.
   */
  static async onMissionTerminalState(
    missionRunId: number, 
    status: "completed" | "failed", 
    failureReason?: string
  ): Promise<void> {
    logger.info(`[Lifecycle] Run ${missionRunId} entered terminal state "${status}".`);

    // Fetch the mission run details first
    const [mission] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
    if (!mission) {
      logger.error(`[Lifecycle] Mission run ${missionRunId} not found.`);
      return;
    }

    // 1. TrustGraph Snapshot (Asynchronous)
    this.runTrustGraphSnapshot(missionRunId);

    // 2. Soul Evolution (Asynchronous)
    this.runSoulEvolution(mission, status, failureReason);

    if (status === 'failed') {
      this.runSkillEvolution(mission, missionRunId);
      // Trigger Crisis Orchestration to spawn recovery mission
      this.runCrisisOrchestration(missionRunId, mission);
      // Trigger predictive failure question audit
      this.runPredictiveFailureAudit(mission, missionRunId);
    }

    // 4. Hierarchical Blackboard Sync (Active Sub-mission -> Parent)
    if (mission.parentId) {
      this.runHierarchicalSync(missionIdToNumber(mission.missionId), missionRunId, mission, status, failureReason);
    }

    // 5. Compaction (Dreaming Cycle) - Distill mission history into permanent knowledge
    this.runCompaction(missionRunId, mission, status);

    // 5b. Copilot research completion — for missions the assistant launched to answer
    // a question it couldn't: store the answer in the KB and post an Assistant Update.
    this.runCopilotResearchCompletion(mission, status);


    // 6. App-mission bidirectional sync — webhook + nextPipeline chaining + app dataset sync
    if (mission.missionId) {
      this.runAppMissionSync(missionIdToNumber(mission.missionId), missionRunId, status, mission);
      if (status === 'completed') {
        (async () => {
          try {
            const { missionAppSyncService } = await import("@domain/apps/core/mission-app-sync.service.js");
            await missionAppSyncService.syncMissionToApps(missionIdToNumber(mission.missionId), 'on-complete');
          } catch (err: any) {
            logger.error(`[Lifecycle] Mission App Sync failed: ${err.message}`);
          }
        })().catch(err => logger.error(`[Lifecycle] Deferred Mission App Sync error: ${err.message}`));
      }
    }

    // 7. Release isolated workspace mutex + semaphore slot if this mission used one.
    // Runs for both completed and failed so locks never leak.
    if (mission.missionId) {
      this.runWorkspaceCompletion(missionIdToNumber(mission.missionId), mission.organizationId ?? null);
    }

    // 8. Pipeline phase advancement — if this mission ran within a pipeline-mode cycle,
    // notify the PipelineOrchestratorService so it can validate artifacts and advance.
    if (mission.cycleId) {
      this.runPipelinePhaseAdvancement(missionRunId, mission, status);
    }

    // 9. Copilot announcement — when a MAJOR (critical-path) step of a cycle
    // finishes, surface it in the assistant's Assistant Updates feed.
    if (mission.cycleId && status === 'completed') {
      this.runCycleStepAnnouncement(mission);
    }

    // 10. Mission completion — the mission's own status, and the notification it drives.
    if (status === 'completed') {
      this.completeMissionIfDone(mission).catch(err =>
        logger.error(`[Lifecycle] Mission completion failed for run ${missionRunId}: ${err.message}`),
      );
    }
  }

  /**
   * Mark the parent mission "completed" after a successful run, and notify.
   *
   * Nothing wrote `missions.status = 'completed'` before — every mission with a
   * finished run still read "active", and completion notifications keyed off the
   * RUN instead (the Slack bridge even labelled the run id "Mission #N").
   *
   * Only a non-scheduled mission completes: a scheduled one recurs, so it stays
   * active. A shadow run, an explicitly unsuccessful run, or a mission with another
   * run still open does not complete it. The check and the flip are one
   * conditional UPDATE, so exactly one caller flips a mission and notifications
   * fire once even if terminal hooks run twice.
   *
   * @returns true when this call flipped the mission.
   */
  private static async completeMissionIfDone(run: any): Promise<boolean> {
    if (!run?.missionId || run.isShadow || run.isSuccess === false) return false;

    const [flipped] = await db
      .update(missions)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(
        eq(missions.id, run.missionId),
        eq(missions.isScheduled, false),
        ne(missions.status, "completed"),
        isNull(missions.deletedAt),
        sql`NOT EXISTS (
          SELECT 1 FROM ${missionRuns} r
          WHERE r.mission_id = ${run.missionId}
            AND r.id <> ${run.id}
            AND r.deleted_at IS NULL
            AND r.is_shadow = false
            AND r.status IN ('active', 'paused', 'waiting_on_human', 'waiting_on_file')
        )`,
      ))
      .returning({ id: missions.id, name: missions.name, organizationId: missions.organizationId, createdBy: missions.createdBy });

    if (!flipped) return false;
    logger.info(`[Lifecycle] Mission ${flipped.id} completed (run ${run.id}).`);

    const { missionEventBus, MissionEvent } = await import("./mission-event-bus.js");
    missionEventBus.emit(MissionEvent.MISSION_STATUS_COMPLETED, {
      missionRunId: run.id,
      missionId: flipped.id,
      missionName: flipped.name,
      organizationId: flipped.organizationId ?? null,
    });

    // Tell the person who started it, on whatever device they are on. The
    // conditional UPDATE above means this runs once per completion.
    if (flipped.createdBy) {
      const { pushService } = await import("@domain/core/notifications/push.service.js");
      pushService.sendOnce("mission_complete", `${flipped.id}:${run.id}`, String(flipped.createdBy), {
        title: "Mission complete",
        body: `"${flipped.name || `Mission ${flipped.id}`}" is complete. Its deliverable is ready for review.`,
        url: `/missions/${flipped.id}`,
        tag: `mission-${flipped.id}`,
      }).catch(err => logger.warn(`Mission-complete push failed for mission ${flipped.id}: ${err.message}`));
    }

    // Assistant Updates. Two kinds of run already post their own completion there,
    // so they are skipped rather than announced twice: a cycle step (see
    // runCycleStepAnnouncement) and a copilot research mission, whose update
    // carries the answer itself.
    const ctx = (run.missionContext as any) || {};
    if (run.cycleId || ctx.source === "copilot_research") return true;

    const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
    const name = flipped.name || `Mission ${flipped.id}`;
    await eventStream.publish("intervention.triggered", {
      interventionId: `mission-complete-${flipped.id}-${run.id}`,
      title: `Mission complete: ${name.slice(0, 70)}`,
      description: `"${name}" is complete. Its deliverable is ready for review.`,
      actionLabel: "Review deliverable",
      aiPrompt: `The mission "${name}" (mission ${flipped.id}) just completed. Summarize its deliverable for the user and offer to open the mission.`,
      vector: "C",
      priority: "medium",
      confidence: 0.9,
      context: {
        orgId: flipped.organizationId ?? null,
        missionId: flipped.id,
        missionRunId: run.id,
        missionName: name,
        userId: flipped.createdBy,
      },
    }, {
      organizationId: flipped.organizationId ?? undefined,
      userId: flipped.createdBy,
      source: "mission-complete",
    }, "mission-complete");

    return true;
  }

  private static runWorkspaceCompletion(missionId: number, orgId: number | null) {
    if (!orgId) return;
    (async () => {
      try {
        const { workspaceProvisioningService } = await import("./workspace-provisioning.service.js");
        await workspaceProvisioningService.completeMission(missionId, orgId, null);
      } catch (err: any) {
        logger.warn(`[Lifecycle] Workspace completion for mission ${missionId} failed (non-fatal): ${err.message}`);
      }
    })();
  }

  private static runCompaction(missionRunId: number, mission: any, status: "completed" | "failed") {
    (async () => {
        try {
            const { compactionService } = await import("@domain/agents/core/compaction.service.js");
            const { agentMemoryAcrossMissionsService } = await import("@domain/agents/core/agent-memory-across-missions.service.js");
            const { missionMembers } = await import("@shared/schema/missions/index.js");
            
            // Identify the primary agent (job) involved
            const members = await db.select()
                .from(missionMembers)
                .where(and(
                    eq(missionMembers.missionId, mission.missionId!),
                    eq(missionMembers.entityType, 'job')
                ));

            for (const member of members) {
                if (status === 'completed') {
                    await compactionService.compactSession(missionRunId, member.entityId, mission.organizationId);
                }
                await agentMemoryAcrossMissionsService.compactSession(missionRunId, member.entityId, mission.organizationId);
            }
        } catch (err: any) {
            logger.error(`[Lifecycle] Compaction failed for run ${missionRunId}: ${err.message}`);
        }
    })().catch(err => logger.error(`[Lifecycle] Deferred Compaction error: ${err.message}`));
  }

  /**
   * Copilot Research Completion
   *
   * When the assistant proposed a research mission (because it couldn't answer a
   * question), the run is tagged `source: "copilot_research"` in its missionContext.
   * On completion we (1) store the synthesized answer in the knowledge base and
   * (2) publish an `intervention.triggered` event that surfaces in Assistant Updates —
   * the same delivery path used by autoresearch-maintenance.
   */
  private static runCopilotResearchCompletion(mission: any, status: "completed" | "failed") {
    const ctx = (mission.missionContext as any) || {};
    if (ctx.source !== "copilot_research") return;
    // Idempotency: a research mission can reach us twice (the dynamic orchestrator's
    // "waiting_on_human" conclusion, then a later "completed"). Deliver the answer only once.
    if (ctx.copilotResearchDelivered) return;

    (async () => {
      try {
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        const orgId = mission.organizationId ?? null;
        const question: string = ctx.question || mission.name || "your question";
        const requestedByUserId: string | undefined = ctx.requestedByUserId;

        if (status === "completed") {
          // The orchestrators write the final synthesis to missionContext.result.
          const answer: string = typeof ctx.result === "string"
            ? ctx.result
            : (ctx.result ? JSON.stringify(ctx.result, null, 2) : "");

          let documentId: number | undefined;
          if (answer && orgId) {
            try {
              const { documentService } = await import("@domain/knowledge/core/extraction/document-service.js");
              const orgContext = {
                organizationId: orgId,
                userId: requestedByUserId || mission.createdBy || "system",
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false,
              };
              const doc = await documentService.createDocument({
                title: `Research: ${question}`,
                textContent: answer,
                sourceType: "copilot_research",
                metadata: {
                  type: "research_answer",
                  question,
                  missionRunId: mission.id,
                  missionId: mission.missionId,
                  generatedBy: "copilot_research_mission",
                },
                topicNames: ctx.topic ? [ctx.topic] : ["Agency Intelligence"],
              } as any, orgContext as any);
              documentId = (doc as any)?.id;
              logger.info(`[Lifecycle] Copilot research answer stored as knowledge document ${documentId} (run ${mission.id})`);
            } catch (err: any) {
              logger.error(`[Lifecycle] Failed to store copilot research answer in KB: ${err.message}`);
            }
          }

          // If this research was initiated from a CREW room, present findings in that room
          if (ctx.sessionKey && orgId) {
            try {
              const { crewOrchestratorService } = await import("@domain/crew/core/crew-orchestrator.service.js");
              await crewOrchestratorService.injectTaskCompletionTurn({
                orgId,
                sessionKey: ctx.sessionKey,
                agentCardId: ctx.originAgentCardId ?? null,
                speakerName: ctx.originAgentName || "Researcher",
                content: `### 🔬 Research Findings: ${question}\n\n${answer || "Research completed successfully."}\n\n${documentId ? `*Findings stored in Knowledge Base as Document #${documentId}.*` : ""}`,
                topic: ctx.topic || "Research Findings",
                intent: "research_mission",
                taskKind: "research_mission",
                requestedByUserId,
              });
            } catch (crewTurnErr: any) {
              logger.warn(`Failed to inject research completion turn into crew room: ${crewTurnErr.message}`);
            }
          }

          await eventStream.publish("intervention.triggered", {
            interventionId: `copilot-research-${mission.id}-${Date.now()}`,
            title: `Research complete: ${String(question).slice(0, 80)}`,
            description: documentId
              ? "Your research mission finished and the answer was saved to the knowledge base. Open it to review the findings."
              : "Your research mission finished. Review the findings in the assistant.",
            actionLabel: "View answer",
            aiPrompt: `Summarize the research mission answer for the question: "${question}".${documentId ? ` The findings are saved as knowledge document ${documentId}.` : ""}`,
            vector: "C",
            priority: "medium",
            confidence: 0.9,
            context: { orgId, missionRunId: mission.id, missionId: mission.missionId, question, documentId, userId: requestedByUserId },
          }, {
            organizationId: orgId ?? undefined,
            userId: requestedByUserId,
            source: "copilot-research",
          }, "copilot-research");
        } else {
          await eventStream.publish("intervention.triggered", {
            interventionId: `copilot-research-failed-${mission.id}-${Date.now()}`,
            title: `Research didn't complete: ${String(question).slice(0, 80)}`,
            description: "The research mission for your question couldn't finish. You can ask me to try again.",
            actionLabel: "Retry research",
            aiPrompt: `The research mission for "${question}" failed. Offer to run it again or suggest how to refine the question.`,
            vector: "R",
            priority: "medium",
            confidence: 0.8,
            context: { orgId, missionRunId: mission.id, missionId: mission.missionId, question, userId: requestedByUserId },
          }, {
            organizationId: orgId ?? undefined,
            userId: requestedByUserId,
            source: "copilot-research",
          }, "copilot-research");
        }
      } catch (err: any) {
        logger.error(`[Lifecycle] Copilot research completion failed for run ${mission.id}: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred copilot research completion error: ${err.message}`));
  }

  private static runTrustGraphSnapshot(missionRunId: number) {
    (async () => {
      try {
        const { TrustGraphExportService } = await import("@domain/integrations/trustgraph/export.service.js");
        const result = await TrustGraphExportService.snapMission(missionRunId);
        
        if (result.success) {
          await db.update(missionRuns)
            .set({ 
              contextCoreUrl: result.coreUrl,
              entityCount: result.entityCount,
              relationshipCount: result.relationshipCount
            })
            .where(eq(missionRuns.id, missionRunId));
          
          logger.info(`[Lifecycle] TrustGraph snapshot attached to run ${missionRunId}: ${result.coreUrl}`);
        }
      } catch (err: any) {
        logger.error(`[Lifecycle] TrustGraph snapshot failed for run ${missionRunId}: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred TrustGraph error: ${err.message}`));
  }

  private static runSoulEvolution(mission: any, status: string, failureReason?: string) {
    const missionRunId: number = mission.id;
    (async () => {
      try {
        const { SoulService } = await import("@domain/agents/core/soul.service.js");
        const { agentDeployments } = await import("@shared/schema/agent-deployments.js");
        const { appDeployments } = await import("@shared/schema/apps.js");

        // Evolve Agent Members
        const members = await db.select()
          .from(missionMembers)
          .where(and(
            eq(missionMembers.missionId, mission.missionId!),
            eq(missionMembers.entityType, 'job')
          ));

        for (const member of members) {
          const [agentDep] = await db.select()
            .from(agentDeployments)
            .where(eq(agentDeployments.jobId, member.entityId))
            .limit(1);
          
          if (agentDep) {
            await SoulService.updateAgentSoul(
              agentDep.id, 
              false, 
              status === 'completed', 
              failureReason || (mission.missionContext as any)?.last_error?.message,
              missionRunId
            );
          }
        }

        // Evolve Linked App
        const viaAppSlug = (mission.missionContext as any)?.viaAppSlug || (mission.missionContext as any)?._viaApp;
        if (viaAppSlug) {
          const [appDep] = await db.select()
            .from(appDeployments)
            .where(eq(appDeployments.publicSlug, viaAppSlug))
            .limit(1);
          
          if (appDep) {
            await SoulService.updateAgentSoul(
              appDep.id, 
              true, 
              status === 'completed', 
              failureReason || (mission.missionContext as any)?.last_error?.message
            );
          }
        }
      } catch (err: any) {
        logger.error(`[Lifecycle] Soul evolution failed: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred Soul evolution error: ${err.message}`));
  }

  private static runSkillEvolution(mission: any, missionRunId: number) {
    (async () => {
      try {
        const { skillGeneratorService } = await import("./skill-generator.service.js");
        const [member] = await db.select()
          .from(missionMembers)
          .where(and(
            eq(missionMembers.missionId, mission.missionId!),
            eq(missionMembers.role, 'primary_strategist')
          ))
          .limit(1);

        if (member && member.entityType === 'job') {
          const [job] = await db.select({ skillId: jobs.skillId }).from(jobs).where(eq(jobs.id, member.entityId)).limit(1);
          if (job?.skillId && mission.contextCoreUrl) {
            logger.info(`[Lifecycle] Triggering Skill Evolution for Skill ${job.skillId} (Run ${missionRunId})`);
            const failures = (mission.missionContext as any)?.last_error ? [(mission.missionContext as any).last_error] : [];
            await skillGeneratorService.generateProposal(job.skillId.toString(), failures, mission.contextCoreUrl);
          }
        }
      } catch (err: any) {
        logger.error(`[Lifecycle] Skill evolution failed: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred Skill evolution error: ${err.message}`));
  }

  private static runHierarchicalSync(missionId: number, missionRunId: number, mission: any, status: string, failureReason?: string) {
    (async () => {
      try {
        const [parent] = await db.select().from(missionRuns).where(eq(missionRuns.id, mission.parentId!)).limit(1);
        if (parent) {
          logger.info(`[Lifecycle] Pushing child results from Run ${missionRunId} (Status: ${status}) to Parent Run ${mission.parentId}`);
          
          const childResult = status === 'completed' 
            ? (mission.missionContext as any)?.result || "Child mission completed."
            : `Failed: ${failureReason || "Unknown Error"}`;
            
          const childKey = `sub_mission_${missionRunId}_result`;
          
          const parentContext = { ...(parent.missionContext as any || {}) };
          parentContext[childKey] = childResult;
          parentContext[`sub_mission_${missionRunId}_status`] = status;
          
          if (parentContext.active_sub_missions) {
            parentContext.active_sub_missions = parentContext.active_sub_missions.map((s: any) => 
              s.runId === missionRunId ? { ...s, status, result: childResult } : s
            );
          }

          await db.update(missionRuns)
            .set({ missionContext: parentContext, updatedAt: new Date() })
            .where(eq(missionRuns.id, mission.parentId!));
            
          logger.info(`[Lifecycle] Parent ${mission.parentId} updated with ${status} status from child ${missionRunId}`);
        }
      } catch (err: any) {
        logger.error(`[Lifecycle] Hierarchical sync failed: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred Hierarchical sync error: ${err.message}`));
  }

  private static runAppMissionSync(missionId: number, missionRunId: number, status: string, mission: any) {
    (async () => {
      try {
        const { appDeployments } = await import("@shared/schema/apps.js");
        const { eq: eqFn } = await import("drizzle-orm");

        const [dep] = await db.select({
          id: appDeployments.id,
          webhookUrl: appDeployments.webhookUrl,
          webhookSecret: appDeployments.webhookSecret,
          nextPipelineId: appDeployments.nextPipelineId,
        })
          .from(appDeployments)
          .where(eqFn(appDeployments.oddjobMissionId, missionId))
          .limit(1);

        if (!dep) return;

        const missionResult = (mission.missionContext as any)?.result;

        // Webhook delivery
        if (dep.webhookUrl) {
          if (!isWebhookUrlSafe(dep.webhookUrl)) {
            logger.warn(`[Lifecycle] Blocked unsafe webhook URL for deployment ${dep.id}: ${dep.webhookUrl}`);
          } else {
            const body = JSON.stringify({
              event: "mission_terminal",
              missionId,
              missionRunId,
              status,
              result: missionResult ?? null,
              timestamp: new Date().toISOString(),
            });
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (dep.webhookSecret) {
              const { createHmac } = await import("node:crypto");
              const sig = createHmac("sha256", dep.webhookSecret).update(body).digest("hex");
              headers["X-Oddjob-Signature"] = `sha256=${sig}`;
            }
            await fetch(dep.webhookUrl, { method: "POST", headers, body }).catch(e => {
              logger.warn(`[Lifecycle] App webhook delivery failed: ${e.message}`);
            });
            logger.info(`[Lifecycle] App deployment ${dep.id} notified via webhook (mission ${missionId} ${status})`);
          }
        }

        // nextPipeline chaining — only trigger on success
        if (status === 'completed' && dep.nextPipelineId) {
          const { executionService } = await import("@domain/pipeline/core/execution-service.js");
          const { getSystemOrgContext } = await import("@server/utils/auth-context.js");
          
          await executionService.run(dep.nextPipelineId, {
            triggeredBy: "mission_complete_chain",
            sourceMissionId: missionId,
            sourceMissionRunId: missionRunId,
            missionResult,
          } as any, getSystemOrgContext((mission as any).organizationId));
          logger.info(`[Lifecycle] App chaining triggered pipeline ${dep.nextPipelineId} for deployment ${dep.id}`);
        }
      } catch (err: any) {
        logger.error(`[Lifecycle] App-mission sync failed for mission ${missionId}: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred app-mission sync error: ${err.message}`));
  }

  private static runCrisisOrchestration(missionRunId: number, mission: any) {
    (async () => {
      try {
        const { crisisOrchestrationService } = await import("./crisis-orchestration.service.js");
        await crisisOrchestrationService.handleMissionFailure(
          missionRunId,
          mission.organizationId ?? null,
          mission.createdBy || "system"
        );
      } catch (err: any) {
        logger.error(`[Lifecycle] Crisis orchestration failed for run ${missionRunId}: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred Crisis error: ${err.message}`));
  }

  private static runPredictiveFailureAudit(mission: any, missionRunId: number) {
    (async () => {
      try {
        const { knowledgeBaseQuestionEngineService } = await import("@domain/agents/core/knowledge-base-question-engine.service.js");
        const { agentMemoryAcrossMissionsService } = await import("@domain/agents/core/agent-memory-across-missions.service.js");
        const repositoryId = agentMemoryAcrossMissionsService.resolveRepositoryId(mission);
        
        await knowledgeBaseQuestionEngineService.auditFailedRun(
          mission.organizationId,
          repositoryId,
          missionRunId
        );
      } catch (err: any) {
        logger.error(`[Lifecycle] Predictive failure audit failed: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred Predictive Failure Audit error: ${err.message}`));
  }

  /**
   * Pipeline Phase Advancement
   *
   * Detects if this mission ran within a pipeline-mode cycle and, if so,
   * notifies the PipelineOrchestratorService to validate artifacts and advance
   * (or handle failure) for the generation session.
   */
  private static runPipelinePhaseAdvancement(missionRunId: number, mission: any, status: "completed" | "failed") {
    (async () => {
      try {
        // 1. Fetch the cycle's metadata to check for pipeline_mode
        const [cycle] = await db
          .select({ metadata: operationalCycles.metadata })
          .from(operationalCycles)
          .where(eq(operationalCycles.id, mission.cycleId))
          .limit(1);

        if (!cycle?.metadata) return;

        const cycleMetadata = cycle.metadata as Record<string, unknown>;
        if (cycleMetadata.pipeline_mode !== "code_generation") return;

        // 2. Extract pipeline session ID from the cycle metadata
        const pipelineSessionId = cycleMetadata.pipeline_session_id as string | undefined;
        if (!pipelineSessionId) {
          logger.warn(`[Lifecycle] Cycle ${mission.cycleId} has pipeline_mode but no pipeline_session_id`);
          return;
        }

        // 3. Determine the phase name from the mission run's name
        //    (CycleManagerService uses blueprint.name as the mission name, which equals the phase name)
        const phaseName = mission.name as string;

        // 4. Invoke the pipeline orchestrator based on terminal state
        const { pipelineOrchestratorService } = await import("@domain/sdlc-pipeline/core/pipeline-orchestrator.service.js");

        if (status === "completed") {
          await pipelineOrchestratorService.onPhaseComplete(pipelineSessionId, phaseName, missionRunId);
        } else {
          const failureReason = mission.failureReason || "Mission failed with no specific reason";
          await pipelineOrchestratorService.onPhaseFailed(pipelineSessionId, phaseName, failureReason);
        }

        logger.info(`[Lifecycle] Pipeline phase advancement: session=${pipelineSessionId} phase=${phaseName} status=${status}`);
      } catch (err: any) {
        logger.error(`[Lifecycle] Pipeline phase advancement failed for run ${missionRunId}: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred Pipeline phase advancement error: ${err.message}`));
  }

  /**
   * Cycle Step Announcement
   *
   * When a mission that belongs to an operational cycle completes, announce it in
   * the copilot's Assistant Updates feed IF it's a "major" step — i.e. on the
   * cycle's critical path. CycleManagerService names each blueprint's mission
   * after the blueprint, so `mission.name` is the step (phase) name.
   *
   * "Major" is read from `operationalCycles.executionPlan` (the CPM computed at
   * launch: `criticalPath: string[]` + `nodes[name].onCriticalPath`), which is the
   * authoritative source. If a cycle has no computed plan at all (degenerate DAG
   * or plan generation failed), we fall back to announcing every completed step so
   * the feature never goes silent; once a plan exists this narrows to the true
   * critical path.
   *
   * Delivery mirrors runCopilotResearchCompletion: an `intervention.triggered`
   * event, org-scoped so it surfaces for members of the cycle's organization.
   */
  private static runCycleStepAnnouncement(mission: any) {
    (async () => {
      try {
        const [cycle] = await db
          .select({
            name: operationalCycles.name,
            organizationId: operationalCycles.organizationId,
            createdBy: operationalCycles.createdBy,
            executionPlan: operationalCycles.executionPlan,
          })
          .from(operationalCycles)
          .where(eq(operationalCycles.id, mission.cycleId))
          .limit(1);
        if (!cycle) return;

        const stepName = (mission.name as string) || "a step";
        const orgId = cycle.organizationId ?? mission.organizationId ?? null;

        // Determine whether this is a "major" (critical-path) step.
        const plan = (cycle.executionPlan as any) || null;
        const nodes = plan?.nodes && typeof plan.nodes === "object" ? plan.nodes : null;
        const criticalPath: string[] = Array.isArray(plan?.criticalPath) ? plan.criticalPath : [];
        const hasPlan = (nodes && Object.keys(nodes).length > 0) || criticalPath.length > 0;

        const isMajor = hasPlan
          ? (criticalPath.includes(stepName) || !!nodes?.[stepName]?.onCriticalPath)
          : true; // No plan computed → don't stay silent; announce every step.

        if (!isMajor) {
          logger.debug(`[Lifecycle] Cycle ${mission.cycleId} step "${stepName}" completed but is not on the critical path — not announcing.`);
          return;
        }

        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        await eventStream.publish("intervention.triggered", {
          // Deterministic id so a duplicate terminal-state fire dedupes client-side.
          interventionId: `cycle-step-complete-${mission.cycleId}-${mission.id}`,
          title: `Step complete: ${stepName.slice(0, 70)}`,
          description: `"${cycle.name}" finished a major step: ${stepName}.`,
          actionLabel: "Review cycle",
          aiPrompt: `A major step "${stepName}" just completed in the operational cycle "${cycle.name}" (cycle ${mission.cycleId}). Summarize what this step accomplished and what the cycle is likely to do next. Offer to open the cycle if the user wants details.`,
          vector: "C",
          priority: "medium",
          confidence: 0.9,
          context: {
            orgId,
            cycleId: mission.cycleId,
            cycleName: cycle.name,
            stepName,
            missionRunId: mission.id,
            missionId: mission.missionId,
            userId: cycle.createdBy,
          },
        }, {
          organizationId: orgId ?? undefined,
          userId: cycle.createdBy,
          source: "cycle-step",
        }, "cycle-step");

        logger.info(`[Lifecycle] Announced major step completion "${stepName}" for cycle ${mission.cycleId} to copilot.`);
      } catch (err: any) {
        logger.error(`[Lifecycle] Cycle step announcement failed for run ${mission.id}: ${err.message}`);
      }
    })().catch(err => logger.error(`[Lifecycle] Deferred cycle step announcement error: ${err.message}`));
  }
}

/** Helper to handle nullable missionId */
function missionIdToNumber(mid: number | null | undefined): number {
    return mid ?? 0;
}

function isWebhookUrlSafe(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  const blocked = [
    "169.254.169.254", "169.254.170.2",
    "metadata.google.internal",
    "localhost", "127.0.0.1", "::1",
  ];
  if (
    blocked.includes(parsed.hostname) ||
    parsed.hostname.endsWith(".local") ||
    parsed.hostname.endsWith(".internal")
  ) return false;
  return true;
}
