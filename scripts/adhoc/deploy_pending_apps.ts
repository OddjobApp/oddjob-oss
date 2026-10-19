import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function deployPendingApps() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🚀 DEPLOYING 3 PENDING TECHHEAD7 APPS\n');
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

        // Get the 3 pending apps
        const pendingResult = await pool.query(
            `SELECT DISTINCT ON (a.id)
                a.id as app_id,
                a.name as app_name,
                a.slug as app_slug,
                i.id as instance_id,
                i.port,
                i.status
            FROM apps a
            JOIN app_deployments d ON d.app_id = a.id
            JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            AND i.status = 'pending'
            AND a.name IN ('Product Launch Workbench', 'Research & RFC Synthesis Portal', 'Procurement Management Portal')
            ORDER BY a.id`,
            [orgId]
        );

        if (pendingResult.rows.length === 0) {
            console.log('✅ No pending apps found');
            process.exit(0);
        }

        console.log(`Found ${pendingResult.rows.length} pending app(s) to deploy\n`);

        const deploymentResults: any[] = [];
        let successCount = 0;
        let failureCount = 0;

        for (const app of pendingResult.rows) {
            console.log(`\n📦 ${app.app_name}`);
            console.log(`   Port: ${app.port}`);
            console.log(`   Instance ID: ${app.instance_id}`);

            try {
                // Generate clean container name
                const cleanSlug = app.app_slug.replace(/org291/g, '').replace(/-+$/, '').trim();
                const containerName = `oddjob-app-${cleanSlug}-org291-${app.port}`;

                console.log(`   🔧 Creating container...`);
                console.log(`      Name: ${containerName}`);
                console.log(`      Port: ${app.port}:3000`);

                // Try creating with dev-base image
                const dockerCmd = `docker run -d --name ${containerName} -p ${app.port}:3000 -e ODDJOB_APP_ID=${app.app_id} -e ODDJOB_ORG_ID=${orgId} -e PORT=${app.port} -e APP_NAME="${app.app_name}" --restart unless-stopped oddjob-dev-base:latest`;

                try {
                    const output = execSync(dockerCmd, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        timeout: 60000
                    });

                    const containerId = output.trim();
                    console.log(`   ✅ Container created: ${containerId.substring(0, 12)}`);

                    // Update database
                    console.log(`   📝 Updating database...`);
                    await pool.query(
                        `UPDATE app_instances
                         SET container_id = $1, status = 'running', last_heartbeat_at = NOW()
                         WHERE id = $2`,
                        [containerId, app.instance_id]
                    );

                    console.log(`   ✅ Instance updated to RUNNING`);

                    deploymentResults.push({
                        app_name: app.app_name,
                        port: app.port,
                        container_id: containerId.substring(0, 12),
                        status: 'SUCCESS'
                    });

                    successCount++;

                } catch (dockerError: any) {
                    console.log(`   ❌ Docker error: ${dockerError.message.split('\n')[0].substring(0, 80)}`);

                    // Try to get more info
                    try {
                        const inspectCmd = `docker inspect ${containerName} 2>&1`;
                        execSync(inspectCmd);
                    } catch (e) {
                        // Container doesn't exist or inspection failed
                    }

                    deploymentResults.push({
                        app_name: app.app_name,
                        port: app.port,
                        status: 'FAILED',
                        error: dockerError.message.split('\n')[0].substring(0, 60)
                    });

                    failureCount++;
                }

            } catch (error: any) {
                console.log(`   ❌ ERROR: ${error.message.split('\n')[0]}`);
                deploymentResults.push({
                    app_name: app.app_name,
                    status: 'FAILED',
                    error: error.message.split('\n')[0]
                });
                failureCount++;
            }
        }

        // Summary
        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n📊 DEPLOYMENT SUMMARY:\n');

        console.log(`   ✅ Successfully Deployed: ${successCount}`);
        console.log(`   ❌ Failed: ${failureCount}\n`);

        for (const result of deploymentResults) {
            const icon = result.status === 'SUCCESS' ? '✅' : '❌';
            const info = result.container_id
                ? `Port ${result.port} → ${result.container_id}`
                : `Port ${result.port} → ${result.error.substring(0, 40)}`;
            console.log(`   ${icon} ${result.app_name.padEnd(40)} | ${info}`);
        }

        // Verification
        if (successCount > 0) {
            console.log('\n⏳ Waiting 5 seconds for containers to stabilize...\n');
            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log('🔍 VERIFICATION:\n');

            // Check container status
            try {
                const psCmd = `docker ps --filter "name=org291" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"`;
                const output = execSync(psCmd, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                console.log('   Running org291 containers:');
                console.log(output);
            } catch (e) {
                console.log('   Could not verify running containers');
            }
        }

        // Final database status
        console.log('\n📋 FINAL DATABASE STATUS:\n');

        const finalStatus = await pool.query(
            `SELECT
                a.name,
                COUNT(CASE WHEN i.status = 'running' THEN 1 END)::int as running,
                COUNT(CASE WHEN i.status = 'pending' THEN 1 END)::int as pending,
                COUNT(CASE WHEN i.status = 'stopped' THEN 1 END)::int as stopped
            FROM apps a
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            GROUP BY a.id, a.name
            ORDER BY a.name`,
            [orgId]
        );

        console.log('   App Status Summary:\n');
        let totalRunning = 0;
        let totalPending = 0;
        let totalStopped = 0;

        for (const app of finalStatus.rows) {
            const status = app.running > 0 ? '🟢' : app.pending > 0 ? '⏳' : '🔴';
            const counts = `R:${app.running} P:${app.pending} S:${app.stopped}`;
            console.log(`   ${status} ${app.name.padEnd(40)} | ${counts}`);
            totalRunning += app.running;
            totalPending += app.pending;
            totalStopped += app.stopped;
        }

        console.log(`\n   TOTALS: 🟢${totalRunning} ⏳${totalPending} 🔴${totalStopped}`);

        console.log('\n' + ''.padEnd(140, '='));

    } catch (error: any) {
        console.error('FATAL ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

deployPendingApps();
