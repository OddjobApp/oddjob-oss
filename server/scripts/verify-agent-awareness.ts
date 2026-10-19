
import 'dotenv/config';
import { handleGetPipelineDetails } from "../mcp/handlers.js";
import { db } from "../database_service.js";
import { jobs, pipelineSteps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function verifyPipelineDetails() {
    console.log("--- Verifying Agent Awareness (get_pipeline_details) ---");

    // We know Pipeline 2 has Job 24 (Static Response) as step 0.
    // Job 24 requires "VIN".

    const resultStr = await handleGetPipelineDetails({ pipelineId: 2 }, { organizationId: 1 } as any);
    console.log("Result (raw string):", resultStr);

    try {
        // extractMcpText returns JSON string if it's an object, or just text.
        // handleGetPipelineDetails returns successResponse which is { content: [ { type: 'text', text: JSON_STRING } ] }
        // Wait, handleGetPipelineDetails calls successResponse which formats for MCP.
        // Let's see what successResponse does. It seems to wrap in { content: ... }
        // BUT extraction happens in agent-tools.ts, not handlers.ts. 
        // handlers.ts returns the MCP result object.

        const result = (typeof resultStr === 'string') ? JSON.parse(resultStr) : resultStr;
        // Let's check handlers.ts signature. It returns `Promise<any>`.
        // successResponse returns things like { content: [...], isError: false }

        console.log("Result content:", JSON.stringify(result, null, 2));

        const textContent = result.content[0].text;
        const responseJson = JSON.parse(textContent);
        const pipelineData = responseJson.data;

        console.log("\nPipeline Data:", JSON.stringify(pipelineData, null, 2));
        console.log("Required Inputs Found:", pipelineData.requiredInputs);

        if (pipelineData.requiredInputs && (pipelineData.requiredInputs.includes("VIN") || pipelineData.requiredInputs.includes("{{VIN}}"))) {
            console.log("\nSUCCESS: 'VIN' found in requiredInputs!");
        } else {
            console.error("\nFAILURE: 'VIN' NOT found in requiredInputs.");
            process.exit(1);
        }

    } catch (e) {
        console.error("Error parsing result:", e);
        // If resultStr is the direct object (not string), print it
        console.log("Result object:", resultStr);
    }
}

verifyPipelineDetails().catch(console.error).finally(() => process.exit(0));

