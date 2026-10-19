#!/usr/bin/env tsx
/**
 * V2 Features Test Suite for Oddjob Application
 * 
 * Tests:
 * 1. New Job Types (Slack, Email, SQL, AI Agent) CRUD
 * 2. Parallel Repeater Config
 * 3. Execution via Worker Queue
 */

import { readFileSync } from 'fs';

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:5000';
const TEST_USER = {
    username: process.env.TEST_USERNAME || 'testuser',
    password: process.env.TEST_PASSWORD || 'testpassword',
};

async function runTests() {
    console.log('🧪 Starting V2 Features Test Suite...\n');

    // 1. Auth
    console.log("➡️  Authenticating...");
    const loginRes = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_USER),
    });
    if (!loginRes.ok) throw new Error("Login failed");
    const sessionCookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    const loginData = await loginRes.json();
    let csrfToken = loginData.csrfToken;
    const userId = loginData.id;

    if (!csrfToken) {
        const csrfResponse = await fetch(`${BASE_URL}/api/csrf-token`, {
            headers: { Cookie: sessionCookie },
        });
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken;
    }

    const headers = {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: sessionCookie,
    };

    // Helper
    async function createJob(type: string, name: string, config: any) {
        console.log(`➡️  Creating ${type} job: ${name}...`);
        const res = await fetch(`${BASE_URL}/api/jobs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, type, config, createdBy: userId })
        });
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Failed to create ${type} job: ${res.status} ${txt}`);
        }
        const job = await res.json();
        console.log(`   ✅ Created Job ID ${job.id}`);
        return job.id;
    }

    // 2. Test Job Types
    try {
        // Slack
        await createJob('slack_post', 'Test Slack', { credentialId: '1', channelId: 'C123', message: 'Hello' });

        // Email
        await createJob('email_send', 'Test Email', { credentialId: '2', to: 'test@example.com', subject: 'Hi', body: 'Body' });

        // SQL
        await createJob('sql_query', 'Test SQL', { credentialId: '3', query: 'SELECT 1', outputMode: 'list' });

        // AI Agent
        await createJob('ai_agent', 'Test Agent', {
            credentialId: '4',
            model: 'gpt-4o',
            goal: 'Calc',
            allowedTools: ['calculator'],
            maxIterations: 5
        });

        // Parallel Repeater
        const repeaterId = await createJob('repeater', 'Test Parallel Repeater', {
            inputSource: "[1,2,3]",
            nestedJobType: "curl",
            nestedJobConfig: { url: "https://httpbin.org/get" },
            itemVariable: "item",
            executionMode: "parallel",
            concurrency: 2
        });

    } catch (e) {
        console.error('❌ Job Type Creation Failed:', e);
        process.exit(1);
    }

    // 3. Test Execution (Queue Verification)
    console.log("\n➡️  Testing Execution Queue...");
    try {
        // Create a simple shell job
        const shellJobId = await createJob('shell', 'Queue Test Job', {
            executable: 'echo',
            parameters: 'Queue Works'
        });

        // Create Pipeline
        const pipeRes = await fetch(`${BASE_URL}/api/pipelines`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: "Queue Test Pipeline",
                triggerType: "manual",
                createdBy: userId, // Also good practice
                steps: [{ jobId: shellJobId, order: 0 }]
            })
        });
        const pipeline = await pipeRes.json();

        // Execute
        const execRes = await fetch(`${BASE_URL}/api/pipelines/${pipeline.id}/execute`, {
            method: 'POST', headers, body: '{}'
        });
        if (!execRes.ok) throw new Error("Execution request failed");

        const execResult = await execRes.json();
        console.log(`   🚀 Execution Started (ID: ${execResult.executionId})`);

        // Check Status loop
        let attempts = 0;
        let success = false;
        while (attempts < 10) {
            await new Promise(r => setTimeout(r, 1000));
            const pollRes = await fetch(`${BASE_URL}/api/pipelines/${pipeline.id}/executions`, { headers });
            const executions = await pollRes.json();
            const latest = executions.find((e: any) => e.id === execResult.executionId);

            if (latest.status === 'completed') {
                success = true;
                break;
            }
            if (latest.status === 'failed') {
                throw new Error(`Pipeline failed: ${latest.error}`);
            }
            process.stdout.write('.');
            attempts++;
        }

        if (success) {
            console.log("\n   ✅ Pipeline Completed Successfully via Queue!");
        } else {
            console.error("\n   ❌ Pipeline Timed Out (Check Queue Worker)");
            process.exit(1);
        }

    } catch (e) {
        console.error('\n❌ Execution Test Failed:', e);
        process.exit(1);
    }

    console.log('\n✨ All V2 Feature Tests Passed!');
}

runTests().catch(console.error);
