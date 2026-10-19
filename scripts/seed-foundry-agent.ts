import { db } from "../server/db/index.js";
import { jobs, agentDeployments, orgs } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function seedFoundryAgent() {
  console.log("--- Seeding Oddjob Foundry Agent ---");

  // Targeting Organization 67 (KUS) if it exists, otherwise fall back to first available
  const orgId = 67;
  let [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  
  if (!org) {
    console.warn(`Organization ${orgId} (KUS) not found. Falling back to first available organization.`);
    [org] = await db.select().from(orgs).limit(1);
  }

  if (!org) {
    console.error("No organization found. Seeding aborted.");
    process.exit(1);
  }

  const foundryAgentDef = {
    name: 'Foundry Agent',
    description: 'Autonomous Vibe-Coding Architect specialized in high-velocity mini-app construction and historical context integration.',
    oceanTraits: { o: 1.0, c: 0.9, e: 0.6, a: 0.8, n: 0.1 },
    config: {
      credentialId: null,
      model: 'models/gemini-2.0-flash', // High velocity model
      goal: 'Enable conversational construction of mini-apps by integrating historical HIL form context and scaffolding manifests.',
      persona: 'creator',
      maxIterations: 10,
      supervision: 'directed',
      systemPrompt: `You are the Oddjob Foundry Agent, the core orchestrator of the platform's Vibe-Coding environment.

Your primary objective is to help the user build "Mini-Apps" and "Standalone Applications" through natural conversation.

CORE CAPABILITIES:
1. CONTEXT INTEGRATION: Use the 'search_hil_context' skill to retrieve past discussions, requirements, and decisions from 'form_agent' jobs. This ensures new apps are built with full historical awareness.
2. ATOMIC SCAFFOLDING: Use the 'scaffold_mini_app' skill to generate and deploy App Manifests into the organization registry.
3. COPILOTKIT PRIMITIVES: Always prioritize CopilotKit (CopilotChat, CopilotTextarea) as the default UI library for generated application components.

TONE: Collaborative, premium, high-velocity, and deeply informed by the Software Engineering Registry.`,
      allowedTools: ['search_hil_context', 'scaffold_mini_app', 'google_search', 'read_file']
    }
  };

  // 1. Upsert Job
  let [job] = await db.select().from(jobs).where(eq(jobs.name, foundryAgentDef.name)).limit(1);
  if (!job) {
    [job] = await db.insert(jobs).values({
      organizationId: org.id,
      type: 'foundry_agent',
      name: foundryAgentDef.name,
      description: foundryAgentDef.description,
      lifecycleStatus: 'active',
      isActive: true,
      config: foundryAgentDef.config,
      createdBy: 'system'
    }).returning();
    console.log(`Created Job: ${foundryAgentDef.name} (${job.id})`);
  } else {
    console.log(`Job already exists: ${foundryAgentDef.name} (${job.id}). Updating config...`);
    await db.update(jobs)
      .set({ 
        type: 'foundry_agent',
        config: foundryAgentDef.config, 
        updatedAt: new Date() 
      })
      .where(eq(jobs.id, job.id));
  }

  // 2. Upsert Deployment
  const slug = 'foundry-agent';
  let [deployment] = await db.select().from(agentDeployments).where(eq(agentDeployments.slug, slug)).limit(1);

  if (!deployment) {
    await db.insert(agentDeployments).values({
      organizationId: org.id,
      jobId: job.id,
      slug: slug,
      title: foundryAgentDef.name,
      description: foundryAgentDef.description,
      isActive: true,
      oceanTraits: foundryAgentDef.oceanTraits,
      createdBy: 'system'
    });
    console.log(`Created new Agent Deployment for: ${foundryAgentDef.name} (slug: ${slug})`);
  } else {
    console.log(`Agent Deployment already exists for slug '${slug}'. Updating...`);
    await db.update(agentDeployments).set({
      organizationId: org.id,
      jobId: job.id,
      title: foundryAgentDef.name,
      description: foundryAgentDef.description,
      isActive: true,
      oceanTraits: foundryAgentDef.oceanTraits,
      updatedAt: new Date()
    }).where(eq(agentDeployments.id, deployment.id));
  }

  console.log(`Ensured Foundry Agent Deployment for KUS (slug: ${slug})`);
  console.log("--- Seeding Complete ---");
  process.exit(0);
}

seedFoundryAgent().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
