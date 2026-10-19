import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function dedupe() {
    try {
        console.log("Starting data deduplication...");

        // 1. Dedupe ORGS
        console.log("Deduping 'orgs' (keeping oldest org_id)...");
        const orgResult = await db.execute(sql`
            DELETE FROM orgs a
            USING orgs b
            WHERE a.org_id > b.org_id
            AND a.name = b.name;
        `);
        console.log(`Removed duplicate orgs.`);

        // 2. Dedupe USERS
        console.log("Deduping 'users' (keeping first alphabetical UUID)...");
        const userResult = await db.execute(sql`
            DELETE FROM users a
            USING users b
            WHERE a.id > b.id
            AND a.username = b.username;
        `);
        console.log(`Removed duplicate users.`);

        // 3. Dedupe PIPELINES
        console.log("Deduping 'pipelines' (keeping oldest id)...");
        await db.execute(sql`
            DELETE FROM pipelines a
            USING pipelines b
            WHERE a.id > b.id
            AND a.organization_id = b.organization_id
            AND a.name = b.name;
        `);
        console.log(`Removed duplicate pipelines.`);

        // 4. Dedupe APPS
        console.log("Deduping 'apps' (keeping oldest id)...");
        await db.execute(sql`
            DELETE FROM apps a
            USING apps b
            WHERE a.id > b.id
            AND a.slug = b.slug;
        `);
        console.log(`Removed duplicate apps.`);

        console.log("Deduplication completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Deduplication failed:", err);
        process.exit(1);
    }
}

dedupe();
