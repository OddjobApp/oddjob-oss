
import 'dotenv/config';
import { agentService } from "@domain/agents/agent.service.js";
import { db } from "../server/db/index.js";
import { agentChatMessages } from '@shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
    console.log('\n🔍 PROOF OF LEARNING: Starting End-to-End Verification\n');

    const jobId = 99999; // Dummy Job
    const userId = 'proof-user';
    const TEST_QUESTION = `What is the capital of planet X99-${Date.now()}?`; // Unique question
    const BAD_ANSWER = "I don't know the capital of planet X99.";
    const GOOD_ANSWER = "The capital of planet X99 is Zorgville.";

    try {
        // 1. Initial Ask (Should allow unknown or hallucinate)
        console.log(`1️⃣  Asking initial question: "${TEST_QUESTION}"`);
        // Mock context
        const context = { jobId };
        const userContext = { userId, organizationId: 1, isAdmin: true, isSuperAdmin: false, isOrgAdmin: true };

        // We expect this to NOT have the answer yet
        const response1 = await agentService.chat({
            message: TEST_QUESTION,
            context,
            userContext
        }) as any;
        console.log(`   Agent Response 1: ${response1.response}\n`);

        // 2. Simulate "Improve Response" (User corrects it)
        console.log(`2️⃣  Simulating "Improve Response"...`);
        console.log(`   User corrects to: "${GOOD_ANSWER}"`);

        // Save the corrected message manually (simulating the /regenerate endpoint logic)
        // We insert a NEW message with rating=1 and NO EMBEDDING (simulating 429 bug state)
        await db.insert(agentChatMessages).values({
            jobId,
            userId,
            role: 'agent',
            content: GOOD_ANSWER,
            rating: 1, // Marked as Good
            metadata: { triggerPrompt: TEST_QUESTION }, // The prompt that triggered it
            embedding: null // NO EMBEDDING to prove Keyword Fallback works
        });
        console.log(`   ✅ Correction saved to DB (Embeddings: NULL)\n`);

        // 3. Ask Again (Should learn!)
        console.log(`3️⃣  Asking SAME question again: "${TEST_QUESTION}"`);
        const response2 = await agentService.chat({
            message: TEST_QUESTION,
            context,
            userContext
        }) as any;
        console.log(`   Agent Response 2: ${response2.response}\n`);

        // 4. Verify
        if (response2.response.includes("Zorgville")) {
            console.log(`🎉 SUCCESS! The agent learned "Zorgville" via Keyword Fallback.`);
        } else {
            console.error(`❌ FAILURE: Agent did not learn. Response was: ${response2.response}`);
            process.exit(1);
        }

    } catch (e) {
        console.error('Test crashed:', e);
        process.exit(1);
    }
}

main().catch(console.error);
