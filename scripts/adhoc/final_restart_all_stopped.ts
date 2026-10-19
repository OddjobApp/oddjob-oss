import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function finalRestart() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

    try {
        console.log('🚀 FINAL RESTART - 4 STOPPED APPS\n');
        console.log(''.padEnd(140, '='));

        const orgResult = await pool.query(
            "SELECT org_id as id FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        const orgId = orgResult.rows[0].id;

        // Get stopped apps and find next available port
        const stoppedResult = await pool.query(
            `SELECT DISTINCT ON (a.id)
                a.id, a.name, i.port, i.id as instance_id
            FROM apps a
            JOIN app_deployments d ON d.app_id = a.id
            JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1 AND i.status = 'stopped'
            ORDER BY a.id`,
            [orgId]
        );

        const stoppedApps = stoppedResult.rows;
        console.log(`Found ${stoppedApps.length} stopped app(s)\n`);

        // Find next available port
        const maxPortResult = await pool.query(
            `SELECT MAX(CAST(port AS INTEGER)) as max_port FROM app_instances i
             INNER JOIN app_deployments d ON i.deployment_id = d.id
             INNER JOIN apps a ON d.app_id = a.id
             WHERE a.organization_id = $1`,
            [orgId]
        );

        let nextPort = (maxPortResult.rows[0]?.max_port || 10630) + 1;
        console.log(`Next available port: ${nextPort}\n`);

        const deploymentResults: any[] = [];
        let successCount = 0;

        for (const app of stoppedApps) {
            // Use next available port
            const assignedPort = nextPort++;

            console.log(`📦 ${app.name}`);
            console.log(`   ID: ${app.id}`);
            console.log(`   Assigned Port: ${assignedPort}`);

            try {
                // Create container with new port
                const containerName = `oddjob-app-restart-${app.id}-${assignedPort}`;

                console.log(`   🔧 Creating container...`);

                const dockerCmd = `docker run -d --name ${containerName} -p ${assignedPort}:3000 -e ODDJOB_APP_ID=${app.id} -e ODDJOB_ORG_ID=${orgId} -e PORT=${assignedPort} -e APP_NAME="${app.name}" --restart unless-stopped oddjob-dev-base:latest`;

                const output = execSync(dockerCmd, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: 60000,
                    maxBuffer: 10 * 1024 * 1024
                });

                const containerId = output.trim();
                console.log(`   ✅ Container created: ${containerId.substring(0, 12)}`);

                // Update both port and container ID in database
                await pool.query(
                    `UPDATE app_instances
                     SET port = $1, container_id = $2, status = 'running', last_heartbeat_at = NOW()
                     WHERE id = $3`,
                    [assignedPort, containerId, app.instance_id]
                );

                console.log(`   ✅ Database updated (Port ${assignedPort})\n`);

                deploymentResults.push({
                    app_name: app.name,
                    port: assignedPort,
                    container_id: containerId.substring(0, 12),
                    status: 'SUCCESS'
                });

                successCount++;

            } catch (error: any) {
                const errorMsg = error.message.split('\n')[0];
                console.log(`   ❌ Failed: ${errorMsg.substring(0, 80)}\n`);

                deploymentResults.push({
                    app_name: app.name,
                    status: 'FAILED',
                    error: errorMsg.substring(0, 60)
                });
            }
        }

        console.log(''.padEnd(140, '='));
        console.log(`\n✅ RESTART COMPLETE: ${successCount}/${stoppedApps.length} apps restarted\n`);

        for (const result of deploymentResults) {
            const icon = result.status === 'SUCCESS' ? '✅' : '❌';
            const info = result.container_id
                ? `Port ${result.port}`
                : result.error;
            console.log(`   ${icon} ${result.app_name.padEnd(40)} | ${info}`);
        }

        // Verify
        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n🔍 FINAL VERIFICATION\n');

        const allApps = await pool.query(
            `SELECT
                a.name,
                COUNT(CASE WHEN i.status = 'running' THEN 1 END)::int as running,
                COUNT(i.id)::int as total
            FROM apps a
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            GROUP BY a.id, a.name
            ORDER BY a.name`,
            [orgId]
        );

        let totalRunning = 0;
        let totalApps = 0;

        console.log('TECHHEAD7 Apps Status:\n');
        for (const app of allApps.rows) {
            const status = app.running > 0 ? '🟢' : '🔴';
            console.log(`   ${status} ${app.name.padEnd(40)} | ${app.running}/${app.total} running`);
            totalRunning += app.running;
            totalApps += app.total;
        }

        console.log(`\n📊 TOTAL: 🟢 ${totalRunning}/${totalApps} running (${Math.round(totalRunning/totalApps*100)}%)`);

        console.log('\n' + ''.padEnd(140, '='));

        if (totalRunning === totalApps) {
            console.log('\n🎉 SUCCESS! ALL TECHHEAD7 APPS NOW RUNNING!\n');
        } else {
            console.log(`\n⏳ ${totalApps - totalRunning} app(s) still pending...\n`);
        }

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

finalRestart().catch(console.error);
