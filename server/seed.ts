import "dotenv/config";
import { db } from "./database_service.js";
import { sql, eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import {
  users, orgs, credentials, jobs, schedules, scheduledJobs,
  pipelines, pipelineSteps, pipelineExecutions, pipelineStepExecutions,
  alerts, adminRoles, userOrgs, knowledgeDocuments, knowledgeTopics,
  knowledgeNodes, knowledgeEdges, ragAssets, orgSettings, jobOutputKnowledge, graphSchemaDefs,
  knowledgeDocumentExtractions, extractionBatches, snapshots, eventLog, eventWebhookSubscriptions, webhookDeliveryLog,
  storedFiles, storedFileVersions,
  mcpApiTokens, fineTuningExamples, fineTuningDatasets, datasetItems, datasets, schemaMappingTemplates,
  runLocks, scheduleTriggers, scheduleExecutionHistory, agentDeployments,
  systemSettings, pipelineInputParams, documentTemplates,
  saasConnectors, saasSyncConfigs,
  missionTemplates, apps, skills,
  missionRuns, operationalCycles, hilForms, missionBlackboardHistory, missionMembers,
  appTelemetry, appAuditLogs, appDeployments, appInstances, appUserUsage, appPayouts, appRecords, appAudits, appVersions,
  gatewayRequestLogs, orgSpecAccess, saasEventWorkflows, saasSchemaSnapshots,
  knowledgeEvolutionEvents,
  componentIndex
} from "@shared/schema/index.js";
import { hashPassword } from "./domain/auth/index.js";
import { JOB_TYPE_CONFIG } from "./domain/jobs/ui/job-type-config.js";
import { SOUL_ARCHETYPES, OCEAN_LABELS } from "./domain/ai/ui/modules/agent-ai/soul-constants.js";


/**
 * This script is DESTRUCTIVE. It TRUNCATEs the foundational tables below with
 * RESTART IDENTITY CASCADE, which cascades across the whole schema — every org, user,
 * job, pipeline, app and dataset in the target database is destroyed.
 *
 * It reads DATABASE_URL, which in normal development points at the DEVELOPMENT
 * database, and it previously had no guard of any kind: a stray `npm run db:seed`
 * wiped real data with no confirmation. It now refuses to run unless the caller opts
 * in explicitly.
 */
function assertDestructiveSeedAllowed(): void {
  if (process.env.ALLOW_DESTRUCTIVE_SEED === "true") return;

  let target = "(DATABASE_URL not set)";
  try {
    const parsed = new URL(process.env.DATABASE_URL ?? "");
    target = `${parsed.hostname}:${parsed.port}${parsed.pathname}`;
  } catch { /* leave the placeholder */ }

  console.error(
    "\n❌ Refusing to seed: this TRUNCATEs orgs, users, jobs, pipelines, apps, datasets\n" +
    "   and more (RESTART IDENTITY CASCADE) — all existing data in the target database\n" +
    "   is destroyed.\n\n" +
    `   Target: ${target}\n\n` +
    "   Re-run with ALLOW_DESTRUCTIVE_SEED=true if that is genuinely what you want.\n",
  );
  process.exit(1);
}

async function seed() {
  console.log("🌱 Starting seed process...");

  assertDestructiveSeedAllowed();

  // 1. Cleanup
  console.log("🧹 Cleaning existing data using CASCADE...");
  // We use TRUNCATE with CASCADE on foundational tables to clear everything efficiently
  // This avoids foreign key constraint issues across the 100+ tables in the schema.
  try {
    await db.execute(sql`TRUNCATE TABLE 
      orgs, 
      users, 
      skills, 
      jobs, 
      pipelines, 
      mission_templates, 
      knowledge_topics, 
      knowledge_documents,
      credentials,
      saas_connectors,
      apps,
      datasets,
      system_settings,
      session
    RESTART IDENTITY CASCADE;`);
    console.log("✅ Database cleared successfully.");
  } catch (e: any) {
    console.error(`❌ Critical failure during database cleanup:`, e);
    process.exit(1);
  }


  // 2. Organizations
  console.log("🏢 Creating organizations...");
  const [defaultOrg] = await db.insert(orgs).values({
    name: "Acme Corp (Default)",
  }).returning();

  const [secondOrg] = await db.insert(orgs).values({
    name: "TechStart Inc",
  }).returning();

  // 3. Users
  console.log("👥 Creating users...");
  const adminPassword = await hashPassword("admin123");
  const [adminUser] = await db.insert(users).values({
    username: "admin",
    password: adminPassword,
    email: "admin@acme.com",
    firstName: "System",
    lastName: "Administrator",
    defaultOrgId: defaultOrg.id,
    quietHoursEnabled: false,
  }).returning();

  const managerPassword = await hashPassword("manager123");
  const [managerUser] = await db.insert(users).values({
    username: "manager",
    password: managerPassword,
    email: "manager@acme.com",
    firstName: "Ops",
    lastName: "Manager",
    defaultOrgId: defaultOrg.id,
    quietHoursEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
  }).returning();

  const orgAdminPassword = await hashPassword("orgadmin123");
  const [orgAdminUser] = await db.insert(users).values({
    username: "orgadmin",
    password: orgAdminPassword,
    email: "orgadmin@acme.com",
    firstName: "Organization",
    lastName: "Admin",
    defaultOrgId: defaultOrg.id,
    quietHoursEnabled: false,
  }).returning();

  const regularUserPassword = await hashPassword("user123");
  const [regularUser] = await db.insert(users).values({
    username: "user",
    password: regularUserPassword,
    email: "user@acme.com",
    firstName: "Regular",
    lastName: "User",
    defaultOrgId: defaultOrg.id,
    quietHoursEnabled: false,
  }).returning();

  const exampleAdminPassword = await hashPassword("password123");
  const [exampleAdminUser] = await db.insert(users).values({
    username: "admin2",
    password: exampleAdminPassword,
    email: "admin@example.com",
    firstName: "Example",
    lastName: "Admin",
    defaultOrgId: defaultOrg.id,
    quietHoursEnabled: false,
  }).returning();

  console.log("🤖 Creating system user...");
  const systemPassword = await hashPassword(crypto.randomUUID());
  await db.insert(users).values({
    id: "oddjob-system",
    username: "system",
    password: systemPassword,
    email: "system@oddjob.ai",
    firstName: "Oddjob",
    lastName: "System",
    defaultOrgId: defaultOrg.id,
    quietHoursEnabled: false,
  });

  // 4. Assign users to organizations
  console.log("🔗 Assigning users to organizations...");
  await db.insert(userOrgs).values([
    { userId: adminUser.id, orgId: defaultOrg.id },
    { userId: managerUser.id, orgId: defaultOrg.id },
    { userId: orgAdminUser.id, orgId: defaultOrg.id },
    { userId: regularUser.id, orgId: defaultOrg.id },
    { userId: exampleAdminUser.id, orgId: defaultOrg.id },
  ]);

  // 5. Create admin roles
  console.log("👑 Creating admin roles...");
  await db.insert(adminRoles).values({
    userId: adminUser.id,
    role: "super_admin",
    organizationId: null,
  });

  await db.insert(adminRoles).values({
    userId: exampleAdminUser.id,
    role: "super_admin",
    organizationId: null,
  });

  await db.insert(adminRoles).values({
    userId: orgAdminUser.id,
    role: "org_admin",
    organizationId: defaultOrg.id,
  });

  // 6. Credentials
  console.log("🔑 Creating credentials...");
  const [openaiCred] = await db.insert(credentials).values({
    name: "OpenAI Production",
    type: "ai_provider",
    envVarName: "OPENAI_API_KEY",
    metadata: { provider: "openai", organizationId: "org-123" },
    createdBy: adminUser.username,
  }).returning();

  await db.insert(credentials).values({
    name: "AWS S3 Backup",
    type: "api_key",
    envVarName: "AWS_SECRET_KEY",
    metadata: {},
    createdBy: adminUser.username,
  });

  await db.insert(credentials).values({
    name: "Gemini Production",
    type: "ai_provider",
    envVarName: "GEMINI_API_KEY",
    metadata: { provider: "google" },
    createdBy: adminUser.username,
  });

  await db.insert(credentials).values({
    name: "Ollama Local",
    type: "ai_provider",
    envVarName: "OLLAMA_BASE_URL",
    metadata: { provider: "ollama", baseUrl: "http://localhost:11434" },
    createdBy: adminUser.username,
  });

  await db.insert(credentials).values({
    name: "Anthropic Production",
    type: "ai_provider",
    envVarName: "ANTHROPIC_API_KEY",
    metadata: { provider: "anthropic" },
    createdBy: adminUser.username,
  });

  const [jiraCred] = await db.insert(credentials).values({
    name: "JIRA Production",
    type: "jira",
    envVarName: "JIRA_API_TOKEN",
    metadata: { baseUrl: "https://jira.acme.com", email: "admin@acme.com" },
    createdBy: adminUser.username,
  }).returning();

  // 7. Knowledge Topics
  console.log("📚 Creating knowledge topics...");
  const [errorTopic] = await db.insert(knowledgeTopics).values({
    name: "Errors",
    description: "Technical error codes and resolutions",
    organizationId: defaultOrg.id,
    createdBy: adminUser.username,
  }).returning();

  const [supportTopic] = await db.insert(knowledgeTopics).values({
    name: "Support",
    description: "Customer support guidelines",
    organizationId: defaultOrg.id,
    createdBy: adminUser.username,
  }).returning();

  // 8. Jobs
  console.log("⚙️ Creating jobs...");
  const [cleanupJob] = await db.insert(jobs).values({
    name: "System Cleanup",
    description: "Removes temporary files from /tmp directory",
    type: "shell",
    tool: "None",
    organizationId: defaultOrg.id,
    config: { executable: "/bin/bash", parameters: "-c 'rm -rf /tmp/*'", workingDirectory: "/" },
    priority: 3,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [reportJob] = await db.insert(jobs).values({
    name: "Weekly Sales Report",
    description: "Generates PDF report and emails to stakeholders",
    type: "api",
    tool: "None",
    organizationId: defaultOrg.id,
    config: {
      url: "https://api.internal.acme.com/reports/generate",
      method: "POST",
      authType: "bearer",
      credentialId: openaiCred.id // Just mocking association
    },
    priority: 2,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [aiJob] = await db.insert(jobs).values({
    name: "Sentiment Analysis",
    description: "Analyzes customer support tickets using LLM",
    type: "ai_api_call",
    tool: "None",
    organizationId: defaultOrg.id,
    config: {
      credentialId: openaiCred.id,
      model: "gpt-4",
      systemPrompt: "You are a helpful assistant.",
      userPrompt: "Analyze this text: {{input}}"
    },
    priority: 1,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [getIssuesJob] = await db.insert(jobs).values({
    name: "Get Issues",
    description: "Fetch relevant issues from JIRA",
    type: "api",
    tool: "None",
    organizationId: defaultOrg.id,
    config: {
      url: "/rest/api/3/search",
      method: "GET",
      credentialId: jiraCred.id,
      queryParams: { jql: "project = PROJ AND status = 'To Do'" }
    },
    priority: 2,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [guessFeatureJob] = await db.insert(jobs).values({
    name: "Guess the feature",
    description: "Identify feature name from issue description",
    type: "ai_api_call",
    tool: "None",
    organizationId: defaultOrg.id,
    config: {
      credentialId: openaiCred.id,
      model: "gpt-4",
      systemPrompt: "You are a product manager. Extract a concise feature name from the following issue description.",
      userPrompt: "Issue: {{step.0.output}}"
    },
    priority: 2,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [updateJiraJob] = await db.insert(jobs).values({
    name: "Update JIRA",
    description: "Update JIRA issue with feature name",
    type: "api",
    organizationId: defaultOrg.id,
    tool: "None",
    config: {
      url: "/rest/api/3/issue/{{step.0.output.key}}",
      method: "PUT",
      credentialId: jiraCred.id,
      body: JSON.stringify({ fields: { customfield_1001: "{{step.1.output}}" } })
    },
    priority: 2,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [dummyJob] = await db.insert(jobs).values({
    name: "E2E Dummy Job",
    description: "Simple script for testing agent interaction",
    type: "node_script",
    tool: "None",
    organizationId: defaultOrg.id,
    config: {
      script: "return { success: true, processed: inputs.target_code };",
      inputs: { target_code: "{{input.target_code}}" }
    },
    priority: 3,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [e2eAgentJob] = await db.insert(jobs).values({
    name: "E2E Public Agent",
    description: "AI Agent for E2E Verification",
    type: "ai_agent",
    tool: "None",
    organizationId: defaultOrg.id,
    config: {
      model: "gemini-2.0-flash",
      goal: "Help user run the test pipeline.",
      systemPrompt: "You are a test agent.",
      allowedTools: ["show_pipeline_input_form", "trigger_pipeline", "get_pipeline_status"],
      pipelineIds: [] // Will link after pipeline creation
    },
    priority: 1,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [qaPlannerAgentJob] = await db.insert(jobs).values({
    name: "QA Planner",
    description: "AI Agent for QA Planning and Automation",
    type: "ai_agent",
    tool: "None",
    organizationId: defaultOrg.id,
    config: {
      model: "gemini-2.0-flash",
      goal: "Plan and execute QA automation tasks.",
      systemPrompt: "You are a QA automation expert.",
      allowedTools: [
        "show_pipeline_input_form",
        "trigger_pipeline",
        "get_pipeline_status",
        "search_knowledge_base",
        "search_documents",
        "list_documents",
        "get_document_details"
      ],
      topicIds: [errorTopic.id],
      pipelineIds: []
    },
    priority: 1,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  // 8. Schedules
  console.log("📅 Creating schedules...");
  const [dailySchedule] = await db.insert(schedules).values({
    name: "Daily at Midnight",
    description: "Runs once every day at 00:00 UTC",
    pattern: 1, // Daily
    organizationId: defaultOrg.id,
    patternString: { starttime: "00:00" },
    timezone: "UTC",
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [weeklySchedule] = await db.insert(schedules).values({
    name: "Weekly on Monday",
    description: "Runs every Monday morning at 8am",
    pattern: 2, // Weekly
    organizationId: defaultOrg.id,
    patternString: { starttime: "08:00", weekdays: "1" },
    timezone: "America/New_York",
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  // 10. Knowledge Documents
  console.log("📄 Creating knowledge documents...");
  const [errorDoc] = await db.insert(knowledgeDocuments).values({
    title: "Error Codes",
    summary: "Common system error codes and their meanings",
    sourceType: "text",
    textContent: "ERROR-500: Internal Server Error. Occurs when the backend crashes.\nERROR-404: Not Found. Resource missing.\nERROR-401: Unauthorized. Login required.\nERROR-403: Forbidden. Access denied.",
    organizationId: defaultOrg.id,
    createdBy: adminUser.username,
  }).returning();

  // 11. Graph Schemas
  console.log("🧠 Creating graph schemas...");
  await db.insert(graphSchemaDefs).values({
    name: "General Knowledge",
    description: "Standard schema for general purpose entity extraction",
    mappings: [
      {
        id: "m1",
        name: "Error Extract",
        node_label: "Error",
        extraction_type: "ai",
        config: {
          prompt: "Extract error codes (e.g. ERROR-500) and descriptions."
        }
      },
      {
        id: "m2",
        name: "User Extract",
        node_label: "User",
        extraction_type: "regex",
        config: {
          regex: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"
        }
      }
    ],
    organizationId: null,
    createdBy: adminUser.username,
  });

  // 12. System Settings
  console.log("⚙️ Creating system settings...");
  await db.insert(systemSettings).values({
    key: "global",
    settingsData: {
      systemAiDefaults: {
        copilot: { provider: "google", model: "gemini-2.0-flash" },
        concierge: { provider: "google", model: "gemini-2.0-flash" },
        faultAnalysis: { provider: "google", model: "gemini-2.0-flash" }
      },
      monitoring: { enabled: true, retentionDays: 30 },
      jobTypes: JOB_TYPE_CONFIG,
      soulConstants: {
        archetypes: SOUL_ARCHETYPES,
        archetypeTraits: {
          "Lead Directive": { o: 0.6, c: 0.9, e: 0.7, a: 0.5, n: 0.2 },
          "Ghost Analyst": { o: 0.9, c: 0.7, e: 0.2, a: 0.4, n: 0.3 },
          "The Quartermaster": { o: 0.5, c: 0.95, e: 0.4, a: 0.8, n: 0.1 },
          "Strategic Oracle": { o: 0.9, c: 0.8, e: 0.4, a: 0.5, n: 0.2 },
          "Field Operative": { o: 0.4, c: 0.9, e: 0.8, a: 0.6, n: 0.3 },
          "Tactical Analyst": { o: 0.7, c: 0.9, e: 0.3, a: 0.4, n: 0.2 },
          "Creative Catalyst": { o: 0.95, c: 0.5, e: 0.8, a: 0.7, n: 0.4 },
          "Data Sentinel": { o: 0.5, c: 0.98, e: 0.2, a: 0.5, n: 0.1 },
          "Crisis Commander": { o: 0.6, c: 0.95, e: 0.9, a: 0.4, n: 0.2 },
          "Knowledge Architect": { o: 0.85, c: 0.9, e: 0.4, a: 0.7, n: 0.1 },
        },
        oceanLabels: OCEAN_LABELS,
      },

      serviceUrls: {
        pythonService: process.env.PYTHON_SERVICE_URL || "http://localhost:8001",
        predictiveService: "http://localhost:8002",
        ollama: "http://localhost:11434",
        qdrant: "http://localhost:6333",
      },
      theme: {
        healthColors: {
          excellent: { color: "#22c55e", bg: "#dcfce7", label: "Excellent" },
          good: { color: "#84cc16", bg: "#ecfccb", label: "Good" },
          fair: { color: "#eab308", bg: "#fef9c3", label: "Fair" },
          poor: { color: "#f97316", bg: "#ffedd5", label: "Poor" },
          critical: { color: "#ef4444", bg: "#fee2e2", label: "Critical" },
        },
        statusColors: {
          active: { color: "#10b981", bg: "#ecfdf5" },
          inactive: { color: "#6b7280", bg: "#f3f4f6" },
          error: { color: "#ef4444", bg: "#fef2f2" },
          warning: { color: "#f59e0b", bg: "#fffbeb" },
          running: { color: "#3b82f6", bg: "#eff6ff" },
        }
      }
    }
  });


  // 13. Scheduled Jobs (Links)
  console.log("🔗 Linking jobs to schedules...");
  await db.insert(scheduledJobs).values({
    name: "Daily System Cleanup",
    jobId: cleanupJob.id,
    scheduleId: dailySchedule.id,
    isActive: true,
    priority: 3,
    triggerType: "Schedule",
    createdBy: adminUser.username,
  });

  await db.insert(scheduledJobs).values({
    name: "Monday Sales Report",
    jobId: reportJob.id,
    scheduleId: weeklySchedule.id,
    isActive: true,
    priority: 1,
    triggerType: "Schedule",
    createdBy: adminUser.username,
  });

  // 14. Agent Deployments
  console.log("🤖 Creating agent deployments...");
  await db.insert(agentDeployments).values({
    jobId: e2eAgentJob.id,
    slug: "e2e-test-agent",
    title: "E2E Test Agent",
    description: "Agent for E2E verification of form inputs and pipeline monitoring.",
    welcomeMessage: "Hello! I can run the E2E Verification Pipeline for you.",
    organizationId: defaultOrg.id,
    createdBy: adminUser.id,
    accessPolicy: "public"
  });

  await db.insert(agentDeployments).values({
    jobId: qaPlannerAgentJob.id,
    slug: "agent-7",
    title: "QA Planner Agent",
    description: "Intelligent QA planning and execution agent.",
    welcomeMessage: "Hello! I am your QA Planner. How can I help you today?",
    organizationId: defaultOrg.id,
    createdBy: adminUser.id,
    accessPolicy: "public"
  });

  // These inserts bypass AgentDeploymentService.upsert, which is where agents
  // normally receive their deterministic fallbacks. Derive them explicitly so a
  // freshly seeded environment satisfies the same invariant as a live one:
  // no agent exists without a limp mode.
  try {
    const { agentFallbackService } = await import("@domain/agents/agent-fallback.service.js");
    const seeded = await db.select({ id: agentDeployments.id })
      .from(agentDeployments)
      .where(eq(agentDeployments.organizationId, defaultOrg.id));
    for (const { id } of seeded) {
      await agentFallbackService.derive(id);
    }
    console.log(`🛟 Derived fallback manifests for ${seeded.length} agent deployment(s)`);
  } catch (err: any) {
    console.warn(`⚠️  Could not derive agent fallbacks: ${err.message}`);
  }

  // 16. Pipelines
  console.log("🔀 Creating pipelines...");
  const [etlPipeline] = await db.insert(pipelines).values({
    name: "Customer Data ETL",
    description: "Ingest -> Analyze -> Report workflow",
    triggerType: "schedule",
    organizationId: defaultOrg.id,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  const [e2ePipeline] = await db.insert(pipelines).values({
    name: "E2E Verification Pipeline",
    description: "A pipeline to verify agent form inputs and monitoring.",
    triggerType: "manual",
    organizationId: defaultOrg.id,
    isActive: true,
    createdBy: adminUser.username,
  }).returning();

  // Link agent to its pipeline
  await db.update(jobs)
    .set({ config: { ... (e2eAgentJob.config as any), pipelineIds: [e2ePipeline.id] } })
    .where(eq(jobs.id, e2eAgentJob.id));

  // 17. Pipeline Parameters
  console.log("📝 Creating pipeline parameters...");
  await db.insert(pipelineInputParams).values([
    {
      pipelineId: e2ePipeline.id,
      name: "target_code",
      label: "Target Code",
      description: "A 3-letter uppercase code.",
      dataType: "string",
      isRequired: true,
      displayOrder: 1,
      pattern: "^[A-Z]{3}$",
      patternMessage: "Must be exactly 3 uppercase letters (e.g., ABC)."
    },
    {
      pipelineId: e2ePipeline.id,
      name: "reason",
      label: "Reason",
      description: "Why are you running this?",
      dataType: "string",
      isRequired: true,
      displayOrder: 2
    }
  ]);

  // 18. Pipeline Steps
  console.log("🛤️ Creating pipeline steps...");
  await db.insert(pipelineSteps).values([
    {
      pipelineId: etlPipeline.id,
      jobId: cleanupJob.id,
      order: 0,
      outputName: "cleanup_status",
      runOnCondition: "on_success",
    },
    {
      pipelineId: etlPipeline.id,
      jobId: aiJob.id,
      order: 1,
      outputName: "analysis_result",
      runOnCondition: "on_success",
      waitDurationSeconds: 5,
    },
    {
      pipelineId: etlPipeline.id,
      jobId: reportJob.id,
      order: 2,
      outputName: "final_report",
      runOnCondition: "always",
    },
    {
      pipelineId: e2ePipeline.id,
      jobId: dummyJob.id,
      order: 0,
      outputName: "dummy_processed",
      runOnCondition: "on_success",
    }
  ]);

  // 19. Document Templates
  console.log("📄 Creating document templates...");
  await db.insert(documentTemplates).values([
    {
      name: "Standard Response Template",
      description: "Default template for AI agent responses",
      type: "markdown",
      content: "# Dynamic Response\n\nHello {{user}},\n\nBased on your request regarding {{topic}}, here is the information I found:\n\n{{content}}\n\nRegards,\nOddjob Assistant",
      category: "general",
      organizationId: defaultOrg.id,
      createdBy: adminUser.id,
    },
    {
      name: "QA Analysis Standard",
      description: "Standard format for QA automation reports",
      type: "markdown",
      content: "# QA Execution Report\n\n- **Project**: {{project}}\n- **Status**: {{status}}\n- **Timestamp**: {{timestamp}}\n\n## Findings\n\n{{findings}}\n\n## Recommendations\n\n{{recommendations}}",
      category: "qa",
      organizationId: defaultOrg.id,
      createdBy: adminUser.id,
    },
    {
      name: "Statement of Work (SOW)",
      description: "Professional services and technology engagement contract with deliverables, RACI, milestones, and commercials",
      type: "markdown",
      content: "# Statement of Work (SOW)\n\n**Document Reference:** `SOW-{{project_code}}-v1.0`\n**Client:** `{{client_name}}`\n**Service Provider:** `{{provider_name}}`\n**Project Name:** `{{project_name}}`\n\n## 1. Executive Summary & Strategic Objectives\n{{#business_context}}\nDescribe strategic outcome.\n{{/business_context}}\n\n## 2. Scope of Services\n### In-Scope\n- Work Package 1: Discovery & Architecture\n- Work Package 2: Core Implementation\n\n### Out-of-Scope\n- Hardware procurement\n- Legacy system remediation\n\n## 3. Deliverables & Acceptance\n- `DEL-01`: Architecture Blueprint & Threat Model\n- `DEL-02`: Production Service Implementation\n\n## 4. Milestones & Timeline\n- M1: Discovery (Weeks 1-2)\n- M2: Build (Weeks 3-6)\n- M3: QA & Cutover (Weeks 7-8)\n\n## 5. Commercials & Payment Terms\n- Engagement Model: {{pricing_model}}\n- Total Contract Value: {{currency_symbol}}{{total_contract_value}}\n\n## 6. Signatures\nAuthorized signatures for {{client_name}} and {{provider_name}}.",
      category: "legal",
      organizationId: defaultOrg.id,
      createdBy: adminUser.id,
    },
    {
      name: "Business Case & ROI Justification",
      description: "Comprehensive financial and strategic appraisal (TCO, NPV, Payback, TOM) for executive steering committees",
      type: "markdown",
      content: "# Business Case & ROI Justification\n\n**Initiative:** `{{initiative_name}}`\n**Sponsor:** `{{executive_sponsor}}`\n\n## 1. Executive Summary\nStrategic rationale and problem statement.\n\n## 2. Options Appraisal\n- Option 1: Do Nothing\n- Option 2: Point Solution\n- Option 3: Enterprise Platform (Recommended)\n\n## 3. Financial Appraisal\n- 3-Year TCO: {{tco_value}}\n- Net Present Value (NPV): {{npv_value}}\n- Payback Period: {{payback_months}} months\n- Estimated 3-Year ROI: {{roi_percentage}}%\n\n## 4. Decision Request\nRequest approval to allocate budget for Phase 1 execution.",
      category: "business",
      organizationId: defaultOrg.id,
      createdBy: adminUser.id,
    },
    {
      name: "Standard Operating Procedure (SOP)",
      description: "Step-by-step operating procedure with pre-flight checks, blast radius safety gates, and audit logging",
      type: "markdown",
      content: "# Standard Operating Procedure (SOP)\n\n**SOP ID:** `SOP-{{department_code}}-001`\n**Title:** `{{sop_title}}`\n**Owner:** `{{process_owner_role}}`\n\n## 1. Purpose & Scope\nMandatory operating procedure for {{procedure_name}}.\n\n## 2. Prerequisites & Credentials\n- Active operator RBAC role\n- Valid incident / change reference ticket\n\n## 3. Step-by-Step Execution\n1. Pre-flight verification & distributed lock acquisition\n2. Dry-run execution & blast radius check (must be < 5%)\n3. Production pipeline dispatch\n4. Real-time telemetry health sweep\n5. Post-flight attestation & forensic log audit\n\n## 4. Rollback & Exception Handling\nAutomated rollback protocol and escalation matrix.",
      category: "operations",
      organizationId: defaultOrg.id,
      createdBy: adminUser.id,
    }
  ]);

  // 20. SaaS Connectors
  // Credentials come from the environment, never from this file: a connector
  // whose variables are unset is seeded disconnected with no secrets.
  //   SEED_ATLASSIAN_BASE_URL, SEED_ATLASSIAN_USERNAME, SEED_ATLASSIAN_API_TOKEN,
  //   SEED_JIRA_PROJECTS, SEED_CONFLUENCE_SPACES (comma-separated keys)
  //   SEED_SLACK_CLIENT_ID, SEED_SLACK_CLIENT_SECRET, SEED_SLACK_SIGNING_SECRET,
  //   SEED_SLACK_APP_TOKEN, SEED_SLACK_BOT_TOKEN
  console.log("🔌 Creating SaaS connectors...");
  const seedEnv = (name: string) => process.env[name]?.trim() || undefined;
  const seedList = (name: string) => (seedEnv(name) ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const atlassian = {
    base_url: seedEnv("SEED_ATLASSIAN_BASE_URL"),
    username: seedEnv("SEED_ATLASSIAN_USERNAME"),
    api_key: seedEnv("SEED_ATLASSIAN_API_TOKEN"),
  };
  const atlassianReady = Boolean(atlassian.base_url && atlassian.username && atlassian.api_key);
  const slackBotToken = seedEnv("SEED_SLACK_BOT_TOKEN");

  const [jiraConnector] = await db.insert(saasConnectors).values({
    orgId: defaultOrg.id,
    platform: "jira",
    status: atlassianReady ? "connected" : "disconnected",
    config: {
      name: "Jira",
      enabled: atlassianReady,
      target_storage: "dataset",
      allowed_projects: seedList("SEED_JIRA_PROJECTS")
    },
    credentials: atlassianReady ? atlassian : {}
  }).returning();

  const [confluenceConnector] = await db.insert(saasConnectors).values({
    orgId: defaultOrg.id,
    platform: "confluence",
    status: atlassianReady ? "connected" : "disconnected",
    config: {
      name: "Confluence",
      enabled: atlassianReady,
      allowed_spaces: seedList("SEED_CONFLUENCE_SPACES"),
      target_storage: "knowledge_store"
    },
    credentials: atlassianReady ? atlassian : {}
  }).returning();

  const [slackConnector] = await db.insert(saasConnectors).values({
    orgId: defaultOrg.id,
    platform: "slack",
    status: slackBotToken ? "connected" : "disconnected",
    config: {
      name: "Slack",
      enabled: Boolean(slackBotToken)
    },
    credentials: slackBotToken ? {
      client_id: seedEnv("SEED_SLACK_CLIENT_ID"),
      client_secret: seedEnv("SEED_SLACK_CLIENT_SECRET"),
      signing_secret: seedEnv("SEED_SLACK_SIGNING_SECRET"),
      app_token: seedEnv("SEED_SLACK_APP_TOKEN"),
      bot_token: slackBotToken,
      token: slackBotToken
    } : {}
  }).returning();

  // 21. SaaS Sync Configs
  console.log("🔄 Creating SaaS sync configs...");
  await db.insert(saasSyncConfigs).values([
    {
      connectorId: jiraConnector.id,
      enabled: atlassianReady,
      syncInterval: 15
    },
    {
      connectorId: confluenceConnector.id,
      enabled: atlassianReady,
      syncInterval: 15
    },
    {
      connectorId: slackConnector.id,
      enabled: Boolean(slackBotToken),
      syncInterval: 15
    }
  ]);

  // 22. Built-in Mission Templates (organizationId null = available to all orgs)
  console.log("📋 Creating built-in mission templates...");
  await db.insert(missionTemplates).values([
    {
      name: "Incident Triage",
      description: "Triage incoming incidents: classify severity, assign owners, and create follow-up tasks.",
      config: {
        type: "incident_triage",
        objective: "Triage and categorize incoming incidents. Assess severity, identify owners, and create actionable follow-up tasks.",
        members: []
      },
      organizationId: null,
      createdBy: "system"
    },
    {
      name: "Research Task",
      description: "Conduct research on a topic: gather sources, synthesize findings, and produce a summary report.",
      config: {
        type: "research",
        objective: "Research the given topic. Gather relevant sources, synthesize findings, and produce a concise summary report with key insights.",
        members: []
      },
      organizationId: null,
      createdBy: "system"
    },
    {
      name: "Document Review",
      description: "Review documents for compliance, accuracy, or completeness. Flag issues and suggest improvements.",
      config: {
        type: "document_review",
        objective: "Review documents for compliance, accuracy, and completeness. Flag issues and suggest improvements.",
        members: []
      },
      organizationId: null,
      createdBy: "system"
    }
  ]);

  // 23. Register Prospector system app
  console.log("🏪 Registering Prospector as a System App...");
  await db.insert(apps).values({
    name: "AI Prospector & Co-pilot",
    slug: "prospecting",
    description: "Advanced visitor de-anonymization and interaction tracking. Identify anonymous traffic and score intent in real-time.",
    icon: "Search",
    isPublic: true,
    isSystem: true,
    version: "1.0.0",
    developerOrgId: null,
  });

  // 24. Behavioral Fragments (Skills)
  console.log("🧩 Creating behavioral fragments...");
  await db.insert(skills).values([
    {
      name: "GMS_CORE_SYNTHESIZER",
      description: "High-order mission synthesis engine. Orchestrates multiple behavioral primitives into a coherent goal-oriented execution plan.",
      language: "typescript",
      code: "export async function synthesize(goal: string, context: any) {\n  const fragments = await registry.findResonantFragments(goal);\n  const plan = await engine.compose(fragments, context);\n  return plan;\n}",
      isPublic: true
    },
    {
      name: "NEURAL_LOG_EXTRACTOR",
      description: "Static analysis and runtime telemetry extraction for behavioral drift detection.",
      language: "javascript",
      code: "function extractLogs(traceId) {\n  const logs = db.query('neural_logs').where('trace_id', traceId);\n  return logs.map(l => l.payload);\n}",
      isPublic: true
    },
    {
      name: "BEHAVIORAL_RESONANCE_DETECTOR",
      description: "Detects semantic resonance between mission objectives and historical behavioral outcomes.",
      language: "typescript",
      code: "export function detectResonance(objective: string, history: any[]) {\n  const embeddings = await model.embed(objective);\n  return history.filter(h => cosineSimilarity(h.embedding, embeddings) > 0.85);\n}",
      isPublic: true
    }
  ]);

  // 25. Index Platform Components
  console.log("📦 Indexing platform components from block-registry.json...");
  const BLOCK_REGISTRY_PATH = path.resolve("server/domain/apps/core/block-registry.json");
  try {
    const registryRaw = await fs.readFile(BLOCK_REGISTRY_PATH, "utf-8");
    const registry = JSON.parse(registryRaw);

    const componentsToInsert = registry.blocks.map((block: any) => ({
      componentName: block.name,
      componentCategory: block.category,
      exportType: "component", // Assuming 'component' as a default
      importPath: block.path,
      packageSource: "forge-ui", // Assuming 'forge-ui' as a default
      propSchema: JSON.stringify(block.props),
      dependencies: JSON.stringify(block.tags), // Using tags as a proxy
      codeSnippet: "", // Not available in block-registry.json
      blueprintTemplate: "", // Not available in block-registry.json
      effectivenessScore: "5.00",
      verificationSuccessRate: "100.00",
      isApprovedForAssembly: true,
      createdBy: "system",
    }));

    if (componentsToInsert.length > 0) {
      await db.insert(componentIndex).values(componentsToInsert);
      console.log(`✅ Indexed ${componentsToInsert.length} platform components.`);
    } else {
      console.log("⚠️ No components found in block-registry.json to index.");
    }

  } catch (err: any) {
    console.error(`❌ Failed to index platform components: ${err.message}`);
  }

  console.log("✅ Seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});

