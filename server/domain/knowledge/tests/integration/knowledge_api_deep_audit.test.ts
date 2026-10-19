// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from '@server/index.js';
import { db } from '@server/database_service.js';
import { orgs, users, adminRoles, userOrgs } from '@shared/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import pkg from 'pg';
const { Pool } = pkg;
import { passwordService } from '@server/domain/auth/core/password-service.js';
import { requireTestDatabaseUrl } from '../../../../../tests/configure-test-environment.js';

describe('Knowledge / Garden Pod Deep Functional Audit', () => {
    // Increase timeout for slow dev environments
    const TIMEOUT = 30000;

    let authToken: string;
    let csrfToken: string;
    let cookie: string;
    let testOrgId: number;

    const testUser = {
        email: `audit.knowledge.${Date.now()}@example.com`,
        password: 'Password123!',
        username: `knowledge_auditor_${Date.now()}`
    };

    beforeAll(async () => {
        // Wait for server to be fully initialized with all routes registered
        await serverReady;

        // --- DATABASE SCHEMA PATCHING ---
        // Ensure all required knowledge tables and columns exist in the test environment
        // This block runs CREATE TABLE / ALTER TABLE. The previous fallback pointed at
        // a database literally named 'oddjob', so an unset DATABASE_URL would have
        // applied schema changes to a real development database. Fail loudly instead.
        const connectionString = requireTestDatabaseUrl();
        const pool = new Pool({ connectionString });

        // 1. knowledge_topics
        await pool.query(`
            CREATE TABLE IF NOT EXISTS knowledge_topics (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                parent_topic_id INTEGER,
                organization_id INTEGER,
                mission_id INTEGER,
                created_by TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
            )
        `);

        // 2. knowledge_documents
        await pool.query(`
            CREATE TABLE IF NOT EXISTS knowledge_documents (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                summary TEXT,
                source_type TEXT DEFAULT 'upload' NOT NULL,
                content_type TEXT,
                file_size INTEGER,
                file_data TEXT,
                url TEXT,
                text_content TEXT,
                metadata JSONB,
                external_id TEXT,
                organization_id INTEGER,
                mission_id INTEGER,
                dataset_item_id INTEGER,
                integration_id INTEGER,
                created_by TEXT,
                qdrant_point_id TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
            )
        `);

        // 3. knowledge_topic_documents
        await pool.query(`
            CREATE TABLE IF NOT EXISTS knowledge_topic_documents (
                topic_id INTEGER NOT NULL,
                document_id INTEGER NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                PRIMARY KEY (topic_id, document_id)
            )
        `);

        // 4. knowledge_nodes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS knowledge_nodes (
                id SERIAL PRIMARY KEY,
                label TEXT NOT NULL,
                name TEXT NOT NULL,
                external_id TEXT,
                data JSONB DEFAULT '{}'::jsonb,
                knowledge_document_id INTEGER,
                knowledge_topic_id INTEGER,
                pipeline_execution_id INTEGER,
                extraction_sources JSONB DEFAULT '[]'::jsonb,
                fingerprint TEXT,
                verification_status TEXT DEFAULT 'verified' NOT NULL,
                confidence_score DECIMAL(3,2),
                initial_confidence_score DECIMAL(3,2),
                verified_by TEXT,
                verified_at TIMESTAMP WITH TIME ZONE,
                last_reaffirmed_at TIMESTAMP WITH TIME ZONE,
                usage_count INTEGER DEFAULT 0 NOT NULL,
                utility_score DECIMAL(5,2) DEFAULT 1.00,
                mission_id INTEGER,
                organization_id INTEGER,
                prospect_property_id INTEGER,
                created_by TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // 5. knowledge_edges
        await pool.query(`
            CREATE TABLE IF NOT EXISTS knowledge_edges (
                id SERIAL PRIMARY KEY,
                source_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                relation TEXT NOT NULL,
                weight INTEGER DEFAULT 1,
                data JSONB DEFAULT '{}'::jsonb,
                organization_id INTEGER,
                prospect_property_id INTEGER,
                created_by TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                mission_id INTEGER,
                last_updated_by_run_id INTEGER
            )
        `);

        // 6. graph_schema_defs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS graph_schema_defs (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                organization_id INTEGER,
                mission_id INTEGER,
                mappings JSONB DEFAULT '[]'::jsonb NOT NULL,
                entity_types JSONB DEFAULT '{}'::jsonb NOT NULL,
                relationship_types JSONB DEFAULT '{}'::jsonb NOT NULL,
                is_active BOOLEAN DEFAULT TRUE NOT NULL,
                created_by TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
            )
        `);

        // Patch missing columns in knowledge_nodes (e.g. if extraction_sources is missing)
        const nodeCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'knowledge_nodes'");
        const nodeColNames = nodeCols.rows.map((r: any) => r.column_name);
        if (!nodeColNames.includes('extraction_sources')) {
            await pool.query(`ALTER TABLE knowledge_nodes ADD COLUMN extraction_sources JSONB DEFAULT '[]'::jsonb`);
        }
        if (!nodeColNames.includes('verification_status')) {
            await pool.query(`ALTER TABLE knowledge_nodes ADD COLUMN verification_status TEXT DEFAULT 'verified' NOT NULL`);
        }

        // --- AUTH SETUP ---
        // Create user and org
        // Suffixed like testUser's email/username above. orgs.name is UNIQUE and this
        // suite does not delete the org it creates, so a fixed name succeeded once on
        // a fresh database and then failed beforeAll on every later run — taking all
        // 18 tests with it.
        const [org] = await db.insert(orgs)
            .values({ name: `Knowledge Garden Auditors ${Date.now()}` })
            .returning();
        testOrgId = org.id;

        const hashedPassword = await passwordService.hashPassword(testUser.password);
        const [insertedUser] = await db.insert(users).values({
            email: testUser.email,
            password: hashedPassword,
            username: testUser.username,
            defaultOrgId: testOrgId,
        }).returning();

        // Associate user with organization
        await db.insert(userOrgs).values({
            userId: insertedUser.id,
            orgId: testOrgId
        });

        // Give user super admin role for full API access during audit
        await db.insert(adminRoles).values({
            userId: insertedUser.id,
            role: 'super_admin'
        });

        // Login to get session
        const loginRes = await request(app)
            .post('/api/login')
            .send({ username: testUser.username, password: testUser.password });

        cookie = loginRes.headers['set-cookie'];

        // Get CSRF token
        const csrfRes = await request(app)
            .get('/api/csrf-token')
            .set('Cookie', cookie);

        csrfToken = csrfRes.body.csrfToken;
        await pool.end();
    }, TIMEOUT);

    let sharedTopicId: number;
    let sharedDocId: number;
    let sharedNodeId: number;

    describe('Topic Lifecycle', () => {
        it('should create a knowledge topic', async () => {
            const res = await request(app)
                .post('/api/topics')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Core Infrastructure',
                    description: 'Architecture and system components'
                });

            expect(res.status).toBe(201);
            expect(res.body.topic.name).toBe('Core Infrastructure');
            sharedTopicId = res.body.topic.id;
        });

        it('should list knowledge topics with counts', async () => {
            const res = await request(app)
                .get('/api/topics')
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.topics)).toBe(true);
            expect(res.body.topics.some((t: any) => t.id === sharedTopicId)).toBe(true);
        });

        it('should update a knowledge topic', async () => {
            const res = await request(app)
                .put(`/api/topics/${sharedTopicId}`)
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    description: 'Revised: Architecture and core system components'
                });

            expect(res.status).toBe(200);
            expect(res.body.topic.description).toContain('Revised');
        });
    });

    describe('Document Lifecycle', () => {
        it('should create a knowledge document linked to a topic', async () => {
            const res = await request(app)
                .post('/api/documents')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    title: 'System Design 2026',
                    summary: 'Overview of the graviton engine',
                    sourceType: 'text',
                    textContent: 'The Graviton engine uses advanced spatial folding...',
                    topicIds: [sharedTopicId]
                });

            expect(res.status).toBe(201);
            expect(res.body.document.title).toBe('System Design 2026');
            sharedDocId = res.body.document.id;
        });

        it('should list documents for a topic', async () => {
            const res = await request(app)
                .get(`/api/documents?topicId=${sharedTopicId}`)
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.documents.length).toBeGreaterThan(0);
            expect(res.body.documents[0].id).toBe(sharedDocId);
        });
    });

    describe('Graph (Nodes & Edges) Lifecycle', () => {
        it('should create a knowledge node linked to a document', async () => {
            const res = await request(app)
                .post('/api/nodes')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    label: 'Infrastructure',
                    name: 'Graviton Engine',
                    description: 'Primary propulsion system',
                    data: { version: '1.0.4', status: 'stable' },
                    knowledgeDocumentId: sharedDocId,
                    knowledgeTopicId: sharedTopicId
                });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe('Graviton Engine');
            sharedNodeId = res.body.id;
        });

        it('should list nodes with label filter', async () => {
            const res = await request(app)
                .get('/api/nodes?label=Infrastructure')
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.nodes.length).toBeGreaterThan(0);
            expect(res.body.nodes.some((n: any) => n.id === sharedNodeId)).toBe(true);
        });

        it('should create an edge between nodes', async () => {
            // Create a second node
            const node2Res = await request(app)
                .post('/api/nodes')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    label: 'Component',
                    name: 'Catalyst Core',
                    knowledgeTopicId: sharedTopicId
                });
            const node2Id = node2Res.body.id;

            const res = await request(app)
                .post('/api/edges')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    sourceId: node2Id,
                    targetId: sharedNodeId,
                    relation: 'PART_OF',
                    weight: 5
                });

            expect(res.status).toBe(201);
            expect(res.body.relation).toBe('PART_OF');
        });

        it('should expand node graph', async () => {
            const res = await request(app)
                .get(`/api/expand/${sharedNodeId}`)
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.nodes).toBeDefined();
            expect(res.body.edges).toBeDefined();
        });
    });

    describe('Staging & Verification Workflow', () => {
        let stagingNodeId: number;

        it('should create a node in staging status', async () => {
            const res = await request(app)
                .post('/api/nodes')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    label: 'Unverified',
                    name: 'Anomalous Entry',
                    verificationStatus: 'staging'
                });

            expect(res.status).toBe(201);
            stagingNodeId = res.body.id;
        });

        it('should list nodes in staging', async () => {
            const res = await request(app)
                .get('/api/staging')
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.nodes.some((n: any) => n.id === stagingNodeId)).toBe(true);
        });

        it('should verify (approve) a staging node', async () => {
            const res = await request(app)
                .post(`/api/nodes/${stagingNodeId}/verify`)
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    action: 'approve'
                });

            expect(res.status).toBe(200);
            expect(res.body.verificationStatus).toBe('verified');
        });

        it('should verify (reject) a new staging node', async () => {
            const nodeRes = await request(app)
                .post('/api/nodes')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    label: 'Unverified',
                    name: 'False Positive',
                    verificationStatus: 'staging'
                });
            const nid = nodeRes.body.id;

            const res = await request(app)
                .post(`/api/nodes/${nid}/verify`)
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    action: 'reject'
                });

            expect(res.status).toBe(200);
            expect(res.body.verificationStatus).toBe('rejected');
        });
    });

    describe('Search & Discovery', () => {
        it('should return graph metrics', async () => {
            const res = await request(app)
                .get('/api/metrics')
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(res.body.totalNodes).toBeGreaterThan(0);
        });

        it('should perform unified search', async () => {
            const res = await request(app)
                .post('/api/search/unified')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    query: 'Graviton',
                    limit: 10
                });

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.results)).toBe(true);
        });

        it('should perform natural language search', async () => {
            // Note: This might rely on AI services. If they are not available in test, it should at least not 500 if mocked or handles error.
            const res = await request(app)
                .post('/api/search/natural')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    query: 'Find nodes related to system design'
                });

            // We expect success or a graceful error if AI is unavailable (configuration missing in test)
            // Error 500 is allowed here if it's due to missing API keys (INTERNAL_ERROR)
            expect([200, 422, 500, 503]).toContain(res.status);
        });
    });

    describe('Schema Management', () => {
        it('should list schema definitions', async () => {
            const res = await request(app)
                .get('/api/schema')
                .set('Cookie', cookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('should create a schema definition', async () => {
            const res = await request(app)
                .put('/api/schema')
                .set('Cookie', cookie)
                .set('x-csrf-token', csrfToken)
                .send({
                    name: 'Audit Schema',
                    description: 'Schema for audit logs',
                    entityTypes: { 'AuditLog': { properties: ['action', 'timestamp'] } },
                    relationshipTypes: { 'LOGGED_IN': { source: 'User', target: 'System' } }
                });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe('Audit Schema');
        });
    });
});
