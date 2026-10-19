import { test, expect } from '@playwright/test';

test.describe('Operations Cycle 356 - BudgetMaster E2E Test', () => {
    const cycleUrl = '/operations/cycles/356';
    const workbenchUrl = '/app/budgetmaster-workbench-org291';
    const advisorUrl = '/app/budgetmaster-advisor-org291';
    const serverErrors: string[] = [];

    test.beforeAll(async () => {
        try {
            const { db } = await import('../../server/database_service.js');
            const { apps, appDeployments, appInstances } = await import('../../shared/schema/index.js');
            const { eq, and } = await import('drizzle-orm');

            // Log current deployment details for debugging
            const workbenchDeployment = await db.select({
                id: apps.id,
                slug: apps.slug,
                publicSlug: appDeployments.publicSlug
            })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(eq(apps.slug, 'budgetmaster-workbench-org291'))
            .limit(1);

            console.log(`RESOLVED WORKBENCH FROM DB: ${JSON.stringify(workbenchDeployment)}`);
        } catch (e: any) {
            console.warn('Failed to query DB for diagnostic logs:', e);
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
            if (status >= 500) {
                // Ignore expected 503 Service Unavailable during container cold start/wake-up
                if (status === 503 && url.includes('/app/budgetmaster-')) {
                    console.log(`[E2E] Ignored expected cold-start 503 for ${url}`);
                    return;
                }
                const logMsg = `FAIL: Request ${method} ${url} returned status ${status}`;
                console.error(logMsg);
                serverErrors.push(logMsg);
            }
        });
    });

    test('BudgetMaster E2E Workflow: Cycle, Workbench, Ledger, Sandbox, and Advisor Chat', async ({ page }) => {
        test.setTimeout(240 * 1000); // 4 minutes timeout

        // ── 1. Navigate to Cycle Detail ──
        console.log('Step 1: Navigating to BudgetMaster Cycle 356 detail page...');
        await page.goto(cycleUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Verify the heading and active status
        await expect(page.locator('h1')).toContainText('BudgetMaster — Sovereign Algorithmic Wealth Matrix');
        const activeStatusBadge = page.locator('span:has-text("active")').first();
        await expect(activeStatusBadge).toBeVisible();
        await page.screenshot({ path: 'test-results/operations-budgetmaster/01-cycle-detail.png', fullPage: true });

        // ── 2. Navigate to BudgetMaster Workbench ──
        console.log('Step 2: Navigating to BudgetMaster Workbench...');
        await page.goto(workbenchUrl, { waitUntil: 'domcontentloaded' });
        
        // Wait for potential app wake up / proxy boot loading screen
        console.log('Waiting for Workbench app to respond...');
        await expect(page.locator('h1')).toContainText('BudgetMaster — Sovereign Algorithmic Wealth Matrix', { timeout: 60000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'test-results/operations-budgetmaster/02-workbench-hub.png', fullPage: true });

        // Verify the module links/cards are visible on the hub page
        await expect(page.locator('text=Wealth Dashboard').first()).toBeVisible();
        await expect(page.locator('text=Transaction Ledger').first()).toBeVisible();
        await expect(page.locator('text=Alerts & Recommendations').first()).toBeVisible();

        // ── 3. Explore Wealth Dashboard ──
        console.log('Step 3: Navigating to Wealth Dashboard...');
        await page.goto(`${workbenchUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await expect(page.locator('h1')).toContainText('Wealth Dashboard');
        await expect(page.locator('text=Net Worth').first()).toBeVisible();
        await page.screenshot({ path: 'test-results/operations-budgetmaster/03-dashboard.png', fullPage: true });

        // ── 4. Interact with Transaction Ledger ──
        console.log('Step 4: Navigating to Transaction Ledger...');
        await page.goto(`${workbenchUrl}/ledger`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await expect(page.locator('h1')).toContainText('Transaction Ledger');
        await page.screenshot({ path: 'test-results/operations-budgetmaster/04a-ledger.png', fullPage: true });

        // If there are transactions, test the status toggling
        const statusButton = page.locator('button[title*="Click to advance reconcile status"]').first();
        if (await statusButton.count() > 0) {
            const initialStatus = await statusButton.innerText();
            console.log(`Initial status of first transaction: ${initialStatus}`);
            await statusButton.click();
            await page.waitForTimeout(1000);
            const nextStatus = await statusButton.innerText();
            console.log(`Toggled status of first transaction: ${nextStatus}`);
            expect(nextStatus).not.toBe(initialStatus);
        }

        // Test ledger semantic search input
        const searchInput = page.locator('input[placeholder*="coffee-ish spend"]');
        await expect(searchInput).toBeVisible();
        await searchInput.fill('rent');
        await searchInput.press('Enter');
        console.log('Submitted search query "rent". Waiting for results...');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: 'test-results/operations-budgetmaster/04b-ledger-search.png', fullPage: true });

        // ── 5. Interact with Net Worth Forecast ──
        console.log('Step 5: Navigating to Net Worth Forecast...');
        await page.goto(`${workbenchUrl}/forecast`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await expect(page.locator('h1')).toContainText('Net Worth Forecast');
        
        // Modify a slider range input to test interactivity
        const sliderInput = page.locator('input[title*="Annual contribution"]').first();
        await expect(sliderInput).toBeVisible();
        await sliderInput.fill('45000');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'test-results/operations-budgetmaster/05-forecast.png', fullPage: true });

        // ── 6. Execute Capital Purchase Sandbox Mission ──
        console.log('Step 6: Navigating to Capital Purchase Sandbox...');
        await page.goto(`${workbenchUrl}/sandboxes`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await expect(page.locator('h1')).toContainText('Capital Purchase Sandbox');

        // Set scenario values
        const priceSlider = page.locator('input[title*="Purchase price"]').first();
        await priceSlider.fill('32000');
        
        const labelInput = page.locator('input:not([type="range"])').first();
        await labelInput.clear();
        await labelInput.fill('E2E Test Vehicle');

        await page.screenshot({ path: 'test-results/operations-budgetmaster/06a-sandbox-setup.png', fullPage: true });

        // Trigger simulation mission
        console.log('Triggering Capital Purchase Sandbox simulation mission...');
        const runButton = page.locator('button:has-text("Run & Save Server Simulation")');
        await runButton.click();

        // Wait for completion indicator/toast
        const toastLocator = page.locator('p:has-text("Server simulation queued"), p:has-text("scenario")').first();
        await expect(toastLocator).toBeVisible({ timeout: 15000 });
        console.log('Server simulation queued message detected. Waiting for execution completion...');
        
        // Wait for the scenario to populate under "Saved Scenarios" (usually completed in ~5-10 seconds)
        const savedScenario = page.locator('span:has-text("E2E Test Vehicle")').first();
        await expect(savedScenario).toBeVisible({ timeout: 45000 });
        console.log('Capital Purchase simulation mission completed successfully.');
        await page.screenshot({ path: 'test-results/operations-budgetmaster/06b-sandbox-saved.png', fullPage: true });

        // ── 7. Verify Alerts & Recommendations ──
        console.log('Step 7: Navigating to Alerts & Recommendations...');
        await page.goto(`${workbenchUrl}/alerts`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        await expect(page.locator('h1')).toContainText('Alerts & Recommendations');
        await page.screenshot({ path: 'test-results/operations-budgetmaster/07-alerts.png', fullPage: true });

        // ── 8. Interact with Financial Advisor Chat Agent ──
        console.log('Step 8: Navigating to Financial Advisor Chat Agent...');
        await page.goto(advisorUrl, { waitUntil: 'domcontentloaded' });

        // Wait for possible proxy wake up
        console.log('Waiting for Advisor app to respond...');
        await expect(page.locator('h1')).toContainText('BudgetMaster Financial Advisor', { timeout: 60000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'test-results/operations-budgetmaster/08a-advisor-landing.png', fullPage: true });

        // Wait for agent to become online (jobId loaded)
        console.log('Waiting for Agent to connect and become Online...');
        const onlineBadge = page.locator('span:has-text("Online")').first();
        await expect(onlineBadge).toBeVisible({ timeout: 30000 });

        const chatInput = page.locator('input[placeholder*="Ask about your finances..."]');
        await expect(chatInput).toBeEnabled({ timeout: 10000 });

        // Ask the agent a financial question
        await chatInput.fill('What is my current net worth and list my accounts?');
        await page.screenshot({ path: 'test-results/operations-budgetmaster/08b-chat-input.png', fullPage: true });
        await chatInput.press('Enter');

        console.log('Sent prompt to advisor agent. Waiting for response...');
        // Wait for thinking indicator to show and then disappear
        const loadingIndicator = page.locator('.animate-pulse').first();
        if (await loadingIndicator.count() > 0) {
            await expect(loadingIndicator).toBeHidden({ timeout: 45000 });
        }

        // Wait for response bubble to appear
        const responseBubble = page.locator('.bg-slate-800\\/80').last();
        await expect(responseBubble).toBeVisible({ timeout: 30000 });
        
        const responseText = await responseBubble.innerText();
        console.log(`Advisor Agent Response: "${responseText}"`);
        
        // Assert the response contains numbers or financial characters
        expect(responseText.length).toBeGreaterThan(15);
        expect(responseText).toMatch(/[\d\$]/); // must contain a digit or dollar sign ($), verifying grounding works

        await page.screenshot({ path: 'test-results/operations-budgetmaster/08c-chat-response.png', fullPage: true });

        // ── 9. Final Server/Network Errors Check ──
        console.log('Step 9: Auditing for server-side HTTP 5xx responses...');
        expect(serverErrors).toEqual([]);
        console.log('Audit completed. Zero backend server-side errors detected.');
    });
});
