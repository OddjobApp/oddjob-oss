import { db } from "../server/db/index.js";
import { jobs, agentDeployments, orgs } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function provision() {
  console.log("--- Provisioning New Jobs & Agents (Fixed) ---");

  const [org] = await db.select().from(orgs).limit(1);
  if (!org) {
    console.error("No organization found.");
    process.exit(1);
  }

  const jobDefinitions = [
    {
      name: 'Security Auditor Agent',
      description: 'Finds dependencies vulnerabilities and code secrets.',
      oceanTraits: { o: 0.9, c: 0.9, e: 0.3, a: 0.5, n: 0.2 },
      config: {
        credentialId: null,
        model: 'models/gemini-1.5-pro',
        goal: 'Identify security vulnerabilities and hardcoded secrets in the codebase.',
        persona: 'analyst',
        maxIterations: 5,
        supervision: 'none'
      }
    },
    {
      name: 'Performance Engineer Agent',
      description: 'Analyzes system benchmarks and resource usage.',
      oceanTraits: { o: 0.8, c: 0.95, e: 0.4, a: 0.6, n: 0.1 },
      config: {
        credentialId: null,
        model: 'models/gemini-1.5-pro',
        goal: 'Analyze system performance benchmarks and identify resource bottlenecks.',
        persona: 'debugger',
        maxIterations: 5,
        supervision: 'none'
      }
    },
    {
      name: 'UX Researcher Agent',
      description: 'Optimizes user flows and accessibility.',
      oceanTraits: { o: 0.95, c: 0.8, e: 0.7, a: 0.9, n: 0.3 },
      config: {
        credentialId: null,
        model: 'models/gemini-1.5-pro',
        goal: 'Evaluate user interfaces for accessibility compliance and optimal user flow.',
        persona: 'researcher',
        maxIterations: 5,
        supervision: 'none'
      }
    }
  ];

  for (const def of jobDefinitions) {
    // Upsert Job
    let [job] = await db.select().from(jobs).where(eq(jobs.name, def.name)).limit(1);
    if (!job) {
      [job] = await db.insert(jobs).values({
        organizationId: org.id,
        type: 'ai_agent',
        name: def.name,
        description: def.description,
        lifecycleStatus: 'active',
        isActive: true,
        config: def.config,
        createdBy: 'system'
      }).returning();
      console.log(`Created Job: ${def.name} (${job.id})`);
    } else {
      console.log(`Job already exists: ${def.name} (${job.id}). Updating config...`);
      await db.update(jobs)
        .set({ config: def.config, updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
    }

    // Upsert Deployment
    const slug = def.name.toLowerCase().replace(/\s+/g, '-');
    await db.insert(agentDeployments).values({
      organizationId: org.id,
      jobId: job.id,
      slug: slug,
      title: def.name,
      description: def.description,
      isActive: true,
      oceanTraits: def.oceanTraits,
      createdBy: 'system'
    }).onConflictDoNothing();

    console.log(`Ensured Agent Deployment for: ${def.name} (slug: ${slug})`);
  }

  console.log("--- Provisioning Complete ---");
  process.exit(0);
}

provision().catch(err => {
  console.error("Provisioning failed:", err);
  process.exit(1);
});
