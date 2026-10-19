import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';
const TEST_ORG_ID = 1;

let authToken = null;
let csrfToken = null;

async function login() {
    if (authToken) return authToken;
    try {
        console.log('  Authenticating...');
        const response = await fetch(`${BASE_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'admin@example.com',
                password: 'password123'
            })
        });
        if (!response.ok) {
            const text = await response.text();
            console.log(`  Login failed: ${text}`);
            return null;
        }
        const cookies = response.headers.get('set-cookie');
        authToken = cookies;
        
        try {
            const csrfResp = await fetch(`${BASE_URL}/api/csrf-token`, {
                headers: { 'Cookie': authToken }
            });
            if (csrfResp.ok) {
                const csrfData = await csrfResp.json();
                csrfToken = csrfData.csrfToken;
            }
        } catch (e) {}
        
        console.log('  ✓ Authenticated');
        return authToken;
    } catch (e) {
        console.log(`  Auth error: ${e.message}`);
        return null;
    }
}

async function apiCall(endpoint, method = 'GET', body = null) {
    const url = `${BASE_URL}${endpoint}`;
    const cookie = await login();
    const headers = {
        'Content-Type': 'application/json'
    };
    if (cookie) headers['Cookie'] = cookie;
    if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(url, options);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return await response.json();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pollMissionStatus(missionId, missionRunId, maxAttempts = 60) {
    console.log(`\n  📊 Polling Forge Run ${missionRunId}...`);
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const run = await apiCall(`/api/mission-runs/${missionRunId}`);
            const phase = run.missionContext?.phase || 'unknown';
            console.log(`    [${i+1}] Status: ${run.status} | Phase: ${phase}`);
            
            if (run.status === 'completed' || run.status === 'failed') {
                return run;
            }
            
            // If paused for orders, we might need to "vibe" it forward
            if (run.status === 'paused' || phase === 'WAITING_FOR_ORDERS') {
                console.log('    ⚡ Mission paused for orders. Sending "Proceed" command...');
                await apiCall(`/api/missions/${missionId}/chat`, 'POST', {
                    message: "The plan looks good. Proceed with the next wave."
                });
                console.log('    ⚡ Resuming mission run...');
                await apiCall(`/api/mission-runs/${missionRunId}/resume`, 'POST');
            }

        } catch (e) {
            console.log(`    [${i+1}] Error polling: ${e.message}`);
        }
        await sleep(10000);
    }
    console.log(`    ⏱️ Timeout`);
    return null;
}

async function validateScenarioA() {
    console.log('\n🚀 SCENARIO A: End-to-End App Forge Lifecycle');
    console.log('='.repeat(60));
    
    try {
        // 1. Create Forge Mission
        console.log('  Creating Agentic App Forge mission...');
        const mission = await apiCall('/api/missions', 'POST', {
            name: `Scenario A: Analytics Dashboard Forge ${new Date().toISOString().slice(0,19)}`,
            objective: 'Forge a complete analytics dashboard application named "ScenarioA-Test" using the Agentic App Forge lifecycle. Ensure it has dark mode support and KPI cards.',
            executionStrategy: 'rolling_wave',
            blackboard: {
                isForge: true,
                blueprintSlug: "analytics-dashboard",
                appSlug: "scenario-a-test",
                appName: "Scenario A Test"
            }
        });
        console.log(`    ✓ Mission Created: ${mission.id}`);

        // 2. Launch Mission
        console.log('  Launching mission...');
        const launched = await apiCall(`/api/missions/${mission.id}/launch-mission`, 'POST', {
            reason: 'Validating Scenario A: End-to-End Forge'
        });
        const runId = launched.missionRunId || launched.runId;
        console.log(`    ✓ Launched Run: ${runId}`);

        // 3. Poll and Monitor
        const finalRun = await pollMissionStatus(mission.id, runId);
        
        if (finalRun?.status === 'completed') {
            console.log('\n✅ SCENARIO A PASSED');
            console.log(`   App Slug: scenario-a-test`);
        } else {
            console.log('\n❌ SCENARIO A FAILED or TIMED OUT');
            console.log(`   Final Status: ${finalRun?.status}`);
        }

    } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
    }
}

validateScenarioA();
