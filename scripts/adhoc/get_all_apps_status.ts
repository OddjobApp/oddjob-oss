import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';

async function getAllAppsStatus() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🔍 Fetching ALL APPS Status Across Organizations\n');
        console.log(''.padEnd(140, '='));

        // Get all apps with their organization info and deployment status
        const result = await pool.query(
            `SELECT
                o.name as org_name,
                a.id as app_id,
                a.name as app_name,
                a.status as app_status,
                COUNT(DISTINCT d.id) as deployment_count,
                COUNT(DISTINCT CASE WHEN i.status = 'running' THEN i.id END)::int as running_instances,
                MAX(i.last_heartbeat_at) as last_heartbeat,
                COUNT(DISTINCT i.id)::int as total_instances
            FROM apps a
            JOIN orgs o ON o.org_id = a.organization_id
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            GROUP BY o.name, a.id, a.name, a.status
            ORDER BY o.name, a.name`
        );

        if (result.rows.length === 0) {
            console.log('❌ No apps found in any organization\n');
            process.exit(0);
        }

        // Group by organization
        const appsByOrg = new Map<string, any[]>();
        for (const row of result.rows) {
            if (!appsByOrg.has(row.org_name)) {
                appsByOrg.set(row.org_name, []);
            }
            appsByOrg.get(row.org_name)!.push(row);
        }

        let totalApps = 0;
        let runningApps = 0;
        let stoppedApps = 0;
        let inactiveApps = 0;

        // Display by organization
        for (const [orgName, apps] of appsByOrg) {
            console.log(`\n📦 Organization: ${orgName}`);
            console.log(''.padEnd(140, '─'));

            for (const app of apps) {
                totalApps++;
                const statusIcon = app.app_status === 'active' ? '✅' : '❌';
                const operationalIcon = (app.running_instances || 0) > 0 ? '🟢' : '🔴';
                const lastHeartbeat = app.last_heartbeat
                    ? new Date(app.last_heartbeat).toLocaleString()
                    : 'NEVER';

                const appName = app.app_name.substring(0, 35).padEnd(35);

                if (app.app_status !== 'active') {
                    inactiveApps++;
                } else if ((app.running_instances || 0) > 0) {
                    runningApps++;
                } else {
                    stoppedApps++;
                }

                console.log(
                    `  ${statusIcon} ${operationalIcon} ${appName} | ` +
                    `Status: ${app.app_status.padEnd(8)} | ` +
                    `Instances: ${String(app.running_instances || 0).padStart(1)}/${String(app.total_instances || 0)} | ` +
                    `Last Heartbeat: ${lastHeartbeat}`
                );
            }
        }

        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n📊 OVERALL SUMMARY:\n');
        console.log(`   Total Apps:              ${totalApps}`);
        console.log(`   🟢 Running & Active:     ${runningApps}`);
        console.log(`   🔴 Stopped (Active):     ${stoppedApps}`);
        console.log(`   ❌ Inactive:             ${inactiveApps}`);
        console.log(`\n   Health Score:            ${Math.round((runningApps / (totalApps > 0 ? totalApps : 1)) * 100)}% operational`);
        console.log();

        // Get detailed stats by org
        console.log('📈 Organization Stats:\n');

        for (const [orgName, apps] of appsByOrg) {
            const orgRunning = apps.filter(a => (a.running_instances || 0) > 0).length;
            const orgTotal = apps.length;
            const percentage = Math.round((orgRunning / orgTotal) * 100);

            const healthIcon = percentage === 100 ? '✅' : percentage >= 75 ? '⚠️' : '❌';
            console.log(`  ${healthIcon} ${orgName.padEnd(25)} | ${orgRunning}/${orgTotal} running (${percentage}%)`);
        }

        console.log();

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

getAllAppsStatus();
