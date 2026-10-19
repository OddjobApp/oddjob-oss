import { db, pool } from "@server/database_service.js";
import { missions, missionMembers, missionBlackboardHistory, missionRagAssets, missionDocumentTemplates, missionFileAttachments, jobCollections, jobCollectionItems, jobs, pipelines, missionTemplates, appDeployments, credentials, knowledgeTopics, datasets, hilForms, documentTemplates, Mission, MissionStatus, ExecutionStrategy } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ConflictError } from "@server/utils/errors.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";

import { swarmCommunicationService } from "../../agents/core/swarm-communication.service.js";
import { workflowHealingService } from "./workflow-healing.service.js";
import { xrayEventBus, XrayEventType } from "@domain/xray/core/xray-event-bus.js";

const logger = createLogger("MissionLifecycleService");

export class MissionLifecycleService {
  /**
   * Create a new mission and initialize its first member (strategist).
   *
   * `data.projectId`/`data.projectKey` are project-space context, not mission
   * columns: when present the mission is attached to that project through
   * `project_resources` (relation "primary") once the row exists. Attaching is
   * best-effort — a caller without the project's editor role still gets the
   * mission, filed where the org default-project fallback would put it.
   */
  async createMission(data: Partial<Mission> & { projectId?: number | string | null; projectKey?: string | null }, userId: string, members?: { entityType: string, entityId: number, role: string }[], isDraft: boolean = false, workflow?: Record<string, any> | null) {
    const { projectId, projectKey, ...missionData } = data;
    try {
      const mission = await db.transaction(async (tx) => {
        const [mission] = await tx.insert(missions).values({
          ...missionData,
          name: missionData.name || "Untitled Mission",
          createdBy: userId,
          updatedAt: new Date(),
          isDraft,
          workflowBlueprint: workflow,
          status: 'active'
        } as any).returning();

      // Create an associated Agora session
      try {
        const { agoraSessions } = await import('@shared/schema/agora.js');
        await tx.insert(agoraSessions).values({ missionId: mission.id });
      } catch (agoraErr) {
        logger.error(`Failed to create Agora session for mission ${mission.id}`, agoraErr);
        // Do not block mission creation if Agora fails
      }

      if (members && members.length > 0) {
        await tx.insert(missionMembers).values(
          members.map(m => ({
            missionId: mission.id,
            entityType: m.entityType,
            entityId: m.entityId,
            role: m.role,
            status: 'active' as MissionStatus,
            joinedAt: new Date()
          }))
        );
      }

        if (members && members.length > 0) {
          xrayEventBus.emitEvent({
            type: XrayEventType.RELATIONSHIP_UPDATED,
            orgId: mission.organizationId,
            entityType: 'mission',
            entityId: mission.id
          });
        }

        return mission;
      });

      const projectRef = projectId ?? projectKey;
      if (projectRef != null && mission.organizationId != null) {
        try {
          const { projectService } = await import("../../projects/core/project.service.js");
          await projectService.attachResource(
            { organizationId: mission.organizationId, userId },
            projectRef,
            "mission",
            mission.id,
            "primary",
          );
        } catch (err) {
          logger.warn(`[MissionLifecycle] Mission ${mission.id} created but not attached to project '${projectRef}': ${err instanceof Error ? err.message : err}`);
        }
      }

      return mission;
    } catch (err) {
      logger.error(`Failed to create mission: ${err}`);
      throw err;
    }
  }

  /**
   * Ensures a mission exists for a specific supervisor mission.
   */
  async ensureSupervisorMission(options: {
    supervisorJobId: number;
    intent: string;
    orgId?: number;
    userId: string;
  }) {
    const orgId = options.orgId ?? null;
    const [existing] = await db.select()
      .from(missions)
      .where(
        and(
          orgId === null
            ? sql`${missions.organizationId} IS NULL`
            : eq(missions.organizationId, orgId),
          eq(missions.objective, options.intent)
        )
      )
      .limit(1);

    if (existing) return existing;

    const [newMission] = await db.insert(missions).values({
      name: `Mission: ${options.intent.slice(0, 50)}...`,
      objective: options.intent,
      organizationId: orgId,
      type: "supervisor_led",
      executionStrategy: "dynamic_autonomous",
      createdBy: options.userId,
      blackboard: {},
    }).returning();

    await this.addMember(newMission.id, 'job', options.supervisorJobId, "primary_strategist");
    await this.syncDeliverablesToBlackboard(newMission.id, options.intent || "", "system");
    await this.broadcastMissionUpdate(newMission.id, "mission_created", { objective: options.intent });

    try {
      const orgContext = getSystemOrgContext(options.orgId ?? null);
      orgContext.userId = options.userId; // Preserve original userId if provided
      const { graphService } = await import("@domain/knowledge/core/graph-service.js");
      const missionNode = await graphService.createNode({
        name: newMission.name,
        label: "Mission",
        description: options.intent,
        properties: { missionId: newMission.id, type: "supervisor_led", objective: options.intent }
      }, orgContext);
      
      const jobNodes = await graphService.searchNodes(orgContext, { query: options.supervisorJobId.toString(), label: "Job" });
      if (jobNodes.nodes.length > 0) {
        await graphService.createEdge({
          sourceNodeId: jobNodes.nodes[0].id,
          targetNodeId: missionNode.id,
          relation: "LEAD_STRATEGIST",
          weight: 10
        }, orgContext);
      }
    } catch (err) {
      logger.error(`Failed to link mission to knowledge graph: ${err}`);
    }

    return newMission;
  }

  /**
   * Broadcasts a mission event to the decentralized agent swarm.
   */
  async broadcastMissionUpdate(missionId: number, eventType: string, data: any) {
    try {
      const swarmId = `mission-${missionId}`;
      await swarmCommunicationService.heartbeat(swarmId, "mission-service");
      const event = {
        type: eventType,
        ...data,
        missionId
      };
      
      await swarmCommunicationService.broadcast(swarmId, "mission-service", event);
      
      // Hook into Lazarus Workflow Healing
      process.nextTick(() => {
        workflowHealingService.handleMissionEvent(missionId, event).catch(e => {
            logger.warn(`Lazarus healing cycle failed for mission ${missionId}: ${e}`);
        });
      });
    } catch (err) {
      logger.warn(`Failed to broadcast swarm update for mission ${missionId}: ${err}`);
    }
  }

  /**
   * Update mission properties, including scheduling logic.
   */
  async updateMission(id: number, updates: Partial<Mission> & { scheduleConfig?: any, frequency?: string }, userId: string = "system", orgId?: number | null) {
    const { scheduleService } = await import("../../schedules/core/schedule.service.js");
    const { missionQueryService } = await import("./mission-query.service.js");

    const { scheduleConfig, frequency, ...validUpdates } = updates;

    if (scheduleConfig || updates.isScheduled === false) {
      const mission = await missionQueryService.getMissionDetail(id);
      if (mission) {
        const orgContext = { organizationId: mission.organizationId, userId };
        if (updates.isScheduled === false) {
          validUpdates.scheduleId = null;
        } else if (scheduleConfig) {
          try {
            const newSchedule = await scheduleService.createSchedule({
              name: scheduleConfig.name || `Mission ${id} Schedule`,
              pattern: scheduleConfig.pattern ?? 0,
              patternString: scheduleConfig.patternString ?? scheduleConfig,
              patternLabel: scheduleConfig.patternLabel ?? null,
              timezone: scheduleConfig.timezone ?? 'UTC',
              isActive: true,
            }, orgContext as any);

            await scheduleService.create({
              name: `Mission ${id} Scheduled Run`,
              missionId: id,
              scheduleId: newSchedule.id,
              triggerType: 'schedule',
              isActive: true,
            } as any, orgContext as any);

            validUpdates.scheduleId = newSchedule.id;
            validUpdates.isScheduled = true;
          } catch (schedErr: any) {
            logger.warn(`[MissionLifecycle] Failed to create schedule for mission ${id}: ${schedErr.message}`);
          }
        }
      }
    }

    try {
      const whereClause = orgId
        ? and(eq(missions.id, id), eq(missions.organizationId, orgId))
        : eq(missions.id, id);
      const [updated] = await db.update(missions)
        .set({ ...validUpdates, updatedAt: new Date() })
        .where(whereClause)
        .returning();

      if (!updated) throw new NotFoundError(`Mission ${id} not found`);
      return updated;
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      logger.error(`Failed to update mission ${id}: ${err}`);
      throw new Error(`Failed to update mission: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Attach a RAG asset to a mission.
   */
  async attachRagAsset(missionId: number, ragAssetId: number, purpose: string = "reference", userId: string) {
    const [existing] = await db.select()
      .from(missionRagAssets)
      .where(and(eq(missionRagAssets.missionId, missionId), eq(missionRagAssets.ragAssetId, ragAssetId)))
      .limit(1);

    if (existing) throw new Error("Asset already attached");

    return await db.insert(missionRagAssets).values({
      missionId,
      ragAssetId,
      purpose,
      addedBy: userId
    }).returning();
  }

  /**
   * Detach a RAG asset from a mission.
   */
  async detachRagAsset(missionId: number, attachmentId: number) {
    const [deleted] = await db.delete(missionRagAssets)
      .where(and(eq(missionRagAssets.id, attachmentId), eq(missionRagAssets.missionId, missionId)))
      .returning();
    if (!deleted) throw new NotFoundError("Attachment not found");
    return true;
  }

  /**
   * Attach a document template to a mission.
   */
  async attachDocumentTemplate(missionId: number, documentTemplateId: number, role: string = "output_standard", userId: string) {
    const [existing] = await db.select()
      .from(missionDocumentTemplates)
      .where(and(eq(missionDocumentTemplates.missionId, missionId), eq(missionDocumentTemplates.documentTemplateId, documentTemplateId)))
      .limit(1);

    if (existing) throw new Error("Template already attached");

    return await db.insert(missionDocumentTemplates).values({
      missionId,
      documentTemplateId,
      role,
      addedBy: userId
    }).returning();
  }

  /**
   * Detach a document template from a mission.
   */
  async detachDocumentTemplate(missionId: number, attachmentId: number) {
    const [deleted] = await db.delete(missionDocumentTemplates)
      .where(and(eq(missionDocumentTemplates.id, attachmentId), eq(missionDocumentTemplates.missionId, missionId)))
      .returning();
    if (!deleted) throw new NotFoundError("Attachment not found");
    return true;
  }

  /**
   * Attach a file to a mission.
   */
  async attachFile(missionId: number, data: any, userId: string) {
    const [attachment] = await db.insert(missionFileAttachments).values({
      missionId,
      fileName: data.fileName,
      contentType: data.contentType,
      fileSize: data.fileSize,
      fileData: data.fileData,
      textContent: data.textContent,
      purpose: data.purpose || "reference",
      addedBy: userId
    }).returning();
    return attachment;
  }

  /**
   * Detach a file from a mission.
   */
  async detachFile(missionId: number, attachmentId: number) {
    const [deleted] = await db.delete(missionFileAttachments)
      .where(and(eq(missionFileAttachments.id, attachmentId), eq(missionFileAttachments.missionId, missionId)))
      .returning();
    if (!deleted) throw new NotFoundError("Attachment not found");
    return true;
  }

  /**
   * Add a member to a mission.
   */
  async addMember(missionId: number, entityType: 'job' | 'pipeline', entityId: number, role: string) {
    await db.insert(missionMembers).values({
      missionId,
      entityType,
      entityId,
      role,
      status: 'active' as MissionStatus
    }).onConflictDoNothing();

    // Notify X-Ray
    const [mission] = await db.select({ organizationId: missions.organizationId }).from(missions).where(eq(missions.id, missionId)).limit(1);
    if (mission) {
      xrayEventBus.emitEvent({
        type: XrayEventType.RELATIONSHIP_UPDATED,
        orgId: mission.organizationId,
        entityType: 'mission',
        entityId: missionId
      });
    }
  }

  /**
   * Remove a member from a mission.
   */
  async removeMember(missionId: number, entityType: string, entityId: number) {
    const [deleted] = await db.delete(missionMembers)
      .where(and(
        eq(missionMembers.missionId, missionId),
        eq(missionMembers.entityType, entityType),
        eq(missionMembers.entityId, entityId)
      ))
      .returning();
    return !!deleted;
  }

  /**
   * Update a member's status (e.g. pause/resume).
   */
  async updateMemberStatus(memberId: number, status: string) {
    await db.update(missionMembers)
      .set({ status })
      .where(eq(missionMembers.id, memberId));
  }

  /**
   * Sync mission members from a supervisor plan.
   * Upserts a missionMember row for every task that has a pipelineId assigned.
   */
  async syncFromPlan(missionId: number, plan: { tasks?: Array<{ pipelineId?: number | null; type?: string; name?: string }> }) {
    const tasks = plan?.tasks ?? [];
    let synced = 0;

    for (const task of tasks) {
      if (!task.pipelineId) continue;
      const role = task.type === "pipeline" ? "worker_pipeline" : (task.type || "worker");
      await this.addMember(missionId, "pipeline", task.pipelineId, role);
      synced++;
    }

    logger.info(`[syncFromPlan] Synced ${synced} pipeline members for mission ${missionId}`);
    return { synced };
  }

  /**
   * Sync Activity Collection for a mission.
   */
  async syncActivityCollection(missionId: number, tx?: any) {
    const dbClient = tx || db;
    const { missionQueryService } = await import("./mission-query.service.js");
    try {
      const mission = await missionQueryService.getMissionDetail(missionId);
      if (!mission) return;

      const jobIds = (mission.members || [])
        .filter((m: any) => m.entityType === 'job')
        .map((m: any) => m.entityId);

      if (jobIds.length === 0) return;

      let [collection] = await dbClient.select()
        .from(jobCollections)
        .where(eq(jobCollections.missionId, missionId))
        .limit(1);

      if (!collection) {
        [collection] = await dbClient.insert(jobCollections).values({
          name: `Mission: ${mission.name}`,
          description: `Activity collection for mission: ${mission.name}`,
          organizationId: mission.organizationId,
          missionId,
          createdBy: mission.createdBy
        }).returning();
      }

      for (const jobId of jobIds) {
        await dbClient.insert(jobCollectionItems).values({
          collectionId: collection.id,
          jobId
        }).onConflictDoNothing();
      }
    } catch (err) {
      logger.error(`Failed to sync activity collection for mission ${missionId}: ${err}`);
    }
  }

  /**
   * Update the mission blackboard with history tracking and atomic merging.
   */
  async updateBlackboard(missionId: number, patch: any, changedBy: string, reason: string = "manual_update", tx?: any) {
    const dbClient = tx || db;
    
    // Atomic merge using sql delta
    await dbClient.update(missions)
      .set({ 
        blackboard: sql`COALESCE(blackboard, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date() 
      })
      .where(eq(missions.id, missionId));

    // Log history
    await dbClient.insert(missionBlackboardHistory).values({
      missionId,
      blackboard: patch, // Log the delta or fetch full? Usually delta is enough for history if we have snapshots.
      changedBy,
      changeReason: reason
    });

    return patch;
  }

  /**
   * Queues a blackboard update for asynchronous processing.
   */
  async queueBlackboardUpdate(missionId: number, patch: any, changedBy: string, reason: string = "manual_update") {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
    if (!redis) {
      const result = await this.updateBlackboard(missionId, patch, changedBy, reason);
      void import("./blackboard-knowledge-extraction.service.js")
        .then(({ blackboardKnowledgeExtractionService }) => blackboardKnowledgeExtractionService.process({ missionId, patch, changedBy, reason }))
        .catch((error) => logger.warn(`[MissionLifecycle] Blackboard knowledge extraction failed: ${error.message}`));
      return result;
    }

    const payload = JSON.stringify({ missionId, newContent: patch, changedBy, reason });
    await redis.xadd('mission:blackboard:updates', 'MAXLEN', '~', '1000', '*', 'payload', payload);
  }

  /**
   * Delete a mission and its associated resources in dependency order.
   */
  async deleteMission(missionId: number, orgContext?: { organizationId: number | null; userId: string }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Verify org ownership before deleting
      if (orgContext?.organizationId) {
        const check = await client.query(
          "SELECT id FROM missions WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL",
          [missionId, orgContext.organizationId]
        );
        if (check.rowCount === 0) {
          await client.query("ROLLBACK");
          throw new NotFoundError(`Mission ${missionId} not found`);
        }
      }
      await client.query("UPDATE mission_runs SET deleted_at = NOW() WHERE mission_id = $1", [missionId]);
      await client.query("DELETE FROM mission_blackboard_history WHERE mission_id = $1", [missionId]);
      await client.query("DELETE FROM mission_members WHERE mission_id = $1", [missionId]);
      await client.query("UPDATE missions SET deleted_at = NOW() WHERE id = $1", [missionId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Pause a mission and its active runs.
   */
  async pauseMission(missionId: number, orgId?: number | null) {
    const { missionRunService } = await import("./mission-run.service.js");
    const where = orgId
      ? and(eq(missions.id, missionId), eq(missions.organizationId, orgId))
      : eq(missions.id, missionId);
    const [updated] = await db.update(missions).set({ status: 'paused', updatedAt: new Date() }).where(where).returning({ id: missions.id });
    if (!updated) throw new NotFoundError(`Mission ${missionId} not found`);
    const activeRuns = await missionRunService.list({ missionId, status: 'active' });
    await Promise.all(activeRuns.map(run => missionRunService.pause(run.id)));
  }

  /**
   * Resume a mission and its paused runs.
   */
  async resumeMission(missionId: number, orgId?: number | null) {
    const { missionRunService } = await import("./mission-run.service.js");
    const where = orgId
      ? and(eq(missions.id, missionId), eq(missions.organizationId, orgId))
      : eq(missions.id, missionId);
    const [updated] = await db.update(missions).set({ status: 'active', updatedAt: new Date() }).where(where).returning({ id: missions.id });
    if (!updated) throw new NotFoundError(`Mission ${missionId} not found`);
    const pausedRuns = await missionRunService.list({ missionId, status: 'paused' });
    await Promise.all(pausedRuns.map(run => missionRunService.resume(run.id)));
  }

  /**
   * Terminate a mission and all its active runs.
   */
  async terminateMission(missionId: number, orgId?: number | null) {
    const { missionRunService } = await import("./mission-run.service.js");
    const where = orgId
      ? and(eq(missions.id, missionId), eq(missions.organizationId, orgId))
      : eq(missions.id, missionId);
    const [updated] = await db.update(missions).set({ status: 'failed', updatedAt: new Date() }).where(where).returning({ id: missions.id });
    if (!updated) throw new NotFoundError(`Mission ${missionId} not found`);
    const runs = await missionRunService.list({ missionId });
    await Promise.all(
        runs.filter(run => ['active', 'paused'].includes(run.status))
            .map(run => missionRunService.terminate(run.id, "system"))
    );
  }

  /**
   * Sync planned deliverables from the mission objective to the blackboard.
   */
  async syncDeliverablesToBlackboard(missionId: number, objective: string, changedBy: string) {
    if (!objective) return;
    const match = objective.match(/\[Target Product: (.*?)\]/);
    if (match) {
      const deliverables = match[1].split(", ").map((t: string) => t.trim());
      await this.updateBlackboard(missionId, { expected_deliverables: deliverables }, changedBy, "deliverable_sync");
    }
  }

  /**
   * Add a shared memory observation.
   */
  async addSharedMemory(missionId: number, observation: string, source: string, changedBy: string = "agent") {
    const entry = JSON.stringify({ observation, source, timestamp: new Date().toISOString() });

    // Atomic SQL append — no read-modify-write race condition.
    await db.execute(sql`
      UPDATE missions
      SET
        blackboard = jsonb_set(
          COALESCE(blackboard, '{}'::jsonb),
          '{sharedMemories}',
          COALESCE(blackboard->'sharedMemories', '[]'::jsonb)
          || jsonb_build_array(${entry}::jsonb)
        ),
        updated_at = NOW()
      WHERE id = ${missionId}
    `);

    await db.insert(missionBlackboardHistory).values({
      missionId,
      blackboard: { observation, source },
      changedBy,
      changeReason: "agent_memory"
    });
  }

  /**
   * Create a mission template from an existing mission.
   */
  async createTemplate(missionId: number, name: string, description: string, userId: string, orgId: number) {
    const { missionQueryService } = await import("./mission-query.service.js");
    const mission = await missionQueryService.getMissionDetail(missionId);
    if (!mission) throw new NotFoundError("Mission not found");

    const config = {
      objective: mission.objective,
      type: mission.type,
      members: (mission.members || []).map((m: any) => ({ entityType: m.entityType, entityId: m.entityId, role: m.role }))
    };

    const [template] = await db.insert(missionTemplates).values({
      name,
      description,
      config,
      organizationId: orgId,
      createdBy: userId
    }).returning();
    return template;
  }

  /**
   * Instantiate a new mission from a template.
   */
  async instantiateTemplate(templateId: number, name: string, userId: string, orgId: number, viaAppSlug?: string, scheduleConfig?: any) {
    const [template] = await db.select().from(missionTemplates).where(eq(missionTemplates.id, templateId)).limit(1);
    if (!template) throw new NotFoundError("Template not found");

    const config = (template.config || {}) as Record<string, any>;
    const initialBlackboard: any = {};
    if (viaAppSlug) {
      initialBlackboard.viaAppSlug = viaAppSlug;
      const [deployment] = await db.select().from(appDeployments).where(and(eq(appDeployments.publicSlug, viaAppSlug), eq(appDeployments.organizationId, orgId))).limit(1);
      if (deployment) {
        initialBlackboard.appDeploymentId = deployment.id;
      }
    }

    try {
      const [mission] = await db.insert(missions).values({
        name,
        objective: template.description || '',
        executionStrategy: (config.executionStrategy as ExecutionStrategy) || 'pre_planned',
        reasoningProtocol: config.reasoningProtocol || 'json_manifest',
        organizationId: orgId,
        createdBy: userId,
        blackboard: initialBlackboard,
        status: 'active' as MissionStatus,
        type: 'mission_based',
        updatedAt: new Date(),
        sourceTemplateId: templateId,
      }).returning();

      logger.info("Mission instantiated from template", { missionId: mission.id, templateId });
      return mission;
    } catch (err) {
      logger.error(`Failed to instantiate template ${templateId}: ${err}`);
      throw new Error(`Failed to instantiate mission from template: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const missionLifecycleService = new MissionLifecycleService();
