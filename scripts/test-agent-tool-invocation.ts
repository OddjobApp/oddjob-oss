
import { db } from "../server/db/index.js";
import { jobs, agentDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { JobToToolMapper } from "../server/domain/tools/v1/job-to-tool-mapper.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

async function testInvocation() {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error("No API key found (GEMINI_API_KEY or GOOGLE_API_KEY).");
        process.exit(1);
    }

    console.log("--- Testing AI Agent Tool Invocation ---");
    
    const orgId = 1;
    const agentSlug = "agent-81";

    // 1. Get the dispatcher job
    const [dispatcherJob] = await db.select().from(jobs).where(eq(jobs.type, 'dispatcher')).limit(1);
    if (!dispatcherJob) {
        console.error("Dispatcher job not found.");
        process.exit(1);
    }

    // 2. Get the agent
    const [agent] = await db.select().from(agentDeployments).where(eq(agentDeployments.slug, agentSlug)).limit(1);
    if (!agent) {
        console.error("Agent agent-81 not found.");
        process.exit(1);
    }

    // 3. Setup tools
    const tool = JobToToolMapper.mapJobToTool(dispatcherJob);
    console.log(`Mapped Tool: ${tool.name}`);

    // 4. Initialize AI
    const client = AIClientFactory.getClient({ provider: "google" } as any);
    const { runAgentLoop } = await import("../server/domain/agents/agent-runner.js");

    const message = "I need a tow truck at 500 Broadway, New York. My car won't start.";
    console.log(`User Message: "${message}"`);

    const config = {
        model: "gemini-2.0-flash",
        temperature: 0.1,
        maxTokens: 1000
    };

    try {
        const result = await runAgentLoop(
            client,
            config as any,
            message,
            [tool.name],
            3, // max iterations
            apiKey,
            {
                sessionId: "test-session-" + Date.now(),
                organizationId: orgId,
                jobId: agent.jobId,
                previousHistory: []
            }
        );
        console.log("SUCCESS: Agent finished loop.");
        console.log("Response:", result.output);
    } catch (err: any) {
        console.error("FAILURE: Agent loop failed.");
        console.error(err.message || err);
        process.exit(1);
    }

    process.exit(0);
}

testInvocation().catch(err => {
    console.error(err);
    process.exit(1);
});
