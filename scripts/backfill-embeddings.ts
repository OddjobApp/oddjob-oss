/**
 * Backfill Embeddings Script
 * Generates embeddings for existing positive-rated agent messages that don't have embeddings yet.
 * 
 * Usage: npx tsx scripts/backfill-embeddings.ts [--limit N] [--dry-run]
 */

import 'dotenv/config';
import { db } from "../server/db/index.js";
import { agentChatMessages, credentials } from '@shared/schema/index.js';
import { eq, and, isNull, desc } from 'drizzle-orm';

const EMBEDDING_MODEL = 'text-embedding-ada-002';
const RATE_LIMIT_MS = 200; // 5 calls per second max
const DEFAULT_LIMIT = 100;

async function getOpenAIKey(): Promise<string | null> {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

    const [cred] = await db.select()
        .from(credentials)
        .where(eq(credentials.type, 'openai'))
        .limit(1);

    if (!cred) return null;
    return process.env[cred.envVarName] || null;
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
    try {
        const normalizedText = text.substring(0, 8000).replace(/\s+/g, ' ').trim();

        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: normalizedText,
            }),
        });

        if (!response.ok) {
            console.error(`API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        return data.data?.[0]?.embedding || null;
    } catch (e) {
        console.error('Embedding generation failed:', e);
        return null;
    }
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || DEFAULT_LIMIT : DEFAULT_LIMIT;

    console.log(`\n=== Backfill Embeddings ===`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Limit: ${limit} messages\n`);

    // Get API key
    const apiKey = await getOpenAIKey();
    if (!apiKey) {
        console.error('ERROR: No OpenAI API key found. Add an openai credential.');
        process.exit(1);
    }

    // Find messages needing embeddings
    const messages = await db.select({
        id: agentChatMessages.id,
        content: agentChatMessages.content,
        jobId: agentChatMessages.jobId,
    })
        .from(agentChatMessages)
        .where(and(
            eq(agentChatMessages.role, 'agent'),
            eq(agentChatMessages.rating, 1),
            isNull(agentChatMessages.embedding)
        ))
        .orderBy(desc(agentChatMessages.createdAt))
        .limit(limit);

    console.log(`Found ${messages.length} messages without embeddings.\n`);

    if (messages.length === 0) {
        console.log('Nothing to do. Exiting.');
        process.exit(0);
    }

    let success = 0;
    let failed = 0;

    for (const msg of messages) {
        process.stdout.write(`[${success + failed + 1}/${messages.length}] Message ${msg.id}... `);

        if (dryRun) {
            console.log('SKIP (dry run)');
            success++;
            continue;
        }

        const embedding = await generateEmbedding(msg.content, apiKey);

        if (embedding) {
            await db.update(agentChatMessages)
                // Column stores a JSON-encoded array (readers JSON.parse it); serialize
                // rather than passing the raw number[], which pg writes as a non-JSON literal.
                .set({ embedding: JSON.stringify(embedding) })
                .where(eq(agentChatMessages.id, msg.id));
            console.log('OK');
            success++;
        } else {
            console.log('FAILED');
            failed++;
        }

        // Rate limiting
        await sleep(RATE_LIMIT_MS);
    }

    console.log(`\n=== Complete ===`);
    console.log(`Success: ${success}`);
    console.log(`Failed: ${failed}`);
}

main().catch(console.error);
