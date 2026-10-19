import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';

async function assignPortsAndDeploy() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🔌 Assigning Ports to Never-Deployed TECHHEAD7 Apps\n');
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

        // Find the highest currently used port in TECHHEAD7
        const maxPortResult = await pool.query(
            `SELECT MAX(CAST(port AS INTEGER))::int as max_port
             FROM app_instances i
             INNER JOIN app_deployments d ON i.deployment_id = d.id
             INNER JOIN apps a ON d.app_id = a.id
             WHERE a.organization_id = $1`,
            [orgId]
        );

        let nextAvailablePort = (maxPortResult.rows[0].max_port || 10500) + 1;

        console.log(`Current highest port in TECHHEAD7: ${maxPortResult.rows[0].max_port || 'none'}`);
        console.log(`Next available port: ${nextAvailablePort}\n`);

        // Get undeployed apps (no instances)
        const undeployedResult = await pool.query(
            `SELECT DISTINCT ON (a.id)
                a.id as app_id,
                a.name as app_name,
                a.runtime_metadata,
                d.id as deployment_id
            FROM apps a
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            AND i.id IS NULL
            ORDER BY a.id, d.id DESC`,
            [orgId]
        );

        if (undeployedResult.rows.length === 0) {
            console.log('✅ All TECHHEAD7 apps have been deployed');
            process.exit(0);
        }

        console.log(`Found ${undeployedResult.rows.length} undeployed app(s)\n`);

        const deploymentResults: any[] = [];
        const portsToAssign: Array<{ appId: number; appName: string; deploymentId: number; port: number }> = [];

        // Assign ports to all undeployed apps
        for (const app of undeployedResult.rows) {
            const port = nextAvailablePort++;
            portsToAssign.push({
                appId: app.app_id,
                appName: app.app_name,
                deploymentId: app.deployment_id,
                port
            });
        }

        // Update runtime_metadata with assigned ports
        for (const assignment of portsToAssign) {
            console.log(`📍 ${assignment.appName}`);
            console.log(`   Assigning port: ${assignment.port}`);

            try {
                // Get current runtime metadata
                const currentMeta = await pool.query(
                    `SELECT runtime_metadata FROM apps WHERE id = $1`,
                    [assignment.appId]
                );

                const meta = currentMeta.rows[0].runtime_metadata || {};
                meta.assignedPort = assignment.port;
                meta.launchedAt = new Date().toISOString();

                // Update app runtime metadata
                await pool.query(
                    `UPDATE apps
                     SET runtime_metadata = $1, updated_at = NOW()
                     WHERE id = $2`,
                    [JSON.stringify(meta), assignment.appId]
                );

                console.log(`   ✅ Port assigned to app runtime metadata`);

                // Create instance record with pending container ID
                console.log(`   📦 Creating instance record...`);
                const containerIdPlaceholder = `oddjob-app-pending-org291-${assignment.port}`;
                const instanceResult = await pool.query(
                    `INSERT INTO app_instances (
                        deployment_id,
                        container_id,
                        port,
                        status,
                        created_at,
                        updated_at
                    ) VALUES ($1, $2, $3, 'pending', NOW(), NOW())
                    RETURNING id`,
                    [assignment.deploymentId, containerIdPlaceholder, assignment.port]
                );

                const instanceId = instanceResult.rows[0].id;
                console.log(`   ✅ Instance ${instanceId} created\n`);

                deploymentResults.push({
                    app_name: assignment.appName,
                    app_id: assignment.appId,
                    port: assignment.port,
                    instance_id: instanceId,
                    status: 'PREPARED'
                });

            } catch (error: any) {
                console.log(`   ❌ ERROR: ${error.message}\n`);
                deploymentResults.push({
                    app_name: assignment.appName,
                    app_id: assignment.appId,
                    port: assignment.port,
                    status: 'FAILED',
                    error: error.message
                });
            }
        }

        // Summary
        console.log(''.padEnd(140, '='));
        console.log('\n📊 PORT ASSIGNMENT & DEPLOYMENT PREP SUMMARY:\n');

        const successful = deploymentResults.filter(r => r.status === 'PREPARED').length;
        const failed = deploymentResults.filter(r => r.status === 'FAILED').length;

        console.log(`   ✅ Successfully Prepared: ${successful}`);
        console.log(`   ❌ Failed: ${failed}\n`);

        for (const result of deploymentResults) {
            const icon = result.status === 'PREPARED' ? '✅' : '❌';
            const portInfo = result.port ? `Port ${result.port}` : 'No port';
            console.log(`   ${icon} ${result.app_name.padEnd(40)} | ${portInfo}`);
        }

        if (successful > 0) {
            console.log(`\n✅ Port assignment complete!\n`);
            console.log(`📌 NEXT STEPS:\n`);
            console.log(`   1. Verify new app configuration:`);
            for (const result of deploymentResults.filter(r => r.status === 'PREPARED')) {
                console.log(`      - ${result.app_name}: Port ${result.port}`);
            }
            console.log(`\n   2. Trigger Docker deployment:`);
            console.log(`      npx tsx create_containers_for_undeployed.ts\n`);
            console.log(`   3. Verify containers are running:`);
            console.log(`      docker ps | grep org291\n`);
            console.log(`   4. Check app heartbeats (should update within 1 minute):`);
            console.log(`      npx tsx check_techhead7_runtime.ts`);
        }

        console.log('\n' + ''.padEnd(140, '='));

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

assignPortsAndDeploy();
