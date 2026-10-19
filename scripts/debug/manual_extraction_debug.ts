/**
 * Manual Knowledge Extraction Debug Script
 * Triggers extraction with detailed logging to trace node/edge lifecycle
 */
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function main() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("╔════════════════════════════════════════════════════════════╗");
        console.log("║       KNOWLEDGE EXTRACTION DEBUG - STATE CHECK             ║");
        console.log("╚════════════════════════════════════════════════════════════╝\n");

        // 1. Check documents
        const docsRes = await pool.query(`
            SELECT id, title, source_type, organization_id, 
                   LENGTH(text_content) as content_length,
                   created_at
            FROM knowledge_documents 
            ORDER BY id DESC 
            LIMIT 10
        `);

        console.log("📄 KNOWLEDGE DOCUMENTS:");
        console.log(`   Total found: ${docsRes.rowCount}`);
        if (docsRes.rowCount && docsRes.rowCount && docsRes.rowCount > 0) {
            docsRes.rows.forEach((r: any) => {
                console.log(`   - [${r.id}] "${r.title?.substring(0, 40)}..." | source: ${r.source_type} | org: ${r.organization_id} | content: ${r.content_length || 0} chars`);
            });
        } else {
            console.log("   ⚠️  No documents found! You need to ingest documents first.");
        }

        // 2. Check schemas
        console.log("\n📐 GRAPH SCHEMAS:");
        const schemaRes = await pool.query(`
            SELECT id, name, organization_id, is_active, created_at
            FROM graph_schema_defs 
            ORDER BY id DESC
            LIMIT 5
        `);
        console.log(`   Total found: ${schemaRes.rowCount}`);
        if (schemaRes.rowCount && schemaRes.rowCount && schemaRes.rowCount > 0) {
            schemaRes.rows.forEach((r: any) => {
                console.log(`   - [${r.id}] "${r.name}" | org: ${r.organization_id} | active: ${r.is_active}`);
            });
        } else {
            console.log("   ⚠️  No schemas found! Creating a default schema is required.");
        }

        // 3. Check nodes
        console.log("\n🔵 KNOWLEDGE NODES:");
        const nodesRes = await pool.query(`SELECT COUNT(*) as count FROM knowledge_nodes`);
        console.log(`   Total count: ${nodesRes.rows[0].count}`);

        if (parseInt(nodesRes.rows[0].count) > 0) {
            const sampleNodes = await pool.query(`
                SELECT id, label, name, verification_status 
                FROM knowledge_nodes 
                LIMIT 5
            `);
            sampleNodes.rows.forEach((r: any) => {
                console.log(`   - [${r.id}] "${r.name}" (${r.label}) | status: ${r.verification_status}`);
            });
        }

        // 4. Check edges
        console.log("\n🔗 KNOWLEDGE EDGES:");
        const edgesRes = await pool.query(`SELECT COUNT(*) as count FROM knowledge_edges`);
        console.log(`   Total count: ${edgesRes.rows[0].count}`);

        // 5. Check recent extractions
        console.log("\n⚙️  RECENT EXTRACTIONS:");
        const extractRes = await pool.query(`
            SELECT id, document_id, schema_id, status, error, 
                   nodes_extracted, edges_extracted,
                   created_by, completed_at
            FROM knowledge_document_extractions 
            ORDER BY id DESC 
            LIMIT 5
        `);
        console.log(`   Total found: ${extractRes.rowCount}`);
        if (extractRes.rowCount && extractRes.rowCount && extractRes.rowCount > 0) {
            extractRes.rows.forEach((r: any) => {
                const errorSnippet = r.error ? ` | error: ${r.error.substring(0, 60)}...` : '';
                console.log(`   - [${r.id}] doc:${r.document_id} schema:${r.schema_id} | status: ${r.status} | nodes:${r.nodes_extracted || 0} edges:${r.edges_extracted || 0}${errorSnippet}`);
            });
        }

        // 6. Summary and recommendation
        console.log("\n" + "═".repeat(64));
        console.log("SUMMARY:");

        const hasDocuments = docsRes.rowCount && docsRes.rowCount && docsRes.rowCount > 0;
        const hasSchemas = schemaRes.rowCount && schemaRes.rowCount && schemaRes.rowCount > 0;
        const hasNodes = parseInt(nodesRes.rows[0].count) > 0;
        const hasEdges = parseInt(edgesRes.rows[0].count) > 0;

        if (!hasDocuments) {
            console.log("❌ No documents - need to ingest content to Knowledge Store first");
        } else if (!hasSchemas) {
            console.log("❌ No schemas - need to create a graph schema before extraction");
        } else if (!hasNodes && !hasEdges) {
            console.log("❌ No nodes/edges - extraction has not produced results");
            console.log("   Next step: Trigger manual extraction with detailed logging");
        } else {
            console.log("✅ Data present - graph should be visible");
        }

        // Return data for next steps
        return {
            documents: docsRes.rows,
            schemas: schemaRes.rows,
            hasData: hasDocuments && hasSchemas
        };

    } finally {
        await pool.end();
    }
}

main().then(result => {
    if (result.hasData) {
        console.log("\n📋 Ready for extraction. Run: npx tsx scripts/debug/trigger_extraction_verbose.ts");
    }
    process.exit(0);
}).catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
