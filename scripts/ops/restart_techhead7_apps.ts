import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function restartTechhead7Apps() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🔄 Restarting TECHHEAD7 Stopped Apps\n');
        console.log(''.padEnd(120, '='));

        // Get TECHHEAD7 org
        const orgResult = await pool.query(
            "SELECT org_id as id FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        if (orgResult.rows.length === 0) {
            console.error('❌ Organization TECHHEAD7 not found');
            process.exit(1);
        }

        const orgId = orgResult.rows[0].id;

        // Get stopped instances for TECHHEAD7
        const stoppedResult = await pool.query(
            `SELECT
                a.id as app_id,
                a.name as app_name,
                i.id as instance_id,
                i.container_id,
                i.status,
                i.last_heartbeat_at,
                d.id as deployment_id
            FROM apps a
            JOIN app_deployments d ON d.app_id = a.id
            JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            AND i.status = 'stopped'
            ORDER BY a.name`,
            [orgId]
        );

        if (stoppedResult.rows.length === 0) {
            console.log('✅ No stopped instances found in TECHHEAD7');
            process.exit(0);
        }

        console.log(`Found ${stoppedResult.rows.length} stopped instance(s)\n`);

        const restartResults: any[] = [];

        for (const instance of stoppedResult.rows) {
            console.log(`\n📦 ${instance.app_name}`);
            console.log(`   Instance ID:      ${instance.instance_id}`);
            console.log(`   Container ID:     ${instance.container_id || 'NOT SET'}`);
            console.log(`   Status:           ${instance.status}`);
            console.log(`   Last Heartbeat:   ${new Date(instance.last_heartbeat_at).toLocaleString()}`);

            if (!instance.container_id) {
                console.log(`   ⚠️  ERROR: No Container ID - cannot restart via Docker`);
                console.log(`   → This instance needs manual deployment or container recreation`);
                restartResults.push({
                    app_name: instance.app_name,
                    status: 'FAILED',
                    reason: 'No Container ID in database',
                    container_id: null
                });
                continue;
            }

            try {
                // Check if container exists
                console.log(`   🔍 Checking Docker container status...`);
                const inspectOutput = execSync(`docker inspect ${instance.container_id}`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                const containerInfo = JSON.parse(inspectOutput);
                const isRunning = containerInfo[0].State.Running;

                if (isRunning) {
                    console.log(`   ✅ Container is already RUNNING`);
                    restartResults.push({
                        app_name: instance.app_name,
                        status: 'ALREADY_RUNNING',
                        reason: 'Container already in running state',
                        container_id: instance.container_id
                    });
                } else {
                    console.log(`   ⏳ Container is stopped, attempting restart...`);
                    const startOutput = execSync(`docker start ${instance.container_id}`, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe']
                    });

                    console.log(`   ✅ RESTARTED successfully`);

                    // Update instance status in database
                    await pool.query(
                        `UPDATE app_instances
                         SET status = 'running', last_heartbeat_at = NOW()
                         WHERE id = $1`,
                        [instance.instance_id]
                    );

                    restartResults.push({
                        app_name: instance.app_name,
                        status: 'SUCCESS',
                        reason: 'Container restarted and running',
                        container_id: instance.container_id
                    });
                }
            } catch (error: any) {
                const errorMsg = error.message || error.toString();
                if (errorMsg.includes('No such container')) {
                    console.log(`   ❌ ERROR: Container does not exist in Docker`);
                    console.log(`   → Need to redeploy or check if container was deleted`);
                    restartResults.push({
                        app_name: instance.app_name,
                        status: 'FAILED',
                        reason: 'Container not found in Docker',
                        container_id: instance.container_id
                    });
                } else {
                    console.log(`   ❌ ERROR: ${errorMsg.split('\n')[0]}`);
                    restartResults.push({
                        app_name: instance.app_name,
                        status: 'FAILED',
                        reason: errorMsg.split('\n')[0],
                        container_id: instance.container_id
                    });
                }
            }
        }

        console.log('\n' + ''.padEnd(120, '='));
        console.log('\n📊 RESTART SUMMARY:\n');

        const successful = restartResults.filter(r => r.status === 'SUCCESS').length;
        const alreadyRunning = restartResults.filter(r => r.status === 'ALREADY_RUNNING').length;
        const failed = restartResults.filter(r => r.status === 'FAILED').length;

        console.log(`   ✅ Successfully Restarted: ${successful}`);
        console.log(`   ℹ️  Already Running: ${alreadyRunning}`);
        console.log(`   ❌ Failed to Restart: ${failed}\n`);

        for (const result of restartResults) {
            const icon = result.status === 'SUCCESS' ? '✅' : result.status === 'ALREADY_RUNNING' ? 'ℹ️' : '❌';
            console.log(`   ${icon} ${result.app_name.padEnd(40)} | ${result.reason}`);
        }

        console.log();

        // Verify restart by checking heartbeats
        console.log('⏳ Waiting 5 seconds for heartbeat updates...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));

        const verifyResult = await pool.query(
            `SELECT
                a.name,
                COUNT(CASE WHEN i.status = 'running' THEN 1 END) as running_count,
                MAX(i.last_heartbeat_at) as latest_heartbeat
            FROM apps a
            JOIN app_deployments d ON d.app_id = a.id
            JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            AND a.name IN ('Product Manager Workbench', 'QA Workbench', 'Scrum Master Workbench', 'Stakeholder Workbench')
            GROUP BY a.name
            ORDER BY a.name`,
            [orgId]
        );

        if (verifyResult.rows.length > 0) {
            console.log('✅ VERIFICATION: Current Status of Restarted Apps\n');
            for (const app of verifyResult.rows) {
                const status = app.running_count > 0 ? '🟢 RUNNING' : '🔴 STOPPED';
                const heartbeat = app.latest_heartbeat
                    ? new Date(app.latest_heartbeat).toLocaleString()
                    : 'NEVER';
                console.log(`   ${status} | ${app.name.padEnd(40)} | Latest HB: ${heartbeat}`);
            }
        }

        console.log('\n' + ''.padEnd(120, '='));

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

restartTechhead7Apps();
