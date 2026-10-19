import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';

async function deployUndeployedApps() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🚀 Deploying Never-Deployed TECHHEAD7 Apps\n');
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

        // Get undeployed apps with their runtime metadata
        const undeployedResult = await pool.query(
            `SELECT
                a.id as app_id,
                a.name as app_name,
                a.runtime_metadata,
                d.id as deployment_id,
                d.config as deployment_config
            FROM apps a
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            GROUP BY a.id, a.name, a.runtime_metadata, d.id, d.config
            HAVING COUNT(i.id) = 0
            ORDER BY a.name`,
            [orgId]
        );

        if (undeployedResult.rows.length === 0) {
            console.log('✅ All TECHHEAD7 apps have been deployed');
            process.exit(0);
        }

        console.log(`Preparing to deploy ${undeployedResult.rows.length} app(s)...\n`);

        const deploymentResults: any[] = [];

        for (const app of undeployedResult.rows) {
            console.log(`\n📦 ${app.app_name}`);

            try {
                const runtimeMeta = app.runtime_metadata || {};
                const deploymentConfig = app.deployment_config || {};

                // Get assigned port from runtime metadata
                const assignedPort = runtimeMeta.assignedPort;
                const blueprintSlug = runtimeMeta.cycleApp?.blueprint || 'default-app';

                console.log(`   App ID: ${app.app_id}`);
                console.log(`   Deployment ID: ${app.deployment_id}`);
                console.log(`   Assigned Port: ${assignedPort || 'NOT SET'}`);
                console.log(`   Blueprint: ${blueprintSlug}`);

                if (!assignedPort) {
                    console.log(`   ❌ ERROR: No assigned port in runtime metadata`);
                    console.log(`   → Cannot deploy without port assignment`);
                    deploymentResults.push({
                        app_name: app.app_name,
                        status: 'FAILED',
                        reason: 'No assigned port'
                    });
                    continue;
                }

                // Check if port is already in use by another container
                console.log(`   🔍 Checking if port ${assignedPort} is available...`);

                const portCheckResult = await pool.query(
                    `SELECT COUNT(*)::int as count FROM app_instances
                     WHERE port = $1 AND app_id != $2 AND status = 'running'`,
                    [assignedPort, app.app_id]
                );

                if (portCheckResult.rows[0].count > 0) {
                    console.log(`   ❌ ERROR: Port ${assignedPort} is already in use by another app`);
                    deploymentResults.push({
                        app_name: app.app_name,
                        status: 'FAILED',
                        reason: 'Port already in use'
                    });
                    continue;
                }

                console.log(`   ✅ Port ${assignedPort} is available`);

                // Update deployment config with required fields
                const updatedConfig = {
                    ...deploymentConfig,
                    image: deploymentConfig.image || `oddjob-app/${app.app_name}:v1`,
                    port: assignedPort,
                    env: {
                        ...deploymentConfig.env,
                        ODDJOB_APP_ID: String(app.app_id),
                        ODDJOB_ORG_ID: String(orgId),
                        PORT: String(assignedPort)
                    }
                };

                // Update deployment config
                console.log(`   📝 Updating deployment configuration...`);
                await pool.query(
                    `UPDATE app_deployments
                     SET config = $1, status = 'ready'
                     WHERE id = $2`,
                    [JSON.stringify(updatedConfig), app.deployment_id]
                );

                console.log(`   ✅ Deployment config updated`);

                // Create instance record
                console.log(`   📦 Creating instance record...`);
                const instanceResult = await pool.query(
                    `INSERT INTO app_instances (deployment_id, port, status, created_at, updated_at)
                     VALUES ($1, $2, 'pending', NOW(), NOW())
                     RETURNING id`,
                    [app.deployment_id, assignedPort]
                );

                const instanceId = instanceResult.rows[0].id;
                console.log(`   ✅ Instance ${instanceId} created with port ${assignedPort}`);

                // In a real scenario, this would trigger the docker-bridge service
                // For now, we'll just mark it as ready for deployment
                console.log(`   ⏳ Ready for Docker container deployment`);
                console.log(`   → Next step: Call Docker deployment service`);

                deploymentResults.push({
                    app_name: app.app_name,
                    status: 'PREPARED',
                    instanceId,
                    port: assignedPort,
                    reason: 'Instance created, ready for Docker deployment'
                });

            } catch (error: any) {
                console.log(`   ❌ ERROR: ${error.message}`);
                deploymentResults.push({
                    app_name: app.app_name,
                    status: 'FAILED',
                    reason: error.message
                });
            }
        }

        // Summary
        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n📊 DEPLOYMENT SUMMARY:\n');

        const prepared = deploymentResults.filter(r => r.status === 'PREPARED').length;
        const failed = deploymentResults.filter(r => r.status === 'FAILED').length;

        console.log(`   ✅ Prepared for Deployment: ${prepared}`);
        console.log(`   ❌ Failed: ${failed}\n`);

        for (const result of deploymentResults) {
            const icon = result.status === 'PREPARED' ? '✅' : '❌';
            console.log(`   ${icon} ${result.app_name.padEnd(40)} | ${result.reason}`);
        }

        if (prepared > 0) {
            console.log('\n📌 NEXT STEP: Trigger Docker container creation\n');
            console.log('   For each prepared app, the docker-bridge service should:');
            console.log('   1. Pull the image (if needed)');
            console.log('   2. Run the container with port mapping');
            console.log('   3. Update instance status to "running"');
            console.log('   4. Record container_id in database');
            console.log(`\n   Command (pseudo-code):`);
            console.log(`   const result = await dockerBridgeService.runContainer({`);
            console.log(`     image: "oddjob-app/<app-name>:v1",`);
            console.log(`     name: "oddjob-app-<app-slug>-org291-<port>",`);
            console.log(`     portMappings: { [port]: 3000 },`);
            console.log(`     restartPolicy: "unless-stopped"`);
            console.log(`   });`);
        }

        console.log('\n' + ''.padEnd(140, '='));

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

deployUndeployedApps();
