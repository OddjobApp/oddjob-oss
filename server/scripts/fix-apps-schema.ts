import "dotenv/config";
import { Pool } from "pg";

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log("🔧 Checking apps table schema...");

        // Add missing columns with IF NOT EXISTS to be idempotent
        await pool.query(`
            ALTER TABLE apps
                ADD COLUMN IF NOT EXISTS docker_image text,
                ADD COLUMN IF NOT EXISTS runtime_metadata jsonb NOT NULL DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS price_per_launch_usd numeric(10,2) NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS developer_payout_percentage integer NOT NULL DEFAULT 70;
        `);

        console.log("✅ apps table schema is up to date.");

        // Now register the Dispatcher app
        console.log("🏪 Registering Dispatcher app...");

        const { rows: existing } = await pool.query(
            `SELECT id FROM apps WHERE slug = 'service-dispatch' LIMIT 1`
        );

        const appData = {
            name: "Dispatcher",
            slug: "service-dispatch",
            description: "Coordinate emergency assistance, helper discovery, and real-time tracking with geospatial orchestration.",
            icon: "Navigation",
            is_public: true,
            is_system: true,
            version: "1.0.0",
            developer_org_id: null,
        };

        if (existing.length > 0) {
            await pool.query(
                `UPDATE apps SET name=$1, description=$2, icon=$3, is_public=$4, is_system=$5, version=$6, developer_org_id=$7 WHERE id=$8`,
                [appData.name, appData.description, appData.icon, appData.is_public, appData.is_system, appData.version, appData.developer_org_id, existing[0].id]
            );
            console.log("♻️  Updated existing Dispatcher app.");
        } else {
            await pool.query(
                `INSERT INTO apps (name, slug, description, icon, is_public, is_system, version, developer_org_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [appData.name, appData.slug, appData.description, appData.icon, appData.is_public, appData.is_system, appData.version, appData.developer_org_id]
            );
            console.log("🚀 Registered new Dispatcher app.");
        }

        // Deduplicate first, then enforce uniqueness
        console.log("🧹 Deduplicating apps table...");
        await pool.query(`
            DELETE FROM apps
            WHERE id NOT IN (
                SELECT MIN(id) FROM apps GROUP BY slug
            )
        `);
        console.log("✅ Duplicates removed.");

        // Now safe to create the unique index
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS app_slug_unique ON apps (slug)
        `);
        console.log("✅ Unique index on apps.slug ensured.");

        // Register Prospector app
        console.log("🔭 Registering Prospector app...");

        const { rows: existingProspector } = await pool.query(
            `SELECT id FROM apps WHERE slug = 'prospecting' LIMIT 1`
        );

        if (existingProspector.length > 0) {
            console.log("✅ Prospector app already registered.");
        } else {
            await pool.query(
                `INSERT INTO apps (name, slug, description, icon, is_public, is_system, version, developer_org_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                ["AI Prospector & Co-pilot", "prospecting", "Advanced visitor de-anonymization and interaction tracking. Identify anonymous traffic and score intent in real-time.", "Search", true, true, "1.0.0", null]
            );
            console.log("🚀 Registered new Prospector app.");
        }

        console.log("✅ Done.");
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exit(1);
});
