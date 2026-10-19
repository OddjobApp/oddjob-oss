
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function runHotfix() {
  console.log("Starting DB Schema Hotfix...");
  
  try {
    // 1. Fix org_settings
    console.log("Checking org_settings table...");
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_settings' AND column_name='assistant_soul_traits') THEN
          ALTER TABLE org_settings ADD COLUMN assistant_soul_traits jsonb DEFAULT '{}'::jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_settings' AND column_name='assistant_soul_archetype') THEN
          ALTER TABLE org_settings ADD COLUMN assistant_soul_archetype text;
        END IF;
      END $$;
    `);
    console.log("✓ org_settings columns verified/added.");

    // 2. Fix missions
    console.log("Checking missions table...");
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='missions' AND column_name='context_core_url') THEN
          ALTER TABLE missions ADD COLUMN context_core_url text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='missions' AND column_name='entity_count') THEN
          ALTER TABLE missions ADD COLUMN entity_count integer;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='missions' AND column_name='relationship_count') THEN
          ALTER TABLE missions ADD COLUMN relationship_count integer;
        END IF;
      END $$;
    `);
    console.log("✓ missions columns verified/added.");

    console.log("DB Hotfix Completed Successfully.");
  } catch (error) {
    console.error("DB Hotfix Failed:", error);
    process.exit(1);
  }
}

runHotfix().then(() => process.exit(0));
