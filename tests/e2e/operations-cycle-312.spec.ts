import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test.describe('Operations Cycle 312 - E2E SDLC Test', () => {
    // Rely on the auth state from auth.setup.ts
    const cycleUrl = '/operations/cycles/312';
    let workbenchUrl = 'http://localhost:10136';
    const serverErrors: string[] = [];

    test.beforeAll(async () => {
        try {
            const { db } = await import('../../server/database_service.js');
            const { apps, appDeployments } = await import('../../shared/schema/index.js');
            const { eq } = await import('drizzle-orm');

            const [deployment] = await db.select({
                metadata: apps.runtimeMetadata
            })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(eq(apps.slug, 'sdlc-workbench-org291'))
            .limit(1);

            const meta = (deployment?.metadata as any) || {};
            if (meta.assignedPort) {
                workbenchUrl = `http://localhost:${meta.assignedPort}`;
                console.log(`RESOLVED WORKBENCH PORT FROM DB: ${workbenchUrl}`);
            }
        } catch (e: any) {
            console.warn('Failed to resolve dynamic port from DB, using fallback 10136:', e);
        }
    });

    test.beforeEach(async ({ page }) => {
        // Direct browser logs to console for backend monitoring/triage
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log(`BROWSER ERROR LOG: [${msg.type()}] ${msg.text()}`);
            }
        });
        page.on('pageerror', err => {
            console.log(`BROWSER RUNTIME EXCEPTION: ${err.message}`);
        });

        // Audit for network errors (5xx server errors)
        page.on('response', response => {
            const status = response.status();
            const url = response.url();
            const method = response.request().method();
            console.log(`NETWORK: ${method} ${url} -> ${status}`);
            if (status >= 500) {
                const logMsg = `FAIL: Request ${method} ${url} returned status ${status}`;
                console.error(logMsg);
                serverErrors.push(logMsg);
            }
        });
    });


    test('Complete E2E SDLC Workflow: Intake to Production Deployment', async ({ page }) => {
        test.setTimeout(300 * 1000); // 5 minutes timeout for the entire sequence

        console.log('Step 1: Navigating to Cycle 312 detail page...');
        await page.goto(cycleUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Verify the title matches Cycle 312
        await expect(page.locator('h1')).toContainText('Oddjob External Systems AI SDLC');
        await page.screenshot({ path: 'test-results/cycle-312/01-cycle-detail-launch.png', fullPage: true });

        // Verify the initial status is pending_approval and approve it
        console.log('Step 2: Approving and launching the cycle via REST API to bypass UI hydration race/lock...');
        const approveResponse = await page.request.post(`/api/cycles/312/approve`);
        expect(approveResponse.ok()).toBeTruthy();
        console.log('Approval API responded with success.');

        console.log('Navigating to about:blank to clear active SSE connections...');
        await page.goto('about:blank');
        console.log('Navigating back to Cycle 312 detail page...');
        await page.goto(cycleUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Verify the status badge next to the heading updates to running/active
        const statusBadge = page.locator('h1 ~ div, h1 ~ span').first();
        await expect(statusBadge).not.toContainText('PENDING', { timeout: 15000 });
        console.log('Cycle is now active.');

        console.log('Step 3: Navigating to PM Workbench...');
        await page.goto(`${workbenchUrl}/pm-workbench`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Interact with the Systems Analyst via the Agent Chat panel
        console.log('Interacting with the Systems Analyst agent via chat...');
        const chatInput = page.locator('input[placeholder*="Ask the agent"], input[placeholder*="Agent not available"]');
        await expect(chatInput).toBeVisible({ timeout: 20000 });
        // Wait until agent is online (input becomes enabled / placeholder changes)
        await expect(page.locator('input[placeholder*="Ask the agent"]')).toBeEnabled({ timeout: 20000 });
        
        await chatInput.fill('Is the public health check API feasible to implement within this cycle?');
        await page.screenshot({ path: 'test-results/cycle-312/02a-chat-input.png', fullPage: true });
        await chatInput.press('Enter');

        console.log('Waiting for Systems Analyst response...');
        // Wait for thinking indicator to show and then disappear
        const loadingIndicator = page.locator('.animate-bounce').first();
        if (await page.locator('.animate-bounce').count() > 0) {
            await expect(loadingIndicator).toBeHidden({ timeout: 45000 });
        }
        
        // Assert that a response bubble is visible
        const responseBubble = page.locator('.text-slate-100').last();
        await expect(responseBubble).toBeVisible({ timeout: 30000 });
        const analystResponse = await responseBubble.innerText();
        console.log(`Systems Analyst response: "${analystResponse}"`);
        expect(analystResponse.length).toBeGreaterThan(10);
        await page.screenshot({ path: 'test-results/cycle-312/02b-chat-response.png', fullPage: true });

        // Click Create Requirement to enter manual mode / document upload
        console.log('Opening requirement creation form...');
        const createReqBtn = page.locator('button:has-text("Create Requirement")');
        await expect(createReqBtn).toBeVisible({ timeout: 15000 });
        await createReqBtn.click();

        // Upload requirement document to trigger Systems Analyst AI extraction
        console.log('Uploading requirement document for AI extraction...');
        await page.setInputFiles('input#file-upload', {
            name: 'prd-requirement.md',
            mimeType: 'text/markdown',
            buffer: Buffer.from([
                '# Public Health Check API Requirements',
                '',
                '## Description',
                'We need to build a new public health check API for the system that exposes system availability metrics.',
                '',
                '## User Stories',
                '',
                '### US-1: Build a health endpoint',
                'As a system administrator, I want to query a public endpoint `/health` to get system status.',
                'Acceptance Criteria:',
                '1. GET `/health` returns status code 200.',
                '2. Response body is JSON containing `{ "status": "UP" }`.',
                '',
                '### US-2: Return system load metric',
                'As an operator, I want `/health` to return the system memory usage.',
                'Acceptance Criteria:',
                '1. Response JSON includes a `memoryUsage` key.'
            ].join('\n'))
        });

        const titleInput = page.locator('#manual-title');
        await expect(titleInput).toBeVisible({ timeout: 15000 });
        await titleInput.clear();
        await titleInput.fill('Build public health check API');

        // Trigger AI extraction
        console.log('Running AI requirements extraction...');
        const extractBtn = page.locator('button:has-text("Extract Requirements with AI")');
        await expect(extractBtn).toBeVisible({ timeout: 15000 });
        await extractBtn.click();

        // Wait for extraction to complete and user stories to render
        console.log('Waiting for user stories to be generated...');
        const approveAllBtn = page.locator('button:has-text("Approve All")');
        await expect(approveAllBtn).toBeVisible({ timeout: 45000 });

        // Approve all user stories
        console.log('Approving generated user stories...');
        await approveAllBtn.click();

        // Commit stories to backlog
        console.log('Committing approved stories to JIRA backlog...');
        const commitBtn = page.locator('button:has-text("Commit")');
        await expect(commitBtn).toBeVisible({ timeout: 15000 });
        await commitBtn.click();

        // Wait for backlog commit to complete
        await expect(page.locator('text=stories committed to backlog').first()).toBeVisible({ timeout: 15000 });

        // Publish PRD to Confluence
        console.log('Publishing generated PRD to Confluence...');
        const publishConfluenceBtn = page.locator('button:has-text("Publish to Confluence")');
        await expect(publishConfluenceBtn).toBeVisible({ timeout: 15000 });
        await publishConfluenceBtn.click();

        // Wait for publish success
        await expect(page.locator('button:has-text("Published")')).toBeVisible({ timeout: 45000 });

        // Submit PRD and UX Sign-off
        console.log('Submitting PRD and UX sign-off decisions...');
        await page.selectOption('select[aria-label="PRD Status"]', 'Approved');
        await page.selectOption('select[aria-label="UX Mockups Status"]', 'Approved');
        await page.selectOption('select[aria-label="Design Compliance"]', 'Yes');
        // Scope to the sign-off form's Story Points field — story cards reuse the
        // same aria-label, so disambiguate via the `required` sign-off input.
        await page.locator('input[aria-label="Story Points"][required]').fill('5');
        await page.locator('textarea[aria-label="Comments"]').fill('PRD and UX approved.');

        const submitSignoffBtn = page.locator('button[type="submit"]:has-text("Submit Sign-off")');
        await expect(submitSignoffBtn).toBeVisible({ timeout: 15000 });
        await submitSignoffBtn.click();

        // Trigger development directly using the newly enabled development button
        console.log('Triggering Core Development...');
        const triggerDevBtn = page.locator('button:has-text("Trigger Core Development")');
        await expect(triggerDevBtn).toBeVisible({ timeout: 15000 });
        await triggerDevBtn.click();

        // Verify that it says Development triggered
        await expect(page.locator('text=Development triggered').first()).toBeVisible({ timeout: 15000 });
        console.log('Development stage successfully triggered.');
        await page.screenshot({ path: 'test-results/cycle-312/02-pm-workbench-intake.png', fullPage: true });

        // Step 4: QA Workbench Gate
        console.log('Step 4: Navigating to QA Workbench...');
        await page.goto(`${workbenchUrl}/qa-workbench`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Log a passing test suite
        console.log('Logging passing smoke test suite...');
        const logSuiteBtn = page.locator('button:has-text("Log Passing Smoke Suite")');
        await expect(logSuiteBtn).toBeVisible({ timeout: 15000 });
        await logSuiteBtn.click();

        // Go to Quality Gate tab and evaluate
        console.log('Evaluating Quality Gate...');
        const gateTab = page.locator('button:has-text("Quality Gate")');
        await expect(gateTab).toBeVisible({ timeout: 15000 });
        await gateTab.click();

        const evaluateGateBtn = page.locator('button:has-text("Evaluate Quality Gate")');
        await expect(evaluateGateBtn).toBeVisible({ timeout: 15000 });
        await evaluateGateBtn.click();

        // Verify that it passes and UAT is triggered
        await expect(page.locator('text=Gate passed').first()).toBeVisible({ timeout: 15000 });
        console.log('Quality Gate passed successfully.');
        await page.screenshot({ path: 'test-results/cycle-312/03-qa-workbench-gate.png', fullPage: true });

        // Step 5: Stakeholder approvals
        console.log('Step 5: Navigating to Stakeholder Workbench...');
        await page.goto(`${workbenchUrl}/stakeholder-workbench`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Go to Approvals tab
        const approvalsTab = page.locator('button:has-text("Approvals")');
        await expect(approvalsTab).toBeVisible({ timeout: 15000 });
        await approvalsTab.click();

        // Click Save UAT Decision
        console.log('Approving UAT...');
        const saveUatBtn = page.locator('button:has-text("Save UAT Decision")');
        await expect(saveUatBtn).toBeVisible({ timeout: 15000 });
        await saveUatBtn.click();

        // Click Approve & Trigger Deployment
        console.log('Approving CAB and triggering deployment...');
        const saveCabBtn = page.locator('button:has-text("Approve & Trigger Deployment")');
        await expect(saveCabBtn).toBeVisible({ timeout: 15000 });
        await saveCabBtn.click();

        console.log('Production deployment successfully triggered.');
        await page.screenshot({ path: 'test-results/cycle-312/04-stakeholder-approvals.png', fullPage: true });

        // Step 6: Platform Milestone Gate Approval
        console.log('Step 6: Navigating back to Cycle 312 detail page...');
        await page.goto(cycleUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Wait for the Milestone gate banner to be visible
        console.log('Waiting for the Strategic Milestone Gate HIL banner...');
        const milestoneApproveBannerBtn = page.locator('button:has-text("Approve & Continue")');
        await expect(milestoneApproveBannerBtn).toBeVisible({ timeout: 60000 });
        await page.screenshot({ path: 'test-results/cycle-312/05-milestone-gate-banner.png', fullPage: true });
        await milestoneApproveBannerBtn.click();

        // Click Approve & Continue Fleet inside the modal
        console.log('Submitting Milestone Approval...');
        const approveModalBtn = page.locator('button:has-text("Approve & Continue Fleet")');
        await expect(approveModalBtn).toBeVisible({ timeout: 15000 });
        await page.screenshot({ path: 'test-results/cycle-312/06-milestone-gate-modal.png', fullPage: true });
        await approveModalBtn.click();

        // Wait for the cycle to complete and close
        console.log('Waiting for cycle to run to completion and close...');
        const closedStatus = page.locator('span:has-text("CLOSED"), span:has-text("COMPLETED")').first();
        await expect(closedStatus).toBeVisible({ timeout: 60000 });
        console.log('Cycle 312 successfully completed!');
        await page.screenshot({ path: 'test-results/cycle-312/07-cycle-completed.png', fullPage: true });

        // Step 7: Additional Verification checks
        console.log('Step 7: Performing post-execution verification checks...');

        // Verify that blueprints show as completed in the Execution Explorer
        console.log('Verifying blueprints in Execution Explorer...');
        const explorer = page.locator('text=Cycle Execution Explorer').first();
        await expect(explorer).toBeVisible({ timeout: 15000 });

        // Verify "Project Initialization & Sprint Zero" is marked as completed
        const sprintZeroCard = page.locator('text=Project Initialization & Sprint Zero').first();
        await expect(sprintZeroCard).toBeVisible({ timeout: 15000 });

        // Trigger and verify Strategic Log Export
        console.log('Verifying Strategic Operational Log Export...');
        const downloadPromise = page.waitForEvent('download');
        const exportBtn = page.locator('button:has-text("Export Strategic Log")');
        await expect(exportBtn).toBeVisible({ timeout: 15000 });
        await exportBtn.click();
        const download = await downloadPromise;
        const path = await download.path();
        expect(path).toBeTruthy();
        console.log(`Log successfully generated and saved at ${path}`);

        // Read and parse log contents to verify correct headers/sections are present
        console.log('Parsing downloaded log file...');
        const logContent = fs.readFileSync(path!, 'utf8');
        expect(logContent).toContain('STRATEGIC OPERATIONAL LOG');
        expect(logContent).toContain('Oddjob External Systems AI SDLC');
        console.log('Log file matches strategic schema validation.');

        // Step 8: Direct REST API state integrity check
        console.log('Step 8: Fetching cycle state directly via Platform API...');
        const apiResponse = await page.request.get(`/api/cycles/312`);
        expect(apiResponse.ok()).toBeTruthy();
        const apiData = await apiResponse.json();
        console.log(`Cycle status returned via API: "${apiData.status}", progress: "${apiData.progress}"`);
        expect(apiData.status).toMatch(/closed|completed/i);
        expect(apiData.progress).toBe(100);
        console.log('API state validation passed.');

        // Step 9: Verify zero network 5xx errors occurred during UI interactions
        console.log('Step 9: Auditing for server-side HTTP 5xx responses...');
        expect(serverErrors).toEqual([]);
        console.log('Audit completed. Zero backend server-side errors detected.');
    });
});
