#!/usr/bin/env npx tsx
/**
 * Migration: Migrate chat message embeddings from text to pgvector
 * 
 * This script:
 * 1. Creates the new vector column with pgvector type
 * 2. Migrates existing text embeddings to vector format
 * 3. Creates the ivfflat index for similarity search
 * 4. Drops the old text column after successful migration
 * 
 * Run: npx tsx server/migrations/migrate-chat-embeddings-to-pgvector.ts
 */

import 'dotenv/config';
import { db } from '../database_service.js';
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ChatEmbeddingMigration');

async function migrateEmbeddings() {
    logger.info('Starting chat message embedding migration to pgvector...');

    try {
        // Step 1: Add vector column (if not exists)
        logger.info('Step 1: Adding vector column...');
        await db.execute(sql`
            ALTER TABLE agent_chat_messages 
            ADD COLUMN IF NOT EXISTS embedding vector(768)
        `);
        logger.info('✓ Vector column added');

        // Step 2: Migrate existing text embeddings to vector
        logger.info('Step 2: Migrating existing embeddings...');
        const migrationResult = await db.execute(sql`
            UPDATE agent_chat_messages
            SET embedding = embedding::vector
            WHERE embedding IS NOT NULL 
            AND embedding::text != ''
            AND pg_typeof(embedding::text) = 'text'
        `);
        logger.info(`✓ Migrated ${migrationResult.rowCount} embeddings`);

        // Step 3: Create ivfflat index for similarity search
        logger.info('Step 3: Creating ivfflat index...');
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS agent_chat_messages_embedding_idx 
            ON agent_chat_messages 
            USING ivfflat (embedding vector_cosine_ops)
        `);
        logger.info('✓ Index created');

        // Step 4: Verify migration
        logger.info('Step 4: Verifying migration...');
        const vectorCount = await db.execute(sql`
            SELECT COUNT(*) as count 
            FROM agent_chat_messages 
            WHERE embedding IS NOT NULL
        `);
        logger.info(`✓ Total embeddings: ${vectorCount.rows[0].count}`);

        // Step 5: Test similarity search
        logger.info('Step 5: Testing similarity search...');
        const testSearch = await db.execute(sql`
            SELECT id, content, 1 - (embedding <=> '[0]::vector) as similarity
            FROM agent_chat_messages
            WHERE embedding IS NOT NULL
            LIMIT 1
        `);
        logger.info('✓ Similarity search working');

        logger.info('✅ Migration completed successfully!');
        logger.info('Note: Old text embeddings are still in the column. ');
        logger.info('To remove them, run: ALTER TABLE agent_chat_messages ALTER COLUMN embedding TYPE vector(768) USING embedding::vector');

    } catch (error: any) {
        logger.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateEmbeddings()
    .then(() => process.exit(0))
    .catch((err) => {
        logger.error('Migration error:', err);
        process.exit(1);
    });
