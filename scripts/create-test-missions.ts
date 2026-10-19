import { db } from "../server/db/index.js";
import { 
  missions, 
  pipelines, 
  pipelineSteps, 
  missionMembers, 
  jobs,
  orgs
} from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function createMissions() {
  console.log("--- Creating New Missions & Pipelines (Fixed) ---");

  const [org] = await db.select().from(orgs).limit(1);
  if (!org) {
    console.error("No organization found.");
    process.exit(1);
  }

  const getJob = async (name: string) => {
    const [job] = await db.select().from(jobs).where(eq(jobs.name, name)).limit(1);
    return job;
  };

  const securityJob = await getJob('Security Auditor Agent');
  const perfJob = await getJob('Performance Engineer Agent');
  const uxJob = await getJob('UX Researcher Agent');

  const missionData = [
    {
      name: "Project Aegis",
      objective: "Conduct a comprehensive security baseline audit of the codebase and dependencies.",
      job: securityJob,
      steps: [
        { toolName: "dependency-scanner", outputName: "vulnerability_report" },
        { toolName: "secret-detector", outputName: "secret_leak_audit" },
        { toolName: "report-synthesizer", outputName: "security_hardening_plan" }
      ]
    },
    {
      name: "Project Velocity",
      objective: "Establish a performance baseline and identify system bottlenecks under load.",
      job: perfJob,
      steps: [
        { toolName: "latency-benchmark", outputName: "endpoint_benchmarks" },
        { toolName: "resource-monitor", outputName: "resource_usage_data" },
        { toolName: "optimization-planner", outputName: "scalability_strategy" }
      ]
    },
    {
      name: "Project Clarity",
      objective: "Optimize the user dashboard for accessibility and minimize interaction friction.",
      job: uxJob,
      steps: [
        { toolName: "a11y-scanner", outputName: "accessibility_violations" },
        { toolName: "ux-flow-analyzer", outputName: "onboarding_friction_report" },
        { toolName: "ux-proposer", outputName: "ui_improvement_guide" }
      ]
    }
  ];

  for (const data of missionData) {
    if (!data.job) {
      console.warn(`Skipping ${data.name} because its job was not found.`);
      continue;
    }

    // 1. Create Mission (Removed 'visibility')
    const [mission] = await db.insert(missions).values({
      organizationId: org.id,
      name: data.name,
      objective: data.objective,
      status: 'active',
      createdBy: 'system'
    }).returning();

    console.log(`Created Mission: ${mission.name} (${mission.id})`);

    // 2. Add Job as Member
    await db.insert(missionMembers).values({
      missionId: mission.id,
      entityType: 'job',
      entityId: data.job.id,
      role: 'member', // Fixed role per missionMemberRoles
      status: 'active'
    });

    // 3. Create Pipeline (Removed 'status', used 'triggerType', used 'lifecycleStatus')
    const [pipeline] = await db.insert(pipelines).values({
      organizationId: org.id,
      name: `${data.name} Pipeline`,
      description: `Execution pipeline for ${data.name}`,
      triggerType: 'manual',
      lifecycleStatus: 'active',
      createdBy: 'system'
    }).returning();

    // 4. Create pipeline steps (Removed 'name', 'description')
    for (let i = 0; i < data.steps.length; i++) {
      const step = data.steps[i];
      await db.insert(pipelineSteps).values({
        pipelineId: pipeline.id,
        order: i, // 0-based order usually
        jobId: data.job.id,
        toolName: step.toolName,
        outputName: step.outputName
      });
    }

    console.log(`Created Pipeline and ${data.steps.length} steps for ${data.name}`);
  }

  process.exit(0);
}

createMissions().catch(err => {
  console.error(err);
  process.exit(1);
});
