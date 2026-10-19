import { db } from "./database_service.js";
import {
  jobs,
  pipelines,
  credentials,
  schedules,
  scheduledJobs,
  knowledgeTopics,
  knowledgeDocuments,
  pipelineExecutions,
  alerts,
  userOrgs,
  users,
} from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

export type EntityType =
  | "job"
  | "pipeline"
  | "credential"
  | "schedule"
  | "scheduledJob"
  | "knowledgeTopic"
  | "knowledgeDocument"
  | "pipelineExecution"
  | "alert";

interface MigrationConflict {
  entityType: EntityType;
  entityId: number;
  conflictReason: string;
}

export async function validateMigration(
  sourceOrgId: number,
  targetOrgId: number,
  entityType: EntityType
): Promise<MigrationConflict[]> {
  const conflicts: MigrationConflict[] = [];

  // Check for name collisions based on entity type
  if (entityType === "knowledgeTopic") {
    const sourceTopics = await db
      .select()
      .from(knowledgeTopics)
      .where(eq(knowledgeTopics.organizationId, sourceOrgId));

    const targetTopics = await db
      .select()
      .from(knowledgeTopics)
      .where(eq(knowledgeTopics.organizationId, targetOrgId));

    const targetNames = new Set(targetTopics.map((t) => t.name.toLowerCase()));
    sourceTopics.forEach((topic) => {
      if (targetNames.has(topic.name.toLowerCase())) {
        conflicts.push({
          entityType: "knowledgeTopic",
          entityId: topic.id,
          conflictReason: `Topic name "${topic.name}" already exists in target organization`,
        });
      }
    });
  } else if (entityType === "schedule") {
    const sourceSchedules = await db
      .select()
      .from(schedules)
      .where(eq(schedules.organizationId, sourceOrgId));

    const targetSchedules = await db
      .select()
      .from(schedules)
      .where(eq(schedules.organizationId, targetOrgId));

    const targetNames = new Set(targetSchedules.map((s) => s.name.toLowerCase()));
    sourceSchedules.forEach((schedule) => {
      if (targetNames.has(schedule.name.toLowerCase())) {
        conflicts.push({
          entityType: "schedule",
          entityId: schedule.id,
          conflictReason: `Schedule name "${schedule.name}" already exists in target organization`,
        });
      }
    });
  } else if (entityType === "scheduledJob") {
    const sourceScheduledJobs = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.organizationId, sourceOrgId));

    const targetScheduledJobs = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.organizationId, targetOrgId));

    const targetNames = new Set(targetScheduledJobs.map((sj) => sj.name.toLowerCase()));
    sourceScheduledJobs.forEach((scheduledJob) => {
      if (targetNames.has(scheduledJob.name.toLowerCase())) {
        conflicts.push({
          entityType: "scheduledJob",
          entityId: scheduledJob.id,
          conflictReason: `Scheduled job name "${scheduledJob.name}" already exists in target organization`,
        });
      }
    });
  }

  return conflicts;
}

export async function migrateEntityToOrg(
  entityType: EntityType,
  entityId: number,
  targetOrgId: number
): Promise<void> {
  switch (entityType) {
    case "job":
      await db
        .update(jobs)
        .set({ organizationId: targetOrgId })
        .where(eq(jobs.id, entityId));
      break;
    case "pipeline":
      await db
        .update(pipelines)
        .set({ organizationId: targetOrgId })
        .where(eq(pipelines.id, entityId));
      break;
    case "credential":
      await db
        .update(credentials)
        .set({ organizationId: targetOrgId })
        .where(eq(credentials.id, entityId));
      break;
    case "schedule":
      await db
        .update(schedules)
        .set({ organizationId: targetOrgId })
        .where(eq(schedules.id, entityId));
      break;
    case "scheduledJob":
      await db
        .update(scheduledJobs)
        .set({ organizationId: targetOrgId })
        .where(eq(scheduledJobs.id, entityId));
      break;
    case "knowledgeTopic":
      await db
        .update(knowledgeTopics)
        .set({ organizationId: targetOrgId })
        .where(eq(knowledgeTopics.id, entityId));
      break;
    case "knowledgeDocument":
      await db
        .update(knowledgeDocuments)
        .set({ organizationId: targetOrgId })
        .where(eq(knowledgeDocuments.id, entityId));
      break;
    case "pipelineExecution":
      await db
        .update(pipelineExecutions)
        .set({ organizationId: targetOrgId })
        .where(eq(pipelineExecutions.id, entityId));
      break;
    case "alert":
      await db
        .update(alerts)
        .set({ organizationId: targetOrgId })
        .where(eq(alerts.id, entityId));
      break;
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}

export async function migrateUserToOrg(
  userId: string,
  targetOrgId: number,
  migrateData: boolean
): Promise<void> {
  // Add user to target org
  const [existing] = await db
    .select()
    .from(userOrgs)
    .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, targetOrgId)))
    .limit(1);

  if (!existing) {
    await db.insert(userOrgs).values({ userId, orgId: targetOrgId });
  }

  // Update user's default org
  await db.update(users).set({ defaultOrgId: targetOrgId }).where(eq(users.id, userId));

  if (migrateData) {
    // Migrate all user's data to target org
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user[0]) {
      // Get user's current orgs
      const userOrgsList = await db
        .select()
        .from(userOrgs)
        .where(eq(userOrgs.userId, userId));

      for (const userOrg of userOrgsList) {
        if (userOrg.orgId === targetOrgId) continue;

        // Migrate jobs
        await db
          .update(jobs)
          .set({ organizationId: targetOrgId })
          .where(and(eq(jobs.organizationId, userOrg.orgId), eq(jobs.createdBy, user[0].username)));

        // Migrate pipelines
        await db
          .update(pipelines)
          .set({ organizationId: targetOrgId })
          .where(and(eq(pipelines.organizationId, userOrg.orgId), eq(pipelines.createdBy, user[0].username)));

        // Migrate credentials
        await db
          .update(credentials)
          .set({ organizationId: targetOrgId })
          .where(and(eq(credentials.organizationId, userOrg.orgId), eq(credentials.createdBy, user[0].username)));

        // Migrate knowledge topics
        await db
          .update(knowledgeTopics)
          .set({ organizationId: targetOrgId })
          .where(and(eq(knowledgeTopics.organizationId, userOrg.orgId), eq(knowledgeTopics.createdBy, user[0].username || "")));

        // Migrate knowledge documents
        await db
          .update(knowledgeDocuments)
          .set({ organizationId: targetOrgId })
          .where(and(eq(knowledgeDocuments.organizationId, userOrg.orgId), eq(knowledgeDocuments.createdBy, user[0].username || "")));
      }
    }
  }
}


