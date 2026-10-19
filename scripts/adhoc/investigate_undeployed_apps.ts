import dotenv from 'dotenv';
dotenv.config({ override: true });

import { Pool } from 'pg';

async function investigateUndeployed() {
    if (!process.env.DATABASE_URL) {
        console.error('ERROR: DATABASE_URL not set');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log('🔍 Investigating Never-Deployed TECHHEAD7 Apps\n');
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

        // Get apps with NO instances
        const undeployedResult = await pool.query(
            `SELECT
                a.id,
                a.name,
                a.status as app_status,
                a.runtime_metadata,
                a.created_at,
                d.id as deployment_id,
                d.status as deployment_status,
                d.config as deployment_config,
                COUNT(i.id)::int as instance_count
            FROM apps a
            LEFT JOIN app_deployments d ON d.app_id = a.id
            LEFT JOIN app_instances i ON i.deployment_id = d.id
            WHERE a.organization_id = $1
            GROUP BY a.id, a.name, a.status, a.runtime_metadata, a.created_at, d.id, d.status, d.config
            HAVING COUNT(i.id) = 0  -- No instances
            ORDER BY a.name`,
            [orgId]
        );

        if (undeployedResult.rows.length === 0) {
            console.log('✅ All TECHHEAD7 apps have been deployed (have instances)');
            process.exit(0);
        }

        console.log(`Found ${undeployedResult.rows.length} never-deployed app(s)\n`);

        // Group by app
        const appsMap = new Map();
        for (const row of undeployedResult.rows) {
            const key = row.id;
            if (!appsMap.has(key)) {
                appsMap.set(key, {
                    id: row.id,
                    name: row.name,
                    app_status: row.app_status,
                    runtime_metadata: row.runtime_metadata,
                    created_at: row.created_at,
                    deployments: []
                });
            }

            if (row.deployment_id) {
                appsMap.get(key).deployments.push({
                    id: row.deployment_id,
                    status: row.deployment_status,
                    config: row.deployment_config,
                    instance_count: row.instance_count
                });
            }
        }

        // Analyze each undeployed app
        for (const [appId, app] of appsMap) {
            console.log(`\n📦 ${app.name}`);
            console.log(`   App ID: ${app.id}`);
            console.log(`   App Status: ${app.app_status}`);
            console.log(`   Created: ${new Date(app.created_at).toLocaleString()}`);

            if (app.deployments.length === 0) {
                console.log(`   ❌ NO DEPLOYMENTS FOUND`);
                console.log(`   → Application has never been deployed`);
                console.log(`   → Need to trigger initial deployment via app forge or deployment API`);
            } else {
                for (const dep of app.deployments) {
                    console.log(`\n   Deployment ${dep.id}`);
                    console.log(`     Status: ${dep.status}`);
                    console.log(`     Instances: ${dep.instance_count}`);

                    if (dep.config) {
                        console.log(`     Configuration:`);
                        const config = typeof dep.config === 'string' ? JSON.parse(dep.config) : dep.config;
                        console.log(`       Image: ${config.image || 'NOT SET'}`);
                        console.log(`       Port: ${config.port || 'NOT SET'}`);
                        console.log(`       Environment: ${config.env ? Object.keys(config.env).length : 0} vars`);

                        if (dep.status === 'failed') {
                            console.log(`       ⚠️  Deployment FAILED`);
                            console.log(`       Error: ${config.error || 'No error message'}`);
                        } else if (dep.status === 'pending') {
                            console.log(`       ⏳ Deployment PENDING - may still be in progress`);
                        } else if (dep.status === 'active') {
                            console.log(`       ✅ Deployment ACTIVE but no instances created`);
                            console.log(`       → Instance creation may have failed`);
                            console.log(`       → Check Docker logs or deployment service logs`);
                        }
                    }
                }
            }

            console.log(`\n   🔧 Remediation:`);
            if (app.deployments.length === 0) {
                console.log(`     1. Trigger initial deployment via app forge API`);
                console.log(`     2. Monitor job status`);
                console.log(`     3. Verify instances are created`);
            } else if (app.deployments.some((d: any) => d.status === 'failed')) {
                console.log(`     1. Fix deployment configuration`);
                console.log(`     2. Create new deployment`);
                console.log(`     3. Monitor instance creation`);
            } else if (app.deployments.some((d: any) => d.status === 'active')) {
                console.log(`     1. Check Docker daemon logs`);
                console.log(`     2. Check deployment service logs`);
                console.log(`     3. Verify disk space and resources`);
                console.log(`     4. Retry deployment or create new one`);
            }
        }

        console.log('\n' + ''.padEnd(140, '='));
        console.log('\n💡 Summary:\n');

        const noDeployments = Array.from(appsMap.values()).filter(a => a.deployments.length === 0).length;
        const failedDeployments = Array.from(appsMap.values()).filter(a =>
            a.deployments.some((d: any) => d.status === 'failed')
        ).length;
        const pendingDeployments = Array.from(appsMap.values()).filter(a =>
            a.deployments.some((d: any) => d.status === 'pending')
        ).length;
        const activeNoInstances = Array.from(appsMap.values()).filter(a =>
            a.deployments.some((d: any) => d.status === 'active' && d.instance_count === 0)
        ).length;

        console.log(`   Apps with no deployments: ${noDeployments}`);
        console.log(`   Apps with failed deployments: ${failedDeployments}`);
        console.log(`   Apps with pending deployments: ${pendingDeployments}`);
        console.log(`   Apps with active deployments but no instances: ${activeNoInstances}\n`);

        // Specific recommendations
        if (noDeployments > 0) {
            console.log(`📌 ACTION: Deploy ${noDeployments} app(s) that have never been deployed`);
            console.log(`   Command: POST /api/apps/{appId}/forge`);
            console.log(`   Body: { "blueprintSlug": "...", "options": {...} }\n`);
        }

        if (failedDeployments > 0) {
            console.log(`📌 ACTION: Fix and retry ${failedDeployments} failed deployment(s)\n`);
        }

        if (activeNoInstances > 0) {
            console.log(`📌 ACTION: Investigate ${activeNoInstances} app(s) with active deployment but no instances\n`);
        }

    } catch (error: any) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

investigateUndeployed();
