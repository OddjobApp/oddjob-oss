import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function ensureTables() {
    console.log("Provisioning Signal Intelligence database tables...");
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS event_primitives (
            id SERIAL PRIMARY KEY,
            organization_id INT,
            source_entry_id TEXT,
            event_type TEXT,
            target_sector TEXT,
            jurisdiction TEXT,
            severity TEXT,
            source_url TEXT,
            extraction_timestamp TIMESTAMPTZ DEFAULT NOW(),
            confidence_score NUMERIC,
            raw_text TEXT,
            flags JSONB,
            content_hash TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cycle_signal_subscriptions (
            id SERIAL PRIMARY KEY,
            organization_id INT,
            cycle_id TEXT,
            name TEXT,
            enabled BOOLEAN DEFAULT TRUE,
            filters JSONB,
            delivery_mode TEXT,
            state_projection JSONB,
            cooldown_minutes INT DEFAULT 0,
            last_delivered_at TIMESTAMPTZ,
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS signal_feeds (
            id SERIAL PRIMARY KEY,
            organization_id INT,
            name TEXT,
            source_type TEXT,
            url TEXT,
            auth_credentials JSONB,
            polling_interval_seconds INT DEFAULT 900,
            enabled BOOLEAN DEFAULT TRUE,
            status TEXT,
            consecutive_failures INT DEFAULT 0,
            last_poll_at TIMESTAMPTZ,
            last_success_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    console.log("✅ Signal Intelligence tables provisioned successfully.");
    process.exit(0);
}

ensureTables().catch(err => {
    console.error("❌ Failed to provision tables:", err);
    process.exit(1);
});
