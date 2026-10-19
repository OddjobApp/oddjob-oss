/**
 * Test Script: Topic Relationship Integration
 * 
 * Tests the direct relationship between Knowledge Topics and Knowledge Nodes:
 * 1. Verifies the knowledgeTopicId column exists in knowledge_nodes
 * 2. Creates test data with topic relationships
 * 3. Tests topic-based filtering in the staging API
 * 4. Tests topic statistics in the stats API
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import {
    knowledgeNodes,
    knowledgeTopics,
    knowledgeDocuments,
    orgs
} from "@shared/schema";
import { eq, sql, and, isNotNull } from "drizzle-orm";

async function testTopicRelationship() {
    console.log("🧪 Testing Topic Relationship Integration\n");
    console.log("=".repeat(60));

    try {
        // Step 1: Check if the column exists
        console.log("\n📋 Step 1: Verifying database schema...");
        const columnCheck = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'knowledge_nodes' 
      AND column_name = 'knowledge_topic_id'
    `);

        if (columnCheck.rows.length === 0) {
            console.log("❌ Column 'knowledge_topic_id' not found in knowledge_nodes table!");
            console.log("   Please run the migration: migrations/add_knowledge_topic_to_nodes.sql");
            return;
        }
        console.log("✅ Column 'knowledge_topic_id' exists in knowledge_nodes");

        // Step 2: Get an organization to work with
        console.log("\n📋 Step 2: Finding test organization...");
        const orgList = await db.select().from(orgs).limit(1);
        if (orgList.length === 0) {
            console.log("❌ No organizations found. Please create one first.");
            return;
        }
        const orgId = orgList[0].id;
        console.log(`✅ Using organization: ${orgList[0].name} (ID: ${orgId})`);

        // Step 3: Check existing topics
        console.log("\n📋 Step 3: Checking existing topics...");
        const existingTopics = await db
            .select()
            .from(knowledgeTopics)
            .where(eq(knowledgeTopics.organizationId, orgId));

        console.log(`   Found ${existingTopics.length} existing topics`);

        let testTopic;
        if (existingTopics.length > 0) {
            testTopic = existingTopics[0];
            console.log(`   Using existing topic: "${testTopic.name}" (ID: ${testTopic.id})`);
        } else {
            // Create a test topic
            const [newTopic] = await db
                .insert(knowledgeTopics)
                .values({
                    name: "Test Topic - Integration Test",
                    description: "Created by test-topic-relationship.ts",
                    organizationId: orgId,
                })
                .returning();
            testTopic = newTopic;
            console.log(`   Created test topic: "${testTopic.name}" (ID: ${testTopic.id})`);
        }

        // Step 4: Check existing nodes with topic relationship
        console.log("\n📋 Step 4: Checking nodes with topic relationships...");
        const nodesWithTopic = await db
            .select({
                id: knowledgeNodes.id,
                name: knowledgeNodes.name,
                label: knowledgeNodes.label,
                topicId: knowledgeNodes.knowledgeTopicId,
                verificationStatus: knowledgeNodes.verificationStatus,
            })
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, orgId),
                    isNotNull(knowledgeNodes.knowledgeTopicId)
                )
            )
            .limit(10);

        console.log(`   Found ${nodesWithTopic.length} nodes with topic relationships`);
        nodesWithTopic.forEach(node => {
            console.log(`     - ${node.name} (${node.label}) → Topic ID: ${node.topicId}, Status: ${node.verificationStatus}`);
        });

        // Step 5: Create test nodes with topic relationship
        console.log("\n📋 Step 5: Creating test nodes with topic relationship...");

        const testNodes = [
            { name: "Test Entity A", label: "PERSON", status: "staging" },
            { name: "Test Entity B", label: "ORGANIZATION", status: "staging" },
            { name: "Test Entity C", label: "CONCEPT", status: "verified" },
        ];

        for (const node of testNodes) {
            const existingNode = await db
                .select()
                .from(knowledgeNodes)
                .where(
                    and(
                        eq(knowledgeNodes.name, node.name),
                        eq(knowledgeNodes.organizationId, orgId)
                    )
                )
                .limit(1);

            if (existingNode.length === 0) {
                await db.insert(knowledgeNodes).values({
                    name: node.name,
                    label: node.label,
                    data: { testData: true, createdBy: "test-topic-relationship.ts" },
                    organizationId: orgId,
                    knowledgeTopicId: testTopic.id,
                    verificationStatus: node.status,
                    confidenceScore: "0.85",
                });
                console.log(`   ✅ Created: ${node.name} (${node.label}) → Topic: ${testTopic.name}`);
            } else {
                // Update existing node to have topic relationship
                await db
                    .update(knowledgeNodes)
                    .set({ knowledgeTopicId: testTopic.id })
                    .where(eq(knowledgeNodes.id, existingNode[0].id));
                console.log(`   ⚡ Updated: ${node.name} → Topic: ${testTopic.name}`);
            }
        }

        // Step 6: Test topic filtering query
        console.log("\n📋 Step 6: Testing topic-filtered query...");
        const filteredNodes = await db
            .select({
                id: knowledgeNodes.id,
                name: knowledgeNodes.name,
                label: knowledgeNodes.label,
                topicId: knowledgeNodes.knowledgeTopicId,
                topicName: knowledgeTopics.name,
                verificationStatus: knowledgeNodes.verificationStatus,
            })
            .from(knowledgeNodes)
            .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
            .where(
                and(
                    eq(knowledgeNodes.organizationId, orgId),
                    eq(knowledgeNodes.knowledgeTopicId, testTopic.id)
                )
            );

        console.log(`   ✅ Found ${filteredNodes.length} nodes for topic "${testTopic.name}"`);
        filteredNodes.forEach(node => {
            console.log(`     - ${node.name} (${node.label}) - ${node.verificationStatus}`);
        });

        // Step 7: Test stats aggregation by topic
        console.log("\n📋 Step 7: Testing topic statistics aggregation...");
        const topicStats = await db
            .select({
                topicId: knowledgeNodes.knowledgeTopicId,
                topicName: knowledgeTopics.name,
                status: knowledgeNodes.verificationStatus,
                count: sql<number>`count(*)::int`,
            })
            .from(knowledgeNodes)
            .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
            .where(eq(knowledgeNodes.organizationId, orgId))
            .groupBy(knowledgeNodes.knowledgeTopicId, knowledgeTopics.name, knowledgeNodes.verificationStatus);

        console.log("   Topic Statistics:");
        const statsByTopic: Record<string, { staging: number; verified: number; rejected: number }> = {};

        topicStats.forEach(stat => {
            const topicKey = stat.topicName || "No Topic";
            if (!statsByTopic[topicKey]) {
                statsByTopic[topicKey] = { staging: 0, verified: 0, rejected: 0 };
            }
            if (stat.status === "staging") statsByTopic[topicKey].staging = stat.count;
            if (stat.status === "verified") statsByTopic[topicKey].verified = stat.count;
            if (stat.status === "rejected") statsByTopic[topicKey].rejected = stat.count;
        });

        Object.entries(statsByTopic).forEach(([topic, stats]) => {
            console.log(`     📁 ${topic}: Staging=${stats.staging}, Verified=${stats.verified}, Rejected=${stats.rejected}`);
        });

        // Step 8: Test API endpoints (via HTTP)
        console.log("\n📋 Step 8: Testing API endpoints...");

        try {
            // Test staging endpoint with topic filter
            const stagingUrl = `http://localhost:5000/api/knowledge-graph/staging?topicId=${testTopic.id}&orgId=${orgId}`;
            console.log(`   Testing: GET ${stagingUrl}`);

            const stagingResponse = await fetch(stagingUrl);
            if (stagingResponse.ok) {
                const stagingData = await stagingResponse.json();
                console.log(`   ✅ Staging API returned ${stagingData.nodes?.length || 0} nodes for topic ${testTopic.id}`);
            } else {
                console.log(`   ⚠️ Staging API returned status ${stagingResponse.status}`);
            }

            // Test stats endpoint
            const statsUrl = `http://localhost:5000/api/knowledge-graph/staging/stats?orgId=${orgId}`;
            console.log(`   Testing: GET ${statsUrl}`);

            const statsResponse = await fetch(statsUrl);
            if (statsResponse.ok) {
                const statsData = await statsResponse.json();
                console.log(`   ✅ Stats API returned data:`);
                console.log(`      - Total Staging: ${statsData.totalStaging}`);
                console.log(`      - By Status: ${JSON.stringify(statsData.byStatus)}`);
                console.log(`      - Topics: ${Object.keys(statsData.byTopic || {}).length} topics`);

                if (statsData.byTopic) {
                    Object.entries(statsData.byTopic).forEach(([key, topic]: [string, any]) => {
                        console.log(`        📁 ${topic.name}: Staging=${topic.staging}, Verified=${topic.verified}`);
                    });
                }
            } else {
                console.log(`   ⚠️ Stats API returned status ${statsResponse.status}`);
            }
        } catch (apiError) {
            console.log(`   ⚠️ API test failed (server may not be running): ${apiError}`);
        }

        // Summary
        console.log("\n" + "=".repeat(60));
        console.log("✅ Topic Relationship Integration Test COMPLETE");
        console.log("=".repeat(60));
        console.log("\nNext Steps:");
        console.log("1. Open the Knowledge Garden in the browser");
        console.log("2. Look for the 'Topics' filter dropdown in the toolbar");
        console.log("3. Select a topic to filter nodes by topic");
        console.log("4. Verify nodes show their associated topic name");
        console.log(`\nTest Topic ID: ${testTopic.id}`);
        console.log(`Browser URL: http://localhost:5000/knowledge-garden`);

    } catch (error) {
        console.error("\n❌ Test failed with error:", error);
        throw error;
    } finally {
        process.exit(0);
    }
}

testTopicRelationship();
