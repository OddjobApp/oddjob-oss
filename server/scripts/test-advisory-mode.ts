
import "dotenv/config";
import { runAgentLoop } from "@domain/agents/agent-runner.js";
import { db } from "@server/database_service.js";
import { users, orgs } from "@shared/schema/index.js";
import { pendingDecisions } from "@server/routes/agent-decision.js";
import { MoltProducer } from "@domain/governor/core/molt-producer.js";
import { GoogleClient } from "@domain/ai/core/providers/google-client.js";

async function main() {
    console.log("Starting Advisory Mode Test...");

    // 1. Setup Context
    const [user] = await db.select().from(users).limit(1);
    if (!user) {
        console.error("No user found");
        process.exit(1);
    }
    const [org] = await db.select().from(orgs).limit(1);
    if (!org) {
        console.error("No org found");
        process.exit(1);
    }

    const sessionId = `test-advisory-${Date.now()}`;
    const initialContext = {
        userId: user.id, // Agent runner uses userId, not user object
        username: user.username,
        organizationId: org.id,
        orgSlug: org.name.toLowerCase().replace(/\s+/g, '-'),
        sessionId
    };

    console.log(`Session ID: ${sessionId}`);

    // 2. Setup Agent
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY not found in environment");
        process.exit(1);
    }

    // Mock AI Client or use real one? 
    // Using real one requires hitting the API which costs money and takes time.
    // For this test, we want to test the ADVISORY mechanism (pausing).
    // The pausing happens BEFORE tool execution.
    // So we need the agent to propose a tool call.
    // This requires the AI to actually run.

    const client = new GoogleClient();

    const prompt = "Please write a file named 'test-advisory.txt' with content 'Hello World'.";

    console.log("Starting agent loop...");

    let agentFinished = false;
    const agentPromise = runAgentLoop(
        client,
        {
            model: "gemini-2.0-flash-001",
            isPriority: false,
            temperature: 0.7,
            userPrompt: "",
            useCache: false,
            saveOutputToFile: false
        }, // Full config
        prompt,
        ["file_write"], // Allowed tools. file_write is high risk.
        5, // maxIterations
        apiKey,
        initialContext,
        undefined, // traceContext
        false, // dryRun
        undefined, // governorConfig
        "advisory" // supervisionLevel matches "advisory"
    );

    agentPromise.then((res) => {
        console.log("Agent finished execution.");
        agentFinished = true;
    }).catch(err => {
        console.error("Agent execution failed:", err);
        agentFinished = true;
    });

    console.log("Agent started. Waiting for decision request...");

    // 3. Poll for Pending Decision
    let decisionFound = null;
    for (let i = 0; i < 30; i++) { // Wait up to 30 seconds
        await new Promise(r => setTimeout(r, 1000));

        // Check map
        const pending = pendingDecisions.get(sessionId);
        if (pending) {
            console.log("PENDING DECISION FOUND:");
            console.log(JSON.stringify(pending, null, 2));
            decisionFound = pending;
            break;
        }

        if (agentFinished) {
            console.log("Agent finished before decision was requested.");
            break;
        }
        console.log("Waiting for decision...");
    }

    if (!decisionFound) {
        console.error("Test Failed: No pending decision found within timeout.");
        process.exit(1);
    }

    // 4. Approve Decision
    console.log("Approving decision via MoltProducer...");
    const producer = new MoltProducer(sessionId);
    try {
        await producer.publish("DECISION", {
            approved: true,
            reason: "Automated Test Approval",
            proposalId: decisionFound.proposalId,
            timestamp: Date.now(),
            user: "test-user"
        });
        console.log("Decision published.");
    } catch (err) {
        console.error("Failed to publish decision:", err);
    } finally {
        await producer.disconnect();
    }

    // 5. Wait for Agent to Finish
    console.log("Waiting for agent to resume and finish...");
    for (let i = 0; i < 30; i++) {
        if (agentFinished) break;
        await new Promise(r => setTimeout(r, 1000));
    }

    if (agentFinished) {
        console.log("Test Passed: Agent resumed and finished.");
        process.exit(0);
    } else {
        console.error("Test Failed: Agent did not finish in time.");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
});

