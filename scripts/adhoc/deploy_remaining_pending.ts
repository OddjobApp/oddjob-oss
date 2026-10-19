import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function deployRemaining() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🚀 DEPLOYING REMAINING 2 PENDING APPS\n');
        console.log(''.padEnd(140, '='));

        const orgResult = await pool.query(
            "SELECT org_id as id FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        if (orgResult.rows.length === 0) {
            console.error('❌ Organization TECHHEAD7 not found');
            process.exit(1);
        }

        const orgId = orgResult.rows[0].id;

        // Get Procurement and Research apps specifically
        const result = await pool.query(
            `SELECT DISTINCT ON (a.id)
                a.id as app_id,
                a.name as app_name,
                a.slug as app_slug,
                i.id as instance_id,
                i.port,
                i.status,
                i.container_id
            FROM apps a
            JOIN app_deployments d ON d.app_id = a.id
            JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            AND a.name IN ('Procurement Management Portal', 'Research & RFC Synthesis Portal')
            ORDER BY a.id`,
            [orgId]
        );

        console.log(`Found ${result.rows.length} app(s) to deploy\n`);

        if (result.rows.length === 0) {
            console.log('No apps found to deploy');
            process.exit(0);
        }

        const deploymentResults: any[] = [];
        let successCount = 0;

        for (const app of result.rows) {
            console.log(`\n📦 ${app.app_name}`);
            console.log(`   Status: ${app.status}`);
            console.log(`   Port: ${app.port}`);
            console.log(`   Instance ID: ${app.instance_id}`);
            console.log(`   Container: ${app.container_id}`);

            // Check if container already exists
            try {
                const checkCmd = `docker ps -a --filter "name=${app.container_id}" --format "{{.ID}}"`;
                const existing = execSync(checkCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

                if (existing) {
                    console.log(`   ✅ Container already exists, starting...`);
                    try {
                        execSync(`docker start ${app.container_id}`, { stdio: ['pipe', 'pipe', 'pipe'] });
                        console.log(`   ✅ Container started`);

                        // Update database
                        await pool.query(
                            `UPDATE app_instances SET status = 'running', last_heartbeat_at = NOW() WHERE id = $1`,
                            [app.instance_id]
                        );

                        deploymentResults.push({
                            app_name: app.app_name,
                            status: 'STARTED',
                            port: app.port
                        });

                        successCount++;
                    } catch (e: any) {
                        console.log(`   ⚠️  Could not start container: ${e.message.split('\n')[0].substring(0, 60)}`);
                    }
                } else {
                    console.log(`   🔧 Creating new container...`);

                    const cleanSlug = app.app_slug.replace(/org291/g, '').replace(/-+$/, '').trim();
                    const containerName = `oddjob-app-${cleanSlug}-org291-${app.port}`;

                    const dockerCmd = `docker run -d --name ${containerName} -p ${app.port}:3000 -e ODDJOB_APP_ID=${app.app_id} -e ODDJOB_ORG_ID=${orgId} -e PORT=${app.port} -e APP_NAME="${app.app_name}" --restart unless-stopped oddjob-dev-base:latest`;

                    try {
                        const output = execSync(dockerCmd, {
                            encoding: 'utf-8',
                            stdio: ['pipe', 'pipe', 'pipe'],
                            timeout: 60000
                        });

                        const containerId = output.trim();
                        console.log(`   ✅ Container created: ${containerId.substring(0, 12)}`);

                        await pool.query(
                            `UPDATE app_instances SET container_id = $1, status = 'running', last_heartbeat_at = NOW() WHERE id = $2`,
                            [containerId, app.instance_id]
                        );

                        console.log(`   ✅ Database updated`);

                        deploymentResults.push({
                            app_name: app.app_name,
                            status: 'CREATED',
                            port: app.port,
                            container_id: containerId.substring(0, 12)
                        });

                        successCount++;
                    } catch (dockerError: any) {
                        console.log(`   ❌ Failed: ${dockerError.message.split('\n')[0].substring(0, 80)}`);
                    }
                }
            } catch (error: any) {
                console.log(`   ❌ Error: ${error.message.split('\n')[0].substring(0, 80)}`);
            }
        }

        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n📊 SUMMARY:\n');

        console.log(`   ✅ Successfully Deployed: ${successCount}/${result.rows.length}\n`);

        for (const result of deploymentResults) {
            const icon = result.status === 'CREATED' ? '✅' : '✅';
            console.log(`   ${icon} ${result.app_name.padEnd(40)} | Port ${result.port}`);
        }

        console.log('\n' + ''.padEnd(140, '='));

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

deployRemaining();
