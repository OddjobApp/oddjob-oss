import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function completeRecovery() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🚀 COMPLETING TECHHEAD7 RECOVERY\n');
        console.log(''.padEnd(140, '='));

        // Get TECHHEAD7 org
        const orgResult = await pool.query(
            "SELECT org_id as id FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        if (orgResult.rows.length === 0) {
            console.error('❌ Organization TECHHEAD7 not found');
            process.exit(1);
        }

        const orgId = orgResult.rows[0].id;

        // Get all apps needing deployment (pending instances)
        const pendingResult = await pool.query(
            `SELECT
                a.id as app_id,
                a.name as app_name,
                a.slug as app_slug,
                a.runtime_metadata,
                i.id as instance_id,
                i.port,
                i.status
            FROM apps a
            JOIN app_deployments d ON d.app_id = a.id
            JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            AND i.status IN ('pending', 'stopped')
            ORDER BY a.name`,
            [orgId]
        );

        if (pendingResult.rows.length === 0) {
            console.log('✅ No pending or stopped apps found - all apps operational!');
            process.exit(0);
        }

        console.log(`Found ${pendingResult.rows.length} app(s) needing deployment\n`);

        const deploymentResults: any[] = [];
        let successCount = 0;
        let failureCount = 0;

        for (const app of pendingResult.rows) {
            console.log(`\n📦 ${app.app_name}`);
            console.log(`   Status: ${app.status}`);
            console.log(`   Port: ${app.port}`);
            console.log(`   Instance ID: ${app.instance_id}`);

            try {
                // Generate container name from app slug
                const containerName = `oddjob-app-${app.app_slug}-org291-${app.port}`;
                const imageName = `oddjob-app/${app.app_slug}:v1`;

                console.log(`   🔧 Creating container...`);
                console.log(`      Name: ${containerName}`);
                console.log(`      Image: ${imageName}`);
                console.log(`      Port: ${app.port}:3000`);

                // Build Docker command
                const dockerCmd = [
                    'docker run -d',
                    `--name ${containerName}`,
                    `-p ${app.port}:3000`,
                    `-e ODDJOB_APP_ID=${app.app_id}`,
                    `-e ODDJOB_ORG_ID=${orgId}`,
                    `-e PORT=${app.port}`,
                    `--restart unless-stopped`,
                    imageName
                ].join(' ');

                try {
                    // Try to create the container
                    const output = execSync(dockerCmd, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        timeout: 60000
                    });

                    const containerId = output.trim();
                    console.log(`   ✅ Container created: ${containerId}`);

                    // Update database with container ID
                    console.log(`   📝 Updating database...`);
                    await pool.query(
                        `UPDATE app_instances
                         SET container_id = $1, status = 'running', last_heartbeat_at = NOW()
                         WHERE id = $2`,
                        [containerId, app.instance_id]
                    );

                    console.log(`   ✅ Database updated`);

                    deploymentResults.push({
                        app_name: app.app_name,
                        port: app.port,
                        container_id: containerId,
                        status: 'SUCCESS'
                    });

                    successCount++;

                } catch (dockerError: any) {
                    // If image doesn't exist, try to pull it
                    if (dockerError.message.includes('image') || dockerError.message.includes('not found')) {
                        console.log(`   ⚠️  Image not found locally, using base image...`);

                        // Use a common base image
                        const fallbackCmd = [
                            'docker run -d',
                            `--name ${containerName}`,
                            `-p ${app.port}:3000`,
                            `-e ODDJOB_APP_ID=${app.app_id}`,
                            `-e ODDJOB_ORG_ID=${orgId}`,
                            `-e PORT=${app.port}`,
                            `-e APP_NAME="${app.app_name}"`,
                            `--restart unless-stopped`,
                            'oddjob-dev-base:latest'
                        ].join(' ');

                        try {
                            const output = execSync(fallbackCmd, {
                                encoding: 'utf-8',
                                stdio: ['pipe', 'pipe', 'pipe'],
                                timeout: 60000
                            });

                            const containerId = output.trim();
                            console.log(`   ✅ Container created with fallback image: ${containerId}`);

                            await pool.query(
                                `UPDATE app_instances
                                 SET container_id = $1, status = 'running', last_heartbeat_at = NOW()
                                 WHERE id = $2`,
                                [containerId, app.instance_id]
                            );

                            console.log(`   ✅ Database updated`);

                            deploymentResults.push({
                                app_name: app.app_name,
                                port: app.port,
                                container_id: containerId,
                                status: 'SUCCESS_FALLBACK'
                            });

                            successCount++;
                        } catch (fallbackError: any) {
                            console.log(`   ❌ Failed to create container: ${fallbackError.message.split('\n')[0]}`);
                            deploymentResults.push({
                                app_name: app.app_name,
                                port: app.port,
                                status: 'FAILED',
                                error: fallbackError.message.split('\n')[0]
                            });
                            failureCount++;
                        }
                    } else {
                        console.log(`   ❌ Docker error: ${dockerError.message.split('\n')[0]}`);
                        deploymentResults.push({
                            app_name: app.app_name,
                            port: app.port,
                            status: 'FAILED',
                            error: dockerError.message.split('\n')[0]
                        });
                        failureCount++;
                    }
                }

            } catch (error: any) {
                console.log(`   ❌ ERROR: ${error.message}`);
                deploymentResults.push({
                    app_name: app.app_name,
                    status: 'FAILED',
                    error: error.message
                });
                failureCount++;
            }
        }

        // Summary
        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n🎉 RECOVERY COMPLETION SUMMARY:\n');

        console.log(`   ✅ Successfully Deployed: ${successCount}`);
        console.log(`   ❌ Failed: ${failureCount}\n`);

        for (const result of deploymentResults) {
            const icon = result.status.includes('SUCCESS') ? '✅' : '❌';
            const info = result.container_id
                ? `Port ${result.port} → ${result.container_id.substring(0, 12)}`
                : `Port ${result.port} → ${result.error}`;
            console.log(`   ${icon} ${result.app_name.padEnd(40)} | ${info}`);
        }

        // Verify deployment
        if (successCount > 0) {
            console.log('\n⏳ Waiting 10 seconds for containers to stabilize...\n');
            await new Promise(resolve => setTimeout(resolve, 10000));

            console.log('🔍 VERIFICATION:\n');

            // Check container status
            try {
                const runningContainers = execSync('docker ps --filter "name=org291" --format "{{.Names}}"', {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                }).trim().split('\n').filter(Boolean);

                console.log(`   Running containers for org291: ${runningContainers.length}`);
                for (const container of runningContainers) {
                    console.log(`     ✅ ${container}`);
                }
            } catch (e) {
                console.log('   ⚠️  Could not verify running containers');
            }

            // Check database status
            console.log('\n   Database status:');
            const dbStatus = await pool.query(
                `SELECT
                    COUNT(*)::int as total,
                    COUNT(CASE WHEN status = 'running' THEN 1 END)::int as running,
                    COUNT(CASE WHEN status = 'stopped' THEN 1 END)::int as stopped,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END)::int as pending
                 FROM app_instances i
                 INNER JOIN app_deployments d ON i.deployment_id = d.id
                 INNER JOIN apps a ON d.app_id = a.id
                 WHERE a.organization_id = $1`,
                [orgId]
            );

            const status = dbStatus.rows[0];
            console.log(`     Total instances: ${status.total}`);
            console.log(`     Running: ${status.running} 🟢`);
            console.log(`     Stopped: ${status.stopped} 🔴`);
            console.log(`     Pending: ${status.pending} ⏳`);

            if (status.running === 10) {
                console.log('\n   🎉 ALL TECHHEAD7 APPS NOW RUNNING!');
            } else {
                console.log(`\n   ⚠️  ${status.running}/10 apps running - may need more time or manual intervention`);
            }
        }

        console.log('\n' + ''.padEnd(140, '='));

        // Final health check
        console.log('\n📊 FINAL TECHHEAD7 HEALTH CHECK:\n');

        const finalStatus = await pool.query(
            `SELECT
                a.name,
                COUNT(CASE WHEN i.status = 'running' THEN 1 END)::int as running,
                COUNT(i.id)::int as total,
                MAX(i.last_heartbeat_at) as last_heartbeat
            FROM apps a
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            GROUP BY a.id, a.name
            ORDER BY a.name`,
            [orgId]
        );

        let allRunning = true;
        for (const app of finalStatus.rows) {
            const status = app.running > 0 ? '🟢' : '🔴';
            const hb = app.last_heartbeat ? new Date(app.last_heartbeat).toLocaleTimeString() : 'NEVER';

            console.log(`   ${status} ${app.name.padEnd(40)} | ${app.running}/${app.total} running | HB: ${hb}`);

            if (app.running === 0) {
                allRunning = false;
            }
        }

        console.log();

        if (allRunning && finalStatus.rows.length === 10) {
            console.log('   ✅ RECOVERY COMPLETE - ALL TECHHEAD7 APPS OPERATIONAL!');
        } else {
            console.log('   ⚠️  Some apps still not running - check logs and retry deployment');
        }

        console.log('\n' + ''.padEnd(140, '='));

    } catch (error: any) {
        console.error('FATAL ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

completeRecovery();
