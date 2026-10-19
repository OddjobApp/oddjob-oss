import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function restartStopped() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

    try {
        console.log('🚀 RESTARTING STOPPED APPS\n');
        console.log(''.padEnd(140, '='));

        const orgResult = await pool.query(
            "SELECT org_id as id FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        const orgId = orgResult.rows[0].id;

        // Get the 4 stopped apps directly from database
        const result = await pool.query(
            `SELECT DISTINCT ON (a.id)
                a.id, a.name, i.port, i.id as instance_id
            FROM apps a
            JOIN app_deployments d ON d.app_id = a.id
            JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1 AND i.status = 'stopped'
            ORDER BY a.id`,
            [orgId]
        );

        const stoppedApps = result.rows;
        console.log(`Found ${stoppedApps.length} stopped app(s)\n`);

        let successCount = 0;

        for (const app of stoppedApps) {
            console.log(`📦 ${app.name} (ID: ${app.id}, Port: ${app.port})`);

            try {
                // Create container name from app ID and port
                const containerName = `oddjob-app-stopped-${app.id}-${app.port}`;

                console.log(`   🔧 Creating container...`);

                const dockerCmd = `docker run -d --name ${containerName} -p ${app.port}:3000 -e ODDJOB_APP_ID=${app.id} -e ODDJOB_ORG_ID=${orgId} -e PORT=${app.port} -e APP_NAME="${app.name}" --restart unless-stopped oddjob-dev-base:latest`;

                const output = execSync(dockerCmd, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 60000
                });

                const containerId = output.trim();
                console.log(`   ✅ Container created: ${containerId.substring(0, 12)}`);

                // Update database
                await pool.query(
                    `UPDATE app_instances SET container_id = $1, status = 'running', last_heartbeat_at = NOW() WHERE id = $2`,
                    [containerId, app.instance_id]
                );

                console.log(`   ✅ Database updated\n`);
                successCount++;

            } catch (error: any) {
                console.log(`   ❌ Error: ${error.message.split('\n')[0].substring(0, 80)}\n`);
            }
        }

        console.log(''.padEnd(140, '='));
        console.log(`\n✅ RESTART COMPLETE: ${successCount}/${stoppedApps.length} apps restarted\n`);

        // Final verification
        console.log('🔍 Verifying running org291 containers...\n');
        const containers = execSync('docker ps --filter "name=org291" --format "table {{.Names}}\t{{.Status}}"', {
            encoding: 'utf-8'
        });

        const runningCount = containers.split('\n').filter(l => l.includes('Up')).length;
        console.log(`Running containers: ${runningCount}\n`);
        console.log(containers);

        console.log(''.padEnd(140, '='));

    } finally {
        await pool.end();
    }
}

restartStopped().catch(console.error);
