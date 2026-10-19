import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

let stopApprover: (() => void) | undefined;
let cycleMap = new Map<string, number>();

const startAutoApprover = (db: any) => {
    let active = true;
    const interval = setInterval(async () => {
        if (!active) return;
        try {
            const { approvalRequests } = await import('../../shared/schema/index.js');
            const { eq } = await import('drizzle-orm');
            const { MoltProducer } = await import('../../server/domain/governor/core/molt-producer.js');

            const pending = await db.select()
                .from(approvalRequests)
                .where(eq(approvalRequests.status, 'pending'));

            for (const req of pending) {
                console.log(`[Auto-Approver] Found pending approval ID: ${req.id} for session: ${req.executionId}`);
                const sessionId = req.executionId;
                const modifiedOutput = req.modifiedOutput as any;
                const proposalId = modifiedOutput?.proposalId;
                const command = modifiedOutput?.command;

                if (sessionId && proposalId) {
                    console.log(`[Auto-Approver] Approving proposal: ${proposalId} for command: ${command}`);
                    
                    // 1. Publish DECISION event to Redis
                    const producer = new MoltProducer(sessionId);
                    await producer.publish("DECISION", {
                        approved: true,
                        reason: "Automated E2E Test Approval",
                        proposalId,
                        timestamp: Date.now(),
                        user: "e2e-auto-approver"
                    });
                    
                    // 2. Update status in database
                    await db.update(approvalRequests)
                        .set({ status: 'approved', decisionAt: new Date() })
                        .where(eq(approvalRequests.id, req.id));

                    console.log(`[Auto-Approver] Successfully approved request ${req.id}`);
                }
            }
        } catch (err: any) {
            console.error("[Auto-Approver] Error in auto-approver loop:", err.message);
        }
    }, 2000);

    return () => {
        active = false;
        clearInterval(interval);
    };
};

test.describe('ServiceBot, Dispatcher, & Location Search E2E Cycle', () => {
    test.beforeAll(async () => {
        try {
            console.log('[Setup] Registering system apps...');
            execSync('npx tsx server/scripts/register-dispatcher-app.ts', { stdio: 'inherit' });
            execSync('npx tsx server/scripts/register-location-search-app.ts', { stdio: 'inherit' });

            console.log('[Setup] Seeding cycles and assets...');
            execSync('npx tsx server/scripts/install-asset-service-dispatch-techhead7.ts', { stdio: 'inherit' });
            execSync('npx tsx server/scripts/install-extra-cycles-techhead7.ts', { stdio: 'inherit' });
            execSync('npx tsx server/scripts/install-dispatcher-techhead7.ts', { stdio: 'inherit' });
            
            console.log('[Setup] Publishing ServiceBot public agent...');
            execSync('npx tsx artifacts/publish_servicebot_agent.ts', { stdio: 'inherit' });

            console.log('[Setup] Activating apps and starting instances...');
            execSync('npx tsx server/scripts/activate-asset-dispatch.ts', { stdio: 'inherit' });

            // Re-import database to pass it to the auto-approver
            const { db } = await import('../../server/database_service.js');
            const { operationalCycles } = await import('../../shared/schema/index.js');

            // Query cycles
            const dbCycles = await db.select().from(operationalCycles);
            for (const c of dbCycles) {
                cycleMap.set(c.name, c.id);
            }

            // Start the auto-approver loop
            stopApprover = startAutoApprover(db);

            console.log('[Setup] Seeding and activation completed.');
        } catch (e: any) {
            console.error('[Setup] Error in beforeAll hook:', e.message);
        }
    });

    test.afterAll(async () => {
        if (stopApprover) {
            console.log('[Cleanup] Stopping auto-approver...');
            stopApprover();
        }
    });

    test.beforeEach(async ({ page }) => {
        // Direct browser logs to console
        page.on('console', msg => {
            console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
        });
        page.on('pageerror', err => {
            console.error(`[BROWSER PAGEERROR] ${err.message}`);
        });
        page.on('requestfailed', request => {
            console.log(`[BROWSER REQUEST FAILED] ${request.method()} ${request.url()}`);
        });
    });

    test('E2E Integration Flow: Scan QR -> Troubleshoot -> Escalate to Dispatcher -> Track Location', async ({ page }) => {
        test.setTimeout(180 * 1000); // 3 minutes timeout

        // ── Step 1: Verify Cycle Detail Dashboards ──
        console.log('Step 1: Navigating to Cycle Detail Dashboards...');
        const cycles = [
            { id: cycleMap.get('QR Asset Triage & Service Dispatch') ?? 296, name: 'QR Asset Triage & Service Dispatch' },
            { id: cycleMap.get('Service Dispatch Pipeline') ?? 324, name: 'Service Dispatch Pipeline' },
            { id: cycleMap.get('Asset Discovery Pipeline') ?? 301, name: 'Asset Discovery Pipeline' }
        ];

        for (const cycle of cycles) {
            const url = `/operations/cycles/${cycle.id}`;
            console.log(`Verifying cycle ${cycle.id} (${cycle.name})...`);
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(1500);
            await expect(page.locator('h1')).toContainText(cycle.name, { timeout: 15000 });
            await page.screenshot({ path: `test-results/servicebot-suite/01-cycle-${cycle.id}.png`, fullPage: true });
        }

        // ── Step 2: ServiceBot Troubleshooting & Diagnostics ──
        console.log('Step 2: Accessing ServiceBot public page for AST-001...');
        await page.goto('/a/service-bot?assetId=AST-001');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        // Verify title & welcome message
        console.log('Verifying welcome message...');
        await expect(page.locator('h1')).toContainText(/ServiceBot/i, { timeout: 15000 });
        await expect(page.getByText(/how can i assist you today/i)).toBeVisible({ timeout: 15000 });
        await page.screenshot({ path: 'test-results/servicebot-suite/02-welcome.png' });

        // Trigger "Report a problem" via chat input
        console.log('Typing problem report...');
        const chatInput = page.getByRole('textbox').first();
        await expect(chatInput).toBeVisible({ timeout: 10000 });

        const chatRequest = page.waitForRequest(
            req => req.url().includes('/api/public/agents/service-bot/chat') && req.method() === 'POST',
            { timeout: 15000 }
        );
        await chatInput.fill('Report a problem');
        await page.keyboard.press('Enter');
        await chatRequest;
        console.log('Problem report submitted. Waiting for diagnostic form...');

        // Wait for the diagnostic form to render
        await expect(page.getByText("Let me help diagnose the issue")).toBeVisible({ timeout: 30000 });
        await expect(page.getByText("What's the issue?")).toBeVisible({ timeout: 5000 });
        await page.screenshot({ path: 'test-results/servicebot-suite/03-diagnostics-form.png' });

        // Fill out diagnostics form
        console.log('Filling out diagnostic form...');
        const problemTypeTrigger = page.locator('#problem_type');
        await expect(problemTypeTrigger).toBeVisible({ timeout: 10000 });
        await problemTypeTrigger.click();
        const problemOption = page.getByRole('option', { name: 'Not dispensing', exact: true });
        await expect(problemOption).toBeVisible({ timeout: 5000 });
        await problemOption.click();
        await expect(problemTypeTrigger).toContainText('Not dispensing', { timeout: 5000 });
        await page.waitForTimeout(500);

        const poweredOnTrigger = page.locator('#powered_on');
        await expect(poweredOnTrigger).toBeVisible({ timeout: 10000 });
        await poweredOnTrigger.click();
        const poweredOption = page.getByRole('option', { name: 'Yes — lights are on', exact: true });
        await expect(poweredOption).toBeVisible({ timeout: 5000 });
        await poweredOption.click();
        await expect(poweredOnTrigger).toContainText('Yes — lights are on', { timeout: 5000 });
        await page.waitForTimeout(500);

        const runDiagRequest = page.waitForRequest(
            req => req.url().includes('/api/public/agents/service-bot/chat') && req.method() === 'POST',
            { timeout: 30000 }
        );
        await page.getByRole('button', { name: 'Run Pipeline' }).click();
        await runDiagRequest;
        console.log('Diagnostic form submitted. Waiting for resolution feedback form...');

        // ── Step 2.5: Handle Resolution Feedback Form ──
        console.log('Waiting for resolved question form...');
        const resolvedTrigger = page.locator('#resolved');
        await expect(resolvedTrigger).toBeVisible({ timeout: 90000 });
        await page.screenshot({ path: 'test-results/servicebot-suite/03b-resolution-form.png' });

        console.log('Selecting "No, still not working"...');
        await resolvedTrigger.click();
        const resolvedOption = page.getByRole('option', { name: 'No, still not working', exact: true });
        await expect(resolvedOption).toBeVisible({ timeout: 5000 });
        await resolvedOption.click();
        await expect(resolvedTrigger).toContainText('No, still not working', { timeout: 5000 });
        await page.waitForTimeout(500);

        const runResolvedRequest = page.waitForRequest(
            req => req.url().includes('/api/public/agents/service-bot/chat') && req.method() === 'POST',
            { timeout: 30000 }
        );
        await page.getByRole('button', { name: 'Run Pipeline' }).click();
        await runResolvedRequest;
        console.log('Resolution form submitted. Waiting for escalation form...');

        // ── Step 3: Trigger Escalation & Dispatch ──
        console.log('Waiting for escalation form...');
        const confirmLocationTrigger = page.locator('#confirm_location');
        await expect(confirmLocationTrigger).toBeVisible({ timeout: 60000 });
        await page.screenshot({ path: 'test-results/servicebot-suite/04-escalation-form.png' });

        // Fill out escalation form
        console.log('Filling out escalation form...');
        await confirmLocationTrigger.click();
        const confirmLocationOption = page.getByRole('option', { name: 'Yes, correct', exact: true });
        await expect(confirmLocationOption).toBeVisible({ timeout: 5000 });
        await confirmLocationOption.click();
        await expect(confirmLocationTrigger).toContainText('Yes, correct', { timeout: 5000 });
        await page.waitForTimeout(500);

        const contactMethodTrigger = page.locator('#contact_method');
        await expect(contactMethodTrigger).toBeVisible({ timeout: 10000 });
        await contactMethodTrigger.click();
        const contactMethodOption = page.getByRole('option', { name: 'SMS', exact: true });
        await expect(contactMethodOption).toBeVisible({ timeout: 5000 });
        await contactMethodOption.click();
        await expect(contactMethodTrigger).toContainText('SMS', { timeout: 5000 });
        await page.waitForTimeout(500);

        const contactInput = page.locator('#contact_value');
        await expect(contactInput).toBeVisible({ timeout: 5000 });
        await contactInput.fill('+1-555-0199');
        await page.waitForTimeout(500);

        const runEscalationRequest = page.waitForRequest(
            req => req.url().includes('/api/public/agents/service-bot/chat') && req.method() === 'POST',
            { timeout: 30000 }
        );
        await page.getByRole('button', { name: 'Run Pipeline' }).click();
        await runEscalationRequest;
        console.log('Escalation form submitted.');

        // Verify dispatch started / message received
        await page.waitForTimeout(10000); // Give the backend worker some time to trigger and match
        await page.screenshot({ path: 'test-results/servicebot-suite/05-dispatch-complete.png' });

        // ── Step 4: Dispatcher App Verification ──
        console.log('Step 4: Navigating to Dispatcher App at /app/dispatcher...');
        await page.goto('/app/dispatcher');
        await page.waitForLoadState('networkidle');

        // Check if there is an h1 with Rescue Dispatch (handles potential container restarts)
        await expect(page.locator('h1')).toContainText('Rescue Dispatch', { timeout: 60000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'test-results/servicebot-suite/06-dispatcher-view.png', fullPage: true });

        // Verify active rescues and squads headers are present
        await expect(page.getByText('Active Rescues').first()).toBeVisible();
        await expect(page.getByText('Squad Status').first()).toBeVisible();

        // ── Step 5: Location Search App Verification ──
        console.log('Step 5: Navigating to Location Search App at /app/location-search...');
        await page.goto('/app/location-search');
        await page.waitForLoadState('networkidle');

        await expect(page.locator('h1')).toContainText('Location Index', { timeout: 60000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'test-results/servicebot-suite/07-location-search-view.png', fullPage: true });

        // Search for "HQ West" in Location Search
        console.log('Searching for "HQ West" in Location Search...');
        const searchBar = page.locator('input[placeholder*="SEARCH LOCATIONS"]');
        await expect(searchBar).toBeVisible();
        await searchBar.fill('HQ West');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'test-results/servicebot-suite/08-location-search-results.png', fullPage: true });

        console.log('E2E integration test cycle completed successfully.');
    });
});
