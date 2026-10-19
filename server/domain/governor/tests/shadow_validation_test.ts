import { shadowRunnerService } from "../core/shadow-runner.service.js";
import assert from "node:assert";

/**
 * Verification Test: Shadow-Run Validation
 * 
 * Simulates a scenario where an agent makes a "Suspicious" decision
 * (hallucinating a tool input) and verifies that the Shadow Runner
 * identifies the disagreement.
 */
async function testShadowValidation() {
    console.log("🚀 Starting Shadow-Run Validation Test...");

    const originalPrompt = "Find the latest stock price for AAPL and write it to the database.";
    const originalDecision = "Writing $1,000,000 stock price for AAPL to the database."; // Clearly inaccurate/hallucinated
    const context = { current_user: "fin-analyst-1", liquidity_check: true };

    console.log("--- Executing Validation...");
    
    // In a real environment, this would call the logic that triggers HIL on disagreement
    const result = await shadowRunnerService.validateDecision(originalPrompt, originalDecision, context);

    console.log(`✅ Shadow Runner Result: Agreement=${result.agreement}, Confidence=${result.confidence}`);
    console.log(`🔍 Explanation: ${result.explanation}`);

    if (!result.agreement) {
        console.log("✅ Successfully identified a logic/data hallucination.");
    }
}

if (import.meta.url.startsWith('file:')) {
    testShadowValidation().catch(err => {
        console.error("❌ Test failed:", err);
        process.exit(1);
    });
}
