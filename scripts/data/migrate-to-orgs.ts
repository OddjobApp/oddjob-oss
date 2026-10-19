import { db } from "../../server/db/index.js";
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
  orgs,
} from "../../shared/schema";
import { eq, sql, isNull } from "drizzle-orm";

async function migrateToOrgs() {
  console.log("🌱 Starting organization migration...");

  try {
    // 1. Get or create default org
    let [defaultOrg] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.id, 1))
      .limit(1);

    if (!defaultOrg) {
      console.log("📦 Creating default organization...");
      [defaultOrg] = await db
        .insert(orgs)
        .values({ name: "Default Organization" })
        .returning();
      console.log(`✅ Created default organization: ${defaultOrg.name} (ID: ${defaultOrg.id})`);
    } else {
      console.log(`✅ Using existing default organization: ${defaultOrg.name} (ID: ${defaultOrg.id})`);
    }

    const defaultOrgId = defaultOrg.id;

    // 2. Update all users to have defaultOrgId
    console.log("👥 Updating users with default organization...");
    const allUsers = await db.select().from(users);
    for (const user of allUsers) {
      if (!user.defaultOrgId) {
        await db.update(users).set({ defaultOrgId: defaultOrgId }).where(eq(users.id, user.id));
      }
    }
    console.log(`✅ Updated ${allUsers.length} users`);

    // 3. Create user_orgs entries for all users
    console.log("🔗 Linking users to default organization...");
    for (const user of allUsers) {
      const [existing] = await db
        .select()
        .from(userOrgs)
        .where(sql`${userOrgs.userId} = ${user.id} AND ${userOrgs.orgId} = ${defaultOrgId}`)
        .limit(1);

      if (!existing) {
        await db.insert(userOrgs).values({ userId: user.id, orgId: defaultOrgId });
      }
    }
    console.log(`✅ Linked ${allUsers.length} users to default organization`);

    // 4. Assign all entities to default org
    console.log("📊 Assigning entities to default organization...");

    const [jobCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(jobs)
      .where(isNull(jobs.organizationId));
    if (Number(jobCount?.count || 0) > 0) {
      await db.update(jobs).set({ organizationId: defaultOrgId }).where(isNull(jobs.organizationId));
      console.log(`✅ Assigned ${jobCount?.count || 0} jobs to default organization`);
    }

    const [pipelineCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(pipelines)
      .where(isNull(pipelines.organizationId));
    if (Number(pipelineCount?.count || 0) > 0) {
      await db.update(pipelines).set({ organizationId: defaultOrgId }).where(isNull(pipelines.organizationId));
      console.log(`✅ Assigned ${pipelineCount?.count || 0} pipelines to default organization`);
    }

    const [credentialCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(credentials)
      .where(isNull(credentials.organizationId));
    if (Number(credentialCount?.count || 0) > 0) {
      await db.update(credentials).set({ organizationId: defaultOrgId }).where(isNull(credentials.organizationId));
      console.log(`✅ Assigned ${credentialCount?.count || 0} credentials to default organization`);
    }

    const [scheduleCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schedules)
      .where(isNull(schedules.organizationId));
    if (Number(scheduleCount?.count || 0) > 0) {
      await db.update(schedules).set({ organizationId: defaultOrgId }).where(isNull(schedules.organizationId));
      console.log(`✅ Assigned ${scheduleCount?.count || 0} schedules to default organization`);
    }

    const [scheduledJobCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(scheduledJobs)
      .where(isNull(scheduledJobs.organizationId));
    if (Number(scheduledJobCount?.count || 0) > 0) {
      await db.update(scheduledJobs).set({ organizationId: defaultOrgId }).where(isNull(scheduledJobs.organizationId));
      console.log(`✅ Assigned ${scheduledJobCount?.count || 0} scheduled jobs to default organization`);
    }

    const [topicCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(knowledgeTopics)
      .where(isNull(knowledgeTopics.organizationId));
    if (Number(topicCount?.count || 0) > 0) {
      await db.update(knowledgeTopics).set({ organizationId: defaultOrgId }).where(isNull(knowledgeTopics.organizationId));
      console.log(`✅ Assigned ${topicCount?.count || 0} knowledge topics to default organization`);
    }

    const [documentCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(knowledgeDocuments)
      .where(isNull(knowledgeDocuments.organizationId));
    if (Number(documentCount?.count || 0) > 0) {
      await db.update(knowledgeDocuments).set({ organizationId: defaultOrgId }).where(isNull(knowledgeDocuments.organizationId));
      console.log(`✅ Assigned ${documentCount?.count || 0} knowledge documents to default organization`);
    }

    const [executionCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(pipelineExecutions)
      .where(isNull(pipelineExecutions.organizationId));
    if (Number(executionCount?.count || 0) > 0) {
      // Pipeline executions inherit from pipelines, so we update based on pipeline's org
      const pipelinesList = await db.select().from(pipelines);
      for (const pipeline of pipelinesList) {
        if (pipeline.organizationId) {
          await db
            .update(pipelineExecutions)
            .set({ organizationId: pipeline.organizationId })
            .where(eq(pipelineExecutions.pipelineId, pipeline.id));
        }
      }
      console.log(`✅ Assigned pipeline executions to default organization`);
    }

    const [alertCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(alerts)
      .where(isNull(alerts.organizationId));
    if (Number(alertCount?.count || 0) > 0) {
      // Alerts inherit from related entities, assign to default org for now
      await db.update(alerts).set({ organizationId: defaultOrgId }).where(isNull(alerts.organizationId));
      console.log(`✅ Assigned ${alertCount?.count || 0} alerts to default organization`);
    }

    console.log("✅ Migration completed successfully!");
  } catch (error: any) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateToOrgs()
    .then(() => {
      console.log("Migration script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration script failed:", error);
      process.exit(1);
    });
}

export { migrateToOrgs };

