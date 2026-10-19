
import "dotenv/config";
import { runAgentLoop } from "@domain/agents/agent-runner.js";
import { db } from "@server/database_service.js";
import { users, orgs } from "@shared/schema/index.js";
import { pendingDecisions } from "@server/routes/agent-decision.js";
import { MoltProducer } from "@domain/governor/core/molt-producer.js";
import { AIClient, AIResponse } from "@domain/ai/core/ai-client.service.js";

class MockClient implements AIClient {
    callCount = 0;

    async execute(config: any): Promise<AIResponse> {
        this.callCount++;
        console.log(`MockClient execute called (call #${this.callCount})`);

        // First call: Propose file_write
        if (this.callCount === 1) {
            const toolCall = {
                tool: "file_write",
                params: {
                    path: "test-advisory-mock.txt",
                    content: "Mocked Hello World"
                },
                confidence: 99
            };
            return {
                success: true,
                output: JSON.stringify(toolCall),
                metadata: { model: "mock", provider: "mock", latencyMs: 10 }
            };
        }

        // Second call: Final Answer (after tool execution)
        return {
            success: true,
            output: JSON.stringify({
                final_answer: "File written successfully."
            }),
            metadata: { model: "mock", provider: "mock", latencyMs: 10 }
        };
    }
}

async function main() {
    console.log("Starting Advisory Mode Test (Mocked)...");

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

    const sessionId = `test-advisory-mock-${Date.now()}`;
    const initialContext = {
        userId: user.id,
        username: user.username,
        organizationId: org.id,
        orgSlug: org.name.toLowerCase().replace(/\s+/g, '-'),
        sessionId
    };

    console.log(`Session ID: ${sessionId}`);

    // 2. Setup Agent
    const client = new MockClient();
    const apiKey = "mock-key";
    const prompt = "Please write a file.";

    console.log("Starting agent loop...");

    let agentFinished = false;
    const agentPromise = runAgentLoop(
        client,
        {
            model: "mock-model",
            temperature: 0,
            userPrompt: "",
            useCache: false,
            saveOutputToFile: false,
            isPriority: true
        },
        prompt,
        ["file_write"], // Allowed tools
        5, // maxIterations
        apiKey,
        initialContext,
        undefined, // traceContext
        false, // dryRun
        undefined, // governorConfig
        "advisory"
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
            if (client.callCount === 1) {
                console.log("It seems agent exited after first call without waiting?");
            }
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
            reason: "Automated Mock Test Approval",
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

