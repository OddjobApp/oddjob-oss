import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function repairFoundation() {
    try {
        console.log("Starting foundational schema repair...");

        // 1. Repair ORGS
        console.log("Repairing 'orgs'...");
        await db.execute(sql`
            DO $$ 
            BEGIN 
                -- Add PK if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'orgs' AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    ALTER TABLE "orgs" ADD PRIMARY KEY ("org_id");
                END IF;

                -- Add UNIQUE if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'orgs' AND constraint_name = 'orgs_name_unique'
                ) THEN
                    ALTER TABLE "orgs" ADD CONSTRAINT "orgs_name_unique" UNIQUE ("name");
                END IF;
            END $$;
        `);

        // 2. Repair USERS
        console.log("Repairing 'users'...");
        await db.execute(sql`
            DO $$ 
            BEGIN 
                -- Add PK if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'users' AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    ALTER TABLE "users" ADD PRIMARY KEY ("id");
                END IF;

                -- Add UNIQUE if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'users' AND constraint_name = 'users_username_unique'
                ) THEN
                    ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE ("username");
                END IF;
            END $$;
        `);

        // 3. Repair SUPPRESSION_POLICIES
        console.log("Repairing 'suppression_policies'...");
        await db.execute(sql`
            DO $$ 
            BEGIN 
                -- Add PK if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'suppression_policies' AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    ALTER TABLE "suppression_policies" ADD PRIMARY KEY ("policy_id");
                END IF;

                -- Add UNIQUE if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'suppression_policies' AND constraint_name = 'suppression_policies_name_unique'
                ) THEN
                    ALTER TABLE "suppression_policies" ADD CONSTRAINT "suppression_policies_name_unique" UNIQUE ("name");
                END IF;
            END $$;
        `);

        // 4. Repair MISSION_RUNS
        console.log("Repairing 'mission_runs'...");
        await db.execute(sql`
            DO $$ 
            BEGIN 
                -- Add PK if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'mission_runs' AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    ALTER TABLE "mission_runs" ADD PRIMARY KEY ("id");
                END IF;
            END $$;
        `);

        // 5. Repair PIPELINES
        console.log("Repairing 'pipelines'...");
        await db.execute(sql`
            DO $$ 
            BEGIN 
                -- Add PK if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'pipelines' AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    ALTER TABLE "pipelines" ADD PRIMARY KEY ("id");
                END IF;

                -- Add UNIQUE index if missing (for (organization_id, name))
                IF NOT EXISTS (
                    SELECT 1 FROM pg_indexes 
                    WHERE tablename = 'pipelines' AND indexname = 'pipelines_org_name_unique'
                ) THEN
                    CREATE UNIQUE INDEX "pipelines_org_name_unique" ON "pipelines" ("organization_id", "name");
                END IF;
            END $$;
        `);

        // 6. Repair APPS
        console.log("Repairing 'apps'...");
        await db.execute(sql`
            DO $$ 
            BEGIN 
                -- Add PK if missing
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'apps' AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    ALTER TABLE "apps" ADD PRIMARY KEY ("id");
                END IF;

                -- Add UNIQUE index if missing (for slug)
                IF NOT EXISTS (
                    SELECT 1 FROM pg_indexes 
                    WHERE tablename = 'apps' AND indexname = 'apps_slug_unique'
                ) THEN
                    CREATE UNIQUE INDEX "apps_slug_unique" ON "apps" ("slug");
                END IF;
            END $$;
        `);

        console.log("Foundational schema repair completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Foundational repair failed:", err);
        process.exit(1);
    }
}

repairFoundation();
