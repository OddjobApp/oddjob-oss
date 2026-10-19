import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';
import { execSync } from 'child_process';

async function reassignAndDeploy() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🔄 REASSIGNING PORTS AND DEPLOYING APPS\n');
        console.log(''.padEnd(140, '='));

        const orgResult = await pool.query(
            "SELECT org_id as id FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        const orgId = orgResult.rows[0].id;

        // Get the 2 pending apps (Procurement and Research)
        const appsToUpdate = [
            { name: 'Procurement Management Portal', oldPort: 10529, newPort: 10630 },
            { name: 'Research & RFC Synthesis Portal', oldPort: 10528, newPort: 10631 }
        ];

        console.log('🔧 Updating ports in database...\n');

        for (const app of appsToUpdate) {
            console.log(`${app.name}`);
            console.log(`  Old Port: ${app.oldPort} → New Port: ${app.newPort}`);

            // Update app instance port
            const result = await pool.query(
                `UPDATE app_instances
                 SET port = $1
                 WHERE id IN (
                   SELECT i.id FROM app_instances i
                   JOIN app_deployments d ON i.deployment_id = d.id
                   JOIN apps a ON d.app_id = a.id
                   WHERE a.organization_id = $2 AND a.name = $3
                 )
                 RETURNING id`,
                [app.newPort, orgId, app.name]
            );

            if (result.rows.length > 0) {
                console.log(`  ✅ Updated instance(s): ${result.rows.map((r: any) => r.id).join(', ')}`);
            } else {
                console.log(`  ⚠️  No instances found`);
            }

            console.log();
        }

        console.log(''.padEnd(140, '='));
        console.log('\n🚀 DEPLOYING CONTAINERS WITH NEW PORTS\n');

        // Remove old failed containers
        console.log('Removing old containers...');
        try {
            execSync('docker rm -f oddjob-app-procurement-org291-10529', { stdio: ['pipe', 'pipe', 'pipe'] });
            console.log('  ✅ Removed old Procurement container');
        } catch (e) {}

        try {
            execSync('docker rm -f oddjob-app-research-org291-10528', { stdio: ['pipe', 'pipe', 'pipe'] });
            console.log('  ✅ Removed old Research container');
        } catch (e) {}

        console.log();

        // Deploy Procurement on new port
        console.log('📦 Deploying Procurement Management Portal (port 10630)');
        try {
            const procOutput = execSync(
                `docker run -d --name oddjob-app-procurement-org291-10630 -p 10630:3000 -e ODDJOB_APP_ID=494 -e ODDJOB_ORG_ID=291 -e PORT=10630 -e APP_NAME="Procurement Management Portal" --restart unless-stopped oddjob-dev-base:latest`,
                { encoding: 'utf-8', timeout: 60000 }
            );
            const procId = procOutput.trim();
            console.log(`  ✅ Container created: ${procId.substring(0, 12)}`);

            // Update database with container ID
            await pool.query(
                `UPDATE app_instances
                 SET container_id = $1, status = 'running', last_heartbeat_at = NOW()
                 WHERE id IN (
                   SELECT i.id FROM app_instances i
                   JOIN app_deployments d ON i.deployment_id = d.id
                   JOIN apps a ON d.app_id = a.id
                   WHERE a.organization_id = $2 AND a.name = 'Procurement Management Portal'
                 )`,
                [procId, orgId]
            );
            console.log(`  ✅ Database updated`);
        } catch (e: any) {
            console.log(`  ❌ Failed: ${e.message.split('\n')[0].substring(0, 80)}`);
        }

        console.log();

        // Deploy Research on new port
        console.log('📦 Deploying Research & RFC Synthesis Portal (port 10631)');
        try {
            const resOutput = execSync(
                `docker run -d --name oddjob-app-research-org291-10631 -p 10631:3000 -e ODDJOB_APP_ID=467 -e ODDJOB_ORG_ID=291 -e PORT=10631 -e APP_NAME="Research & RFC Synthesis Portal" --restart unless-stopped oddjob-dev-base:latest`,
                { encoding: 'utf-8', timeout: 60000 }
            );
            const resId = resOutput.trim();
            console.log(`  ✅ Container created: ${resId.substring(0, 12)}`);

            // Update database with container ID
            await pool.query(
                `UPDATE app_instances
                 SET container_id = $1, status = 'running', last_heartbeat_at = NOW()
                 WHERE id IN (
                   SELECT i.id FROM app_instances i
                   JOIN app_deployments d ON i.deployment_id = d.id
                   JOIN apps a ON d.app_id = a.id
                   WHERE a.organization_id = $2 AND a.name = 'Research & RFC Synthesis Portal'
                 )`,
                [resId, orgId]
            );
            console.log(`  ✅ Database updated`);
        } catch (e: any) {
            console.log(`  ❌ Failed: ${e.message.split('\n')[0].substring(0, 80)}`);
        }

        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n✅ DEPLOYMENT COMPLETE\n');

        // Verify
        console.log('🔍 Verifying running containers...\n');
        const containers = execSync('docker ps --filter "name=org291" --format "table {{.Names}}\t{{.Ports}}"', {
            encoding: 'utf-8'
        });
        console.log(containers);

        console.log(''.padEnd(140, '='));

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

reassignAndDeploy();
