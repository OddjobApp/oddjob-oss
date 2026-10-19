
import "dotenv/config";
import { db } from "../../server/db/index.js";
import { pipelineStepExecutions, pipelineExecutions } from "@shared/schema";
import { generateExternalToken } from "@domain/core/auth/jwt.service.js";
import { eq, desc } from "drizzle-orm";

const API_URL = "http://127.0.0.1:5000/api";
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("JWT_SECRET env var required");
    process.exit(1);
}

async function run() {
    try {
        console.log("Starting Verification...");

        // 1. Authentication
        console.log("Registering user...");
        const username = "testuser_" + Date.now();
        const password = "TestPass123!";
        const email = `test_${Date.now()}@example.com`;
        const authRes = await fetch(`${API_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, email })
        });

        if (!authRes.ok) {
            throw new Error(`Auth failed: ${await authRes.text()}`);
        }

        const cookie = authRes.headers.get("set-cookie");
        if (!cookie) throw new Error("No cookie received");


        let csrfToken = "";

        const send = async (path: string, method: string, body?: any) => {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "Cookie": cookie
            };
            if (csrfToken && method !== "GET") {
                headers["x-csrf-token"] = csrfToken;
            }

            const res = await fetch(`${API_URL}${path}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });

            if (!res.ok) throw new Error(`Request to ${path} failed: ${res.status} ${await res.text()}`);
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                return res.json();
            }
            return res.text();
        };

        // 1.5 Fetch CSRF Token
        console.log("Fetching CSRF Token...");
        const userRes = await send("/user", "GET");
        if (userRes.csrfToken) {
            csrfToken = userRes.csrfToken;
            console.log("CSRF Token obtained");
        } else {
            throw new Error("Failed to obtain CSRF token");
        }

        // 2. Create Form
        console.log("Creating Form...");
        const form = await send("/forms", "POST", {
            name: "Test Form " + Date.now(),
            description: "HIL Verification Form",
            schema: { fields: [{ id: "approved", type: "boolean", label: "Approve?" }] }
        });
        console.log("Form created:", form.id);

        // 3. Create Job
        console.log("Creating Job...");
        const job = await send("/jobs", "POST", {
            name: "HIL Job " + Date.now(),
            type: "human_approval",
            config: { formId: form.id }
        });
        console.log("Job created:", job.id);

        // 4. Create Pipeline
        console.log("Creating Pipeline...");
        const pipeline = await send("/pipelines", "POST", {
            name: "HIL Pipeline " + Date.now(),
            description: "Auto-test pipeline",
            triggerType: "Manual",
            createdBy: "system",
            steps: [{ jobId: job.id, order: 1 }]
        });
        console.log("Pipeline created:", pipeline.id);

        // 5. Execute
        console.log("Executing Pipeline...");
        const execution = await send(`/pipelines/${pipeline.id}/execute`, "POST");
        console.log("Execution started:", execution.executionId);

        // 6. Poll for Waiting
        console.log("Waiting for step to pause...");
        let stepExecutionId = 0;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 1000));

            // Direct DB query to find the step execution
            const [step] = await db
                .select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, execution.executionId))
                .limit(1);

            if (step && step.status === "waiting_external_input") {
                console.log("Step is waiting! ID:", step.id);
                stepExecutionId = step.id;
                break;
            }
        }

        if (!stepExecutionId) {
            throw new Error("Timeout waiting for step to pause");
        }

        // 7. Generate Token
        console.log("Generating Token...");
        const token = generateExternalToken({
            executionId: stepExecutionId.toString(),
            formId: form.id,
            email: "test@example.com",
            role: "external"
        });

        // 7.5 Verify Context Availability
        // Perform GET to /api/external/task to ensure context is passed
        console.log("Verifying Context Availability...");
        // external/task needs the token in query param
        const taskDetails = await send(`/external/task?token=${token}`, "GET");
        console.log("Full Task Details Response:", JSON.stringify(taskDetails, null, 2));

        if (!taskDetails.context) {
            throw new Error("Context data missing from external task details");
        }
        console.log("Context found in task details:", Object.keys(taskDetails.context));

        // 8. Submit Response
        console.log("Submitting Response...");
        // Note: Submit endpoint does NOT require auth cookie, just token
        const submitRes = await fetch(`${API_URL}/external/task/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token,
                responses: { approved: true }
            })
        });

        if (!submitRes.ok) {
            throw new Error(`Submit failed: ${await submitRes.text()}`);
        }
        console.log("Submission successful");

        // 9. Verify Completion
        console.log("Verifying completion...");
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 1000));

            const [pipelineExec] = await db
                .select()
                .from(pipelineExecutions)
                .where(eq(pipelineExecutions.id, execution.executionId))
                .limit(1);

            if (pipelineExec.status === "completed") {
                console.log("Pipeline completed successfully!");

                // Verify HIL Step Output contains form responses
                const [finalStep] = await db
                    .select()
                    .from(pipelineStepExecutions)
                    .where(eq(pipelineStepExecutions.id, stepExecutionId))
                    .limit(1);

                console.log("Final Step Output:", finalStep.output);
                const output = JSON.parse(finalStep.output || "{}");
                if (output.approved !== true) {
                    throw new Error(`HIL Step output mismatch. Expected { approved: true }, got ${finalStep.output}`);
                }
                console.log("HIL Step Output verified: Form responses are saved as step output.");

                process.exit(0);
            }
            if (pipelineExec.status === "failed") {
                throw new Error(`Pipeline failed: ${pipelineExec.error}`);
            }
        }

        throw new Error("Timeout waiting for pipeline completion");

    } catch (error) {
        console.error("Test Failed:", error);
        process.exit(1);
    }
}

run();
