
import "dotenv/config";
import { db } from "@server/database_service.js";
import { jobs, governorPolicies, governorPolicyRules, users } from "@shared/schema/index.js";
import { governorResolver, governorService } from "@domain/governor/index.js";
import { eq } from "drizzle-orm";

async function verifyGovernance() {
    console.log("Starting Governance Verification...");

    // 1. Setup Test Data
    const policyName = "Verification Policy " + Date.now();
    const [policy] = await db.insert(governorPolicies).values({
        name: policyName,
        description: "Test policy for verification script"
    }).returning();

    console.log(`Created Policy: ${policy.name} (${policy.id})`);

    // 2. Add Rules
    await db.insert(governorPolicyRules).values([
        {
            policyId: policy.id,
            type: "tool_deny",
            configuration: { tools: ["delete_file"] },
            isEnabled: true
        },
        {
            policyId: policy.id,
            type: "pii_redaction",
            configuration: { patterns: [{ name: "SSN", regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b" }] }, // SSN Regex
            isEnabled: true
        }
    ]);
    console.log("Added Rules: tool_deny (delete_file), pii_redaction (SSN)");

    // 3. Assign Policy to a Mock Job Setup
    const [user] = await db.select().from(users).limit(1);
    if (!user) throw new Error("No user found for test context");

    const [job] = await db.insert(jobs).values({
        name: "Governance Test Job",
        type: "ai_agent",
        config: {},
        organizationId: 1, // Assumptions
        governorPolicyId: policy.id,
        createdBy: user.id
    }).returning();

    console.log(`Created Test Job: ${job.id} linked to Policy ${policy.id}`);

    try {
        // 4. Test Resolver
        console.log("\n--- Testing Resolution ---");
        const resolved = await governorResolver.resolveGovernance({ jobId: job.id });
        console.log(`Resolved Mode: ${resolved.mode}`);
        console.log(`Resolved Source: ${resolved.source}`);
        console.log(`Rule Count: ${resolved.rules?.length}`);

        if (resolved.mode !== "ADVISORY") throw new Error("Mode resolution mismatch");
        if (resolved.rules?.length !== 2) throw new Error("Rule count mismatch");

        // 5. Test Tool Validation
        console.log("\n--- Testing Tool Validation ---");
        try {
            governorService.validateToolAccess("read_file", resolved.rules || []);
            console.log("PASS: allowed tool 'read_file'");
        } catch (e) {
            console.error("FAIL: 'read_file' should be allowed", e);
        }

        try {
            governorService.validateToolAccess("delete_file", resolved.rules || []);
            console.error("FAIL: 'delete_file' should have been blocked");
        } catch (e: any) {
            console.log(`PASS: blocked tool 'delete_file' (${e.message})`);
        }

        // 6. Test PII Redaction
        console.log("\n--- Testing PII Redaction ---");
        const input = "My SSN is 123-45-6789, please keep it secret.";
        const redacted = governorService.redactSensitiveData(input, resolved.rules || []);
        console.log(`Original: ${input}`);
        console.log(`Redacted: ${redacted}`);

        if (redacted.includes("123-45-6789")) throw new Error("PII was not redacted!");
        if (!redacted.includes("[REDACTED-SSN]")) throw new Error(`Redaction replacement incorrect! Got: ${redacted}`);

        console.log("PASS: PII Redaction successful");

    } catch (err: any) {
        console.error("Verification FAILED:", err);
    } finally {
        // Cleanup
        console.log("\n--- Cleanup ---");
        await db.delete(jobs).where(eq(jobs.id, job.id));
        await db.delete(governorPolicyRules).where(eq(governorPolicyRules.policyId, policy.id));
        await db.delete(governorPolicies).where(eq(governorPolicies.id, policy.id));
        console.log("Cleanup complete.");
        process.exit(0);
    }
}

verifyGovernance();

