
import "dotenv/config";
import { db } from "@server/database_service.js";
import { pipelines, pipelineSteps, jobs, pipelineExecutions, pipelineStepExecutions, approvalRequests } from "@shared/schema/index.js";
import { desc, eq } from "drizzle-orm";
import { PipelineExecutor } from "@server/core/pipeline-executor.js";
import { validateExternalToken } from "@domain/core/auth/jwt.service.js";

const pipelineExecutor = new PipelineExecutor();

async function verifyHilTriage() {
    console.log("🔍 Starting HIL Triage (Edit & Approve) Verification...");

    const TEST_ORG_ID = 1;
    const TEST_USER = "hil-tester";

    // 1. Create a Human Approval Job
    console.log("🛠️ Creating Human Approval Job...");
    let [approvalJob] = await db.insert(jobs).values({
        name: "HIL Triage Job",
        type: "human_approval",
        organizationId: TEST_ORG_ID,
        config: {
            formId: 1, // Assumes form 1 exists, or we mock it
            approvers: [{ type: "external", email: "tester@example.com" }]
        },
        createdBy: TEST_USER,
        outputSchema: {}
    }).returning();

    // 2. Create a Pipeline
    console.log("🛠️ Creating Pipeline...");
    const [pipeline] = await db.insert(pipelines).values({
        name: "HIL Triage Verification Pipeline",
        organizationId: TEST_ORG_ID,
        isActive: true,
        triggerType: "manual",
        createdBy: TEST_USER
    }).returning();

    // 3. Add Step
    console.log("🛠️ Adding Approval Step...");
    const [step] = await db.insert(pipelineSteps).values({
        pipelineId: pipeline.id,
        jobId: approvalJob.id,
        order: 0
    }).returning();

    // 4. Start Execution (Mocking previous output injection via initialVariables)
    console.log("🚀 Starting Pipeline Execution...");
    const initialPayload = { content: "Original Content" };

    // We can't easily wait for suspension in this script without polling or hooking.
    // So we'll start it, then wait a bit, then check DB.

    const execResult = await pipelineExecutor.executePipeline(
        pipeline.id,
        TEST_USER,
        undefined,
        undefined,
        { initialData: initialPayload }
    );

    if (!execResult.executionId) throw new Error("Failed to start pipeline");
    console.log(`✅ Execution started: ${execResult.executionId}`);

    // 5. Wait for Suspension (Polling)
    console.log("⏳ Waiting for pipeline to suspend at approval step...");
    let stepExec;
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));

        [stepExec] = await db.select().from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, execResult.executionId))
            .orderBy(desc(pipelineStepExecutions.id))
            .limit(1);

        if (stepExec && stepExec.status === 'waiting_external_input') {
            break;
        }
    }

    if (!stepExec || stepExec.status !== 'waiting_external_input') {
        throw new Error(`Pipeline did not suspend as expected. Status: ${stepExec?.status}`);
    }
    console.log(`✅ Pipeline suspended at step execution ${stepExec.id}`);

    // 6. Find the Approval Request
    const [request] = await db.select().from(approvalRequests)
        .where(eq(approvalRequests.executionId, String(stepExec.id))) // executionId in requests is stringified stepExecId? Yes per executor.
        .limit(1);

    if (!request) throw new Error("Approval request not created");
    console.log(`✅ Found Approval Request ID: ${request.id}`);

    // 7. Simulate Edit & Approve via API Logic (We'll call the service logic directly/mocked to avoid full HTTP setup here)
    // Actually, let's call the API handler logic simulation since we can't easily fetch via HTTP in this script without app instance.
    // better: Use the externalService directly as the API would.

    console.log("✍️ Simulating 'Edit & Approve'...");

    const MODIFIED_PAYLOAD = { content: "Modified content by Human" };

    const { externalService } = await import("@domain/integrations/core/external.service.js");

    // The API calls externalService.submitForm
    const responses = {
        approved: true,
        comments: "Editing for correctness",
        submittedBy: "tester@example.com",
        policyDecision: "approved",
        modifiedOutput: MODIFIED_PAYLOAD // <--- THIS is what we are testing
    };

    // Need payload for submitForm (normally from token)
    const payloadMock = {
        executionId: String(stepExec.id),
        formId: 1, // Dummy
        email: "tester@example.com"
    };

    await externalService.submitForm(payloadMock, responses);
    console.log("✅ Form submitted with modifications.");

    // 8. Verify Step Output Updated
    const [updatedStep] = await db.select().from(pipelineStepExecutions)
        .where(eq(pipelineStepExecutions.id, stepExec.id))
        .limit(1);

    console.log(`🔎 Updated Step Output: ${updatedStep?.output}`);

    const outputJson = JSON.parse(updatedStep!.output || "{}");

    if (outputJson.content === "Modified content by Human") {
        console.log("✅ SUCCESS: Step output matches modified payload!");
    } else {
        console.error("❌ FAILURE: Step output does not match modification.");
        console.error("Expected:", MODIFIED_PAYLOAD);
        console.error("Actual:", outputJson);
    }

    // Capture Verification in Artifact?
}

verifyHilTriage().catch(console.error).finally(() => process.exit(0));

