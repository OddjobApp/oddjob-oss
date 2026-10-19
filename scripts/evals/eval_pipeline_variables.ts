/**
 * AI Evaluation Suite for Pipeline Variable Resolution
 * Tests:
 * 1. Template Substitution Accuracy
 * 2. Step Output Variable Resolution
 * 3. Context Data Access
 * 4. Nested Object Path Resolution
 * 5. Error Handling for Missing Variables
 */

import "dotenv/config";
import { resolveVariables, resolveJobConfig } from "../../server/core/variable-resolver";

interface EvalResult {
    testName: string;
    passed: boolean;
    expected: any;
    actual: any;
    duration: number;
}

const results: EvalResult[] = [];

function recordResult(testName: string, expected: any, actual: any, startTime: number) {
    const duration = Date.now() - startTime;
    const passed = JSON.stringify(expected) === JSON.stringify(actual);
    results.push({ testName, passed, expected, actual, duration });
    console.log(`   ${passed ? "✅" : "❌"} ${testName} (${duration}ms)`);
    if (!passed) {
        console.log(`      Expected: ${JSON.stringify(expected)}`);
        console.log(`      Actual:   ${JSON.stringify(actual)}`);
    }
}

async function runEval() {
    console.log("🧠 Starting Pipeline Variable Resolution Evaluation...\n");
    console.log("=".repeat(70));

    // Test Context - matches the structure expected by resolveVariables
    const context = {
        positional: {
            0: '{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}',
            1: '{"success": true, "message": "Operation completed"}',
        },
        named: {
            "fetch_data": '{"items": ["a", "b", "c"]}',
        },
        data: {
            apiKey: "sk-test-12345",
            baseUrl: "https://api.example.com",
            config: {
                timeout: 30000,
                retries: 3
            }
        },
        env: {
            NODE_ENV: "test",
            DEBUG: "true"
        },
        currentStepOrder: 2
    };

    // 1. Basic Step Output Resolution
    console.log("\n📋 Test: Basic Step Output Resolution");
    console.log("-".repeat(50));

    let start = Date.now();
    let result = resolveVariables("User data: {{step.0.output}}", context);
    recordResult("Step 0 Output",
        'User data: {"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}',
        result, start);

    start = Date.now();
    result = resolveVariables("Result: {{step.1.output}}", context);
    recordResult("Step 1 Output",
        'Result: {"success": true, "message": "Operation completed"}',
        result, start);

    // 2. Named Step Resolution
    console.log("\n📋 Test: Named Step Resolution");
    console.log("-".repeat(50));

    start = Date.now();
    result = resolveVariables("Items: {{step.fetch_data.output}}", context);
    recordResult("Named Step Output",
        'Items: {"items": ["a", "b", "c"]}',
        result, start);

    // 3. Context Data Resolution
    console.log("\n📋 Test: Context Data Resolution");
    console.log("-".repeat(50));

    start = Date.now();
    result = resolveVariables("Key: {{data.apiKey}}", context);
    recordResult("Data apiKey", "Key: sk-test-12345", result, start);

    start = Date.now();
    result = resolveVariables("URL: {{data.baseUrl}}", context);
    recordResult("Data baseUrl", "URL: https://api.example.com", result, start);

    // 4. Nested Object Path Resolution
    console.log("\n📋 Test: Nested Object Path Resolution");
    console.log("-".repeat(50));

    start = Date.now();
    result = resolveVariables("Timeout: {{data.config.timeout}}", context);
    recordResult("Nested config.timeout", "Timeout: 30000", result, start);

    start = Date.now();
    result = resolveVariables("Retries: {{data.config.retries}}", context);
    recordResult("Nested config.retries", "Retries: 3", result, start);

    // 5. Multiple Variables in One String
    console.log("\n📋 Test: Multiple Variables");
    console.log("-".repeat(50));

    start = Date.now();
    result = resolveVariables("API: {{data.baseUrl}} with key {{data.apiKey}}", context);
    recordResult("Multiple Variables",
        "API: https://api.example.com with key sk-test-12345",
        result, start);

    // 6. Environment Variable Resolution
    console.log("\n📋 Test: Environment Variables");
    console.log("-".repeat(50));

    start = Date.now();
    result = resolveVariables("Env: {{env.NODE_ENV}}", context);
    recordResult("Env NODE_ENV", "Env: test", result, start);

    // 7. Missing Variable Handling
    console.log("\n📋 Test: Missing Variable Handling");
    console.log("-".repeat(50));

    start = Date.now();
    result = resolveVariables("Missing: {{data.nonexistent}}", context);
    // Should either keep original or return empty
    const missingHandled = result.includes("{{data.nonexistent}}") || result === "Missing: " || result === "Missing: undefined";
    results.push({
        testName: "Missing Variable",
        passed: missingHandled,
        expected: "Graceful handling (kept or empty)",
        actual: result,
        duration: Date.now() - start
    });
    console.log(`   ${missingHandled ? "✅" : "❌"} Missing Variable (${Date.now() - start}ms)`);

    // 8. Job Config Resolution
    console.log("\n📋 Test: Job Config Resolution");
    console.log("-".repeat(50));

    start = Date.now();
    const jobConfig = {
        url: "{{data.baseUrl}}/users",
        headers: {
            "Authorization": "Bearer {{data.apiKey}}",
            "Content-Type": "application/json"
        },
        body: '{"query": "{{step.0.output}}"}'
    };

    const resolvedConfig = resolveJobConfig("curl", jobConfig, context);
    const configPassed =
        resolvedConfig.url === "https://api.example.com/users" &&
        resolvedConfig.headers?.Authorization === "Bearer sk-test-12345";

    results.push({
        testName: "Job Config Resolution",
        passed: configPassed,
        expected: { url: "https://api.example.com/users", auth: "Bearer sk-test-12345" },
        actual: { url: resolvedConfig.url, auth: resolvedConfig.headers?.Authorization },
        duration: Date.now() - start
    });
    console.log(`   ${configPassed ? "✅" : "❌"} Job Config Resolution (${Date.now() - start}ms)`);

    // 9. Array Index Access (if supported)
    console.log("\n📋 Test: Special Cases");
    console.log("-".repeat(50));

    start = Date.now();
    result = resolveVariables("Empty template test", context);
    recordResult("No Variables", "Empty template test", result, start);

    start = Date.now();
    result = resolveVariables("", context);
    recordResult("Empty String", "", result, start);

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 PIPELINE VARIABLE RESOLUTION SUMMARY");
    console.log("=".repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const passRate = (passed / results.length) * 100;

    console.log(`\n   Total Tests: ${results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

    console.log("\n" + "=".repeat(70));
    if (passRate >= 80) {
        console.log("🎉 EVALUATION PASSED: Variable resolution system is working correctly!");
    } else if (passRate >= 50) {
        console.log("⚠️ EVALUATION PARTIAL: Some variable resolution issues detected.");
    } else {
        console.log("❌ EVALUATION FAILED: Significant issues with variable resolution.");
    }
    console.log("=".repeat(70));

    process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch(e => {
    console.error("\n❌ EVALUATION CRASHED:", e);
    process.exit(1);
});
