
import "dotenv/config";
import { db } from "../server/db/index.js";
import { jobs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function main() {
    const ids = [41, 862, 863];
    console.log(`Inspecting system prompts for jobs: ${ids.join(', ')}`);

    const results = await db.select().from(jobs).where(inArray(jobs.id, ids));

    results.forEach(job => {
        console.log(`\n\n=== JOB ID: ${job.id} (${job.name}) ===`);
        const config = job.config as any;
        console.log(`Persona: ${config.persona || 'generic'}`);
        console.log(`System Prompt:\n${config.systemPrompt || 'NO SYSTEM PROMPT'}`);
        console.log(`Allowed Tools: ${JSON.stringify(config.allowedTools || [])}`);
        console.log(`Specialties: ${JSON.stringify(config.specialties || [])}`);
    });
}

main().catch(console.error);
