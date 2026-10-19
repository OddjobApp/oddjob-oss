import dotenv from 'dotenv';
dotenv.config({ override: true });
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

async function sync() {
    try {
        const updates = [
            { appId: 429, port: 11058, containerId: 'fbfa93945770' },  // Stakeholder
            { appId: 494, port: 11061, containerId: '9f050e40ceea' },  // Procurement
            { appId: 467, port: 11062, containerId: 'c80b8666ba06' }   // Research
        ];

        console.log('📝 Syncing final 3 containers to database...\n');

        for (const update of updates) {
            await pool.query(
                `UPDATE app_instances
                 SET port = $1, container_id = $2, status = 'running', last_heartbeat_at = NOW()
                 WHERE id IN (
                   SELECT i.id FROM app_instances i
                   JOIN app_deployments d ON i.deployment_id = d.id
                   WHERE d.app_id = $3
                 )`,
                [update.port, update.containerId, update.appId]
            );
            console.log(`✅ Updated app ${update.appId} (Port ${update.port})`);
        }

        console.log('\n✅ Database sync complete!\n');
        await pool.end();
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

sync();
