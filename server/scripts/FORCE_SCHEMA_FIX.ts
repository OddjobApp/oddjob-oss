
import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("--- FORCE SCHEMA ALIGNMENT ---");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log("Correcting admin_roles table...");
        // Check if role_type exists and rename to role
        await pool.query(`
            DO $$ 
            BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_roles' AND column_name='role_type') THEN
                    ALTER TABLE admin_roles RENAME COLUMN role_type TO role;
                END IF;
            END $$;
        `);

        console.log("Correcting users table...");
        // Ensure modern columns exist
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS default_organization_id INTEGER;
        `);

        console.log("Schema alignment complete!");
    } catch (e: any) {
        console.error("Alignment failed:", e.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

