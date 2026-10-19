import "dotenv/config";
import { db } from "../server/db/index.js";
import { users, agentDeployments } from "@shared/schema/index.js";
import { eq, or } from "drizzle-orm";
import { AgentDeploymentService } from "../server/domain/agents/agent-deployment.service";
import chalk from "chalk";

async function main() {
    console.log(chalk.blue("Starting Agent Manifest Refresh..."));

    // First, verify admin user
    console.log("-> Querying admin user...");
    const adminUser = await db.query.users.findFirst({
        where: eq(users.email, 'admin@example.com')
    });
    console.log("-> Admin user query finished.");

    if (!adminUser) {
        console.error(chalk.red("Admin user 'admin@example.com' not found. Cannot proceed."));
        process.exit(1);
    }
    console.log(chalk.green(`✓ Admin user verified. ID: ${adminUser.id}`));

    const deploymentService = new AgentDeploymentService();

    console.log("-> Querying Target Agents...");
    // Find the QA Planner Agent
    const targetAgents = await db.query.agentDeployments.findMany();

    console.log(`-> Target Agents query finished. Found ${targetAgents.length} agents.`);
    for (const a of targetAgents) {
        console.log(`    - '${a.title}' (${a.slug})`);
    }

    if (targetAgents.length === 0) {
        console.warn(chalk.yellow("No 'QA Planner Agent' found to refresh."));
        process.exit(0);
    }

    // Refresh each agent found
    for (const agent of targetAgents) {
        console.log(chalk.blue(`\nRefreshing manifest for agent: ${agent.title} (Slug: ${agent.slug}, ID: ${agent.id})`));

        // Forcing an update to manifests by clearing tool_manifest, triggering a refresh on next access
        // OR we can explicitly call deploymentService.updateManifest

        // Let's directly update the database using updateManifest via the service to guarantee generation.
        // updateManifest(id, currentDeployment, updateData, userId, tx)

        try {
            const updated = await AgentDeploymentService.updateManifest(agent.id);
            console.log(chalk.green(`✓ Manifest successfully rebuilt and cached for ${agent.title}`));

            // Log output since it returns the manifest object
            if (updated) {
                console.log(chalk.dim(JSON.stringify(updated, null, 2)));
            }

        } catch (e: any) {
            console.error(chalk.red(`Failed to update manifest for ${agent.title}: ${e.message}`));
        }
    }

    console.log(chalk.green("\nDone."));
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
