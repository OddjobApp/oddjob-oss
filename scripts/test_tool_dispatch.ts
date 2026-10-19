
import { handleToolCall } from "../server/mcp/handlers.js";

async function test() {
    console.log("Testing handleToolCall with 'execute_python'...");
    const result = await handleToolCall("execute_python", { code: "print('Hello from Python test')" }, { organizationId: 1 } as any);
    console.log("Result:", JSON.stringify(result, null, 2));
    process.exit(0);
}

test().catch(console.error);
