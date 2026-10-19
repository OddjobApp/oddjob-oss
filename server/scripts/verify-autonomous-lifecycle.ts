
import "dotenv/config";
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { runAgentLoop } from "@domain/agents/agent-runner.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { MoltProducer } from "@domain/governor/core/molt-producer.js";
import { eq } from "drizzle-orm";

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function verify() {
    try {
        console.log("=== STARTING AUTONOMOUS LIFECYCLE RE-VERIFICATION ===");
        console.log("Checking environment...");

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("GEMINI_API_KEY missing from .env");
            process.exit(1);
        }

        console.log("Initializing AI Client...");
        const client = AIClientFactory.getClient({ provider: "google" } as any);
        const sessionId = `test_session_${Date.now()}`;
        const producer = new MoltProducer(sessionId);

        // 2. Setup Monitor for SIG_USER_ALERT
        const monitor = async () => {
            console.log("[Monitor] Listening for Molt Proposals...");
            const startTime = Date.now();
            while (Date.now() - startTime < 30000) {
                try {
                    const messages = await (producer as any).redis.xrange((producer as any).streamKey, '-', '+');
                    for (const [id, fields] of messages) {
                        const fieldMap = new Map();
                        for (let i = 0; i < fields.length; i += 2) fieldMap.set(fields[i], fields[i + 1]);

                        if (fieldMap.get('type') === 'PROPOSAL') {
                            const payload = JSON.parse(fieldMap.get('payload'));
                            if (payload.command.startsWith('SIG_USER_ALERT')) {
                                console.log(`[Monitor] DETECTED ALERT: ${payload.command}`);
                                console.log(`[Monitor] Approving in 2 seconds...`);
                                await new Promise(r => setTimeout(r, 2000));

                                await producer.publish('DECISION', {
                                    proposalId: id,
                                    command: payload.command,
                                    approved: true,
                                    reason: "Automated verification approval"
                                });
                                console.log("[Monitor] DECISION published.");
                                return;
                            }
                        }
                    }
                } catch (e) {
                    console.error("[Monitor] Redis Error:", e);
                }
                await new Promise(r => setTimeout(r, 500));
            }
            console.warn("[Monitor] No alert detected within 30s.");
        };

        // 3. Trigger Agent Loop
        const goal = "Write 'LIFECYCLE TEST' to a file named 'alm_test.txt' using file_write.";
        const allowedTools = ["file_write", "read_file"];

        console.log("Starting Monitor Task...");
        const monitorTask = monitor();

        console.log("Invoking runAgentLoop...");
        const result = await runAgentLoop(
            client,
            { model: "gemini-2.0-flash", temperature: 0, systemPrompt: "You are a test agent." } as any,
            goal,
            allowedTools,
            5,
            apiKey,
            { sessionId, organizationId: 1 }
        );

        console.log("=== AGENT EXECUTION COMPLETED ===");
        console.log("Final Output:", result.output);

        const verificationStep = result.history.find(h => h.content && h.content.includes("Verification Successful"));
        if (verificationStep) {
            console.log("SUCCESS: Active Verification turn detected in history!");
        } else {
            console.warn("WARNING: No explicit verification step found in history.");
        }

        await monitorTask;
        await producer.disconnect();
        console.log("Verification finished successfully.");
        process.exit(0);
    } catch (err: any) {
        console.error("FATAL ERROR in verify script:", err);
        process.exit(1);
    }
}

verify();

