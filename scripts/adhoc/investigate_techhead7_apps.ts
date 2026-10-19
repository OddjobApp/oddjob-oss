import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';

async function investigateApps() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        // Get TECHHEAD7 org
        const orgResult = await pool.query(
            "SELECT org_id as id, name FROM orgs WHERE name = 'TECHHEAD7' LIMIT 1"
        );

        if (orgResult.rows.length === 0) {
            console.log('❌ Organization TECHHEAD7 not found');
            process.exit(1);
        }

        const orgId = orgResult.rows[0].id;

        // Get detailed deployment and instance info for all apps
        console.log('🔍 Investigating TECHHEAD7 Apps Deployments\n');
        console.log(''.padEnd(120, '='));

        const detailedResult = await pool.query(
            `SELECT
                a.id as app_id,
                a.name as app_name,
                a.status as app_status,
                a.runtime_metadata as runtime_metadata,
                a.created_at as app_created,
                d.id as deployment_id,
                d.status as deployment_status,
                d.config as deployment_config,
                d.url as deployment_url,
                COUNT(i.id) as instance_count,
                MAX(CASE WHEN i.status = 'running' THEN 1 ELSE 0 END)::int as has_running,
                string_agg(DISTINCT i.status, ', ') as instance_statuses,
                MAX(i.last_heartbeat_at) as last_heartbeat
            FROM apps a
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            GROUP BY a.id, a.name, a.status, a.runtime_metadata, a.created_at, d.id, d.status, d.config, d.url
            ORDER BY a.name, a.id`,
            [orgId]
        );

        const appGroups = new Map();

        for (const row of detailedResult.rows) {
            if (!appGroups.has(row.app_id)) {
                appGroups.set(row.app_id, {
                    id: row.app_id,
                    name: row.app_name,
                    status: row.app_status,
                    runtime_metadata: row.runtime_metadata,
                    deployments: []
                });
            }

            if (row.deployment_id) {
                appGroups.get(row.app_id).deployments.push({
                    id: row.deployment_id,
                    status: row.deployment_status,
                    created: row.deployment_created,
                    updated: row.deployment_updated,
                    instance_count: row.instance_count,
                    has_running: row.has_running,
                    instance_statuses: row.instance_statuses,
                    last_heartbeat: row.last_heartbeat
                });
            }
        }

        // Print detailed report
        for (const [appId, app] of appGroups) {
            const appStatus = app.status === 'active' ? '✅' : '❌';
            console.log(`\n${appStatus} ${app.name}`);
            console.log(`   App ID: ${app.id} | Status: ${app.status}`);

            if (app.runtime_metadata) {
                const meta = app.runtime_metadata;
                console.log(`   Runtime Metadata:`);
                console.log(`     - Container ID: ${meta.containerId || 'NOT SET'}`);
                console.log(`     - Assigned Port: ${meta.assignedPort || 'NOT SET'}`);
                console.log(`     - Status: ${meta.status || 'NOT SET'}`);
            }

            if (app.deployments.length === 0) {
                console.log(`   ⚠️  NO DEPLOYMENTS FOUND`);
            } else {
                for (let i = 0; i < app.deployments.length; i++) {
                    const dep = app.deployments[i];
                    const depStatus = dep.status === 'active' ? '✅' : dep.status === 'failed' ? '❌' : '⏳';
                    console.log(`   ${depStatus} Deployment ${i + 1} (ID: ${dep.id})`);
                    console.log(`      Status: ${dep.status}`);
                    console.log(`      URL: ${dep.url || 'NOT SET'}`);
                    console.log(`      Instances: ${dep.instance_count} | Running: ${dep.has_running ? 'YES' : 'NO'}`);
                    if (dep.instance_statuses) {
                        console.log(`      Instance Statuses: ${dep.instance_statuses}`);
                    }
                    if (dep.last_heartbeat) {
                        console.log(`      Last Heartbeat: ${new Date(dep.last_heartbeat).toLocaleString()}`);
                    } else {
                        console.log(`      Last Heartbeat: NEVER`);
                    }
                }
            }
        }

        console.log('\n' + ''.padEnd(120, '=') + '\n');

        // Summary analysis
        console.log('📊 Analysis:\n');

        let totalApps = 0;
        let appsWithDeployments = 0;
        let appsWithFailedDeployments = 0;
        let appsWithNoInstances = 0;
        let appsWithStoppedInstances = 0;

        for (const [appId, app] of appGroups) {
            totalApps++;

            if (app.deployments.length > 0) {
                appsWithDeployments++;

                const latestDep = app.deployments[0];
                if (latestDep.status === 'failed') {
                    appsWithFailedDeployments++;
                } else if (latestDep.instance_count === 0) {
                    appsWithNoInstances++;
                } else if (!latestDep.has_running) {
                    appsWithStoppedInstances++;
                }
            }
        }

        console.log(`Total Apps:                    ${totalApps}`);
        console.log(`Apps with Deployments:         ${appsWithDeployments}`);
        console.log(`Apps with Failed Deployments:  ${appsWithFailedDeployments}`);
        console.log(`Apps with No Instances:        ${appsWithNoInstances}`);
        console.log(`Apps with Stopped Instances:   ${appsWithStoppedInstances}`);
        console.log();

        // Query for app telemetry and audit logs
        console.log('📋 Recent Telemetry & Audit Logs:\n');

        const telemetryResult = await pool.query(
            `SELECT
                a.name,
                at.event,
                at.level,
                at.metadata,
                at.created_at
            FROM app_telemetry at
            JOIN apps a ON a.id = at.app_id
            WHERE at.org_id = $1
            ORDER BY at.created_at DESC
            LIMIT 50`,
            [orgId]
        );

        if (telemetryResult.rows.length > 0) {
            console.log('Recent Events:');
            for (const event of telemetryResult.rows) {
                const timestamp = new Date(event.created_at).toLocaleString();
                console.log(`  [${event.level.toUpperCase()}] ${event.name}: ${event.event} at ${timestamp}`);
                if (Object.keys(event.metadata).length > 0) {
                    console.log(`       Metadata: ${JSON.stringify(event.metadata)}`);
                }
            }
        } else {
            console.log('No telemetry events found.');
        }

        console.log();

        const auditResult = await pool.query(
            `SELECT
                a.name,
                aal.finding_type,
                aal.severity,
                aal.description,
                aal.recommendation,
                aal.created_at
            FROM app_audit_logs aal
            JOIN apps a ON a.id = aal.app_id
            WHERE aal.org_id = $1
            ORDER BY aal.created_at DESC
            LIMIT 20`,
            [orgId]
        );

        if (auditResult.rows.length > 0) {
            console.log('Recent Audit Findings:');
            for (const audit of auditResult.rows) {
                const timestamp = new Date(audit.created_at).toLocaleString();
                console.log(`  [${audit.severity.toUpperCase()}] ${audit.name}: ${audit.finding_type}`);
                console.log(`       Description: ${audit.description}`);
                if (audit.recommendation) {
                    console.log(`       Recommendation: ${audit.recommendation}`);
                }
                console.log(`       Found: ${timestamp}`);
            }
        } else {
            console.log('No audit logs found.');
        }

        console.log('\n' + ''.padEnd(120, '='));
        console.log('\n💡 Recommendations:\n');

        if (appsWithFailedDeployments > 0) {
            console.log(`❌ ${appsWithFailedDeployments} app(s) have FAILED deployments`);
            console.log('   → Check deployment logs for error details');
            console.log('   → Redeploy or fix the deployment issues\n');
        }

        if (appsWithNoInstances > 0) {
            console.log(`🔴 ${appsWithNoInstances} app(s) have NO INSTANCES created`);
            console.log('   → Deployment may have succeeded but instance creation failed');
            console.log('   → Check Docker/container service status');
            console.log('   → Check resource availability (disk, memory, ports)\n');
        }

        if (appsWithStoppedInstances > 0) {
            console.log(`🔴 ${appsWithStoppedInstances} app(s) have STOPPED instances`);
            console.log('   → Instances exist but are not running');
            console.log('   → Check container logs for crash reasons');
            console.log('   → Restart instances or investigate startup errors\n');
        }

    } catch (error: any) {
        console.error('ERROR:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('Unable to connect to database. Make sure PostgreSQL is running.');
        }
        process.exit(1);
    } finally {
        await pool.end();
    }
}

investigateApps();
