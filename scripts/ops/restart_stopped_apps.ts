import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function restartStoppedApps() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🚀 RESTARTING 4 STOPPED TECHHEAD7 APPS\n');
        console.log(''.padEnd(140, '='));

        const orgResult = await pool.query(
            "SELECT org_id as id FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        const orgId = orgResult.rows[0].id;

        // Get the 4 stopped apps
        const stoppedApps = [
            { name: 'Product Manager Workbench', port: 10021, slug: 'pm-workbench' },
            { name: 'QA Workbench', port: 10017, slug: 'qa-workbench' },
            { name: 'Scrum Master Workbench', port: 10002, slug: 'scrum-master-workbench' },
            { name: 'Stakeholder Workbench', port: 10018, slug: 'stakeholder-workbench' }
        ];

        console.log(`Found ${stoppedApps.length} stopped app(s) to restart\n`);

        let successCount = 0;
        let failureCount = 0;

        for (const app of stoppedApps) {
            console.log(`\n📦 ${app.name}`);
            console.log(`   Port: ${app.port}`);

            try {
                // Check if there's an existing container to restart
                const cleanSlug = app.slug.replace(/-org291$/, '').trim();
                const containerName = `oddjob-app-${cleanSlug}-org291-${app.port}`;

                console.log(`   🔍 Checking for existing container...`);

                try {
                    // Try to restart existing container
                    execSync(`docker start ${containerName}`, {
                        stdio: ['pipe', 'pipe', 'pipe'],
                        timeout: 30000
                    });

                    console.log(`   ✅ Container started: ${containerName}`);

                    // Update database
                    await pool.query(
                        `UPDATE app_instances
                         SET status = 'running', last_heartbeat_at = NOW()
                         WHERE id IN (
                           SELECT i.id FROM app_instances i
                           JOIN app_deployments d ON i.deployment_id = d.id
                           JOIN apps a ON d.app_id = a.id
                           WHERE a.organization_id = $1 AND a.name = $2
                         )`,
                        [orgId, app.name]
                    );

                    console.log(`   ✅ Database updated`);
                    successCount++;

                } catch (startError: any) {
                    if (startError.message.includes('No such container')) {
                        console.log(`   ⚠️  Container doesn't exist, creating new one...`);

                        // Get the app ID first
                        const appResult = await pool.query(
                            'SELECT id FROM apps WHERE organization_id = $1 AND name = $2',
                            [orgId, app.name]
                        );

                        if (appResult.rows.length === 0) {
                            console.log(`   ❌ App not found in database`);
                            failureCount++;
                            continue;
                        }

                        const appId = appResult.rows[0].id;

                        // Create new container
                        const dockerCmd = `docker run -d --name ${containerName} -p ${app.port}:3000 -e ODDJOB_APP_ID=${appId} -e ODDJOB_ORG_ID=${orgId} -e PORT=${app.port} -e APP_NAME="${app.name}" --restart unless-stopped oddjob-dev-base:latest`;

                        const output = execSync(dockerCmd, {
                            encoding: 'utf-8',
                            stdio: ['pipe', 'pipe', 'pipe'],
                            timeout: 60000
                        });

                        const containerId = output.trim();
                        console.log(`   ✅ New container created: ${containerId.substring(0, 12)}`);

                        // Update database
                        await pool.query(
                            `UPDATE app_instances
                             SET container_id = $1, status = 'running', last_heartbeat_at = NOW()
                             WHERE id IN (
                               SELECT i.id FROM app_instances i
                               JOIN app_deployments d ON i.deployment_id = d.id
                               JOIN apps a ON d.app_id = a.id
                               WHERE a.organization_id = $2 AND a.name = $3
                             )`,
                            [containerId, orgId, app.name]
                        );

                        console.log(`   ✅ Database updated`);
                        successCount++;
                    } else {
                        throw startError;
                    }
                }

            } catch (error: any) {
                console.log(`   ❌ Failed: ${error.message.split('\n')[0].substring(0, 80)}`);
                failureCount++;
            }
        }

        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n📊 RESTART SUMMARY:\n');

        console.log(`   ✅ Successfully Restarted: ${successCount}`);
        console.log(`   ❌ Failed: ${failureCount}\n`);

        // Verify
        console.log('🔍 Verifying running containers...\n');
        const containers = execSync('docker ps --filter "name=org291" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"', {
            encoding: 'utf-8'
        });

        const runningLines = containers.split('\n').filter(l => l.includes('org291') && (l.includes('Up') || l.includes('10')));
        console.log(`Found ${runningLines.length} running org291 containers:\n`);
        runningLines.forEach(line => console.log('   ' + line));

        console.log('\n' + ''.padEnd(140, '='));

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

restartStoppedApps();
