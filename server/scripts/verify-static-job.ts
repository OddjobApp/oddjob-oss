
import { StaticExecutor } from "../domain/jobs/core/executors/static-executor.js";
import { Job, Pipeline } from "@shared/schema/index.js";

async function testStaticExecutor() {
    const executor = new StaticExecutor();

    const mockJob: Partial<Job> = {
        id: 1,
        type: "static_response",
        name: "Test Static Job"
    };

    const mockPipeline: Partial<Pipeline> = {
        id: 1,
        name: "Test Pipeline"
    };

    console.log("--- Test 1: Simple content ---");
    const result1 = await executor.execute(
        mockJob as Job,
        { content: "Hello World", requiredVariables: [] },
        mockPipeline as Pipeline,
        { data: {}, named: {}, positional: {} } as any
    );
    console.log("Result:", result1);

    console.log("\n--- Test 2: Missing required variable ---");
    const result2 = await executor.execute(
        mockJob as Job,
        { content: "Hello {{name}}", requiredVariables: ["name"] },
        mockPipeline as Pipeline,
        { data: {}, named: {}, positional: {} } as any
    );
    console.log("Result:", result2);

    console.log("\n--- Test 3: Existing required variable ---");
    const result3 = await executor.execute(
        mockJob as Job,
        { content: "Hello {{name}}", requiredVariables: ["name"] },
        mockPipeline as Pipeline,
        { data: { name: "Antigravity" }, named: {}, positional: {} } as any
    );
    console.log("Result:", result3);

    console.log("\n--- Test 4: Nested required variable ---");
    const result4 = await executor.execute(
        mockJob as Job,
        { content: "Ticket ID: {{ticket.id}}", requiredVariables: ["ticket.id"] },
        mockPipeline as Pipeline,
        { data: { ticket: { id: 123 } }, named: {}, positional: {} } as any
    );
    console.log("Result:", result4);

    console.log("\n--- Test 5: Missing nested required variable ---");
    const result5 = await executor.execute(
        mockJob as Job,
        { content: "Ticket ID: {{ticket.id}}", requiredVariables: ["ticket.id"] },
        mockPipeline as Pipeline,
        { data: { ticket: {} }, named: {}, positional: {} } as any
    );
    console.log("Result:", result5);

    console.log("\n--- Test 6: Output Mapping with variables ---");
    // Simulate variable resolver logic: we need to pass a context where variable resolution normally happens in variable-resolver.ts
    // The executor receives *already resolved* config if it was handled in variable-resolver.ts
    // But our manual test calls executor directly with a config object. 
    // In strict integration, resolveJobConfig() is called BEFORE executor.execute().
    // So we need to mimic that or just test that the executor packs the variables correctly.
    // Let's assume resolveJobConfig (which we updated) does its job and passes resolved string values.
    const result6 = await executor.execute(
        mockJob as Job,
        {
            content: "Original Content",
            requiredVariables: [],
            outputMapping: {
                "user_status": "active",
                "custom_id": "cust_123" // Resolved value
            }
        },
        mockPipeline as Pipeline,
        { data: {}, named: {}, positional: {} } as any
    );
    console.log("Result:", result6);
}

testStaticExecutor().catch(console.error);

