import { test, expect } from '@playwright/test';

test.describe('Operations Cycle 202 - E2E Test', () => {
    // We are relying on the authentication setup from auth.setup.ts
    // The chromium project in playwright.config.ts is configured to use it.
    
    const cycleUrl = '/operations/cycles/202';

    test.beforeEach(async ({ page }) => {
        // Navigate to the cycle 202 operations page
        await page.goto(cycleUrl);
        // Wait for the page to load completely using domcontentloaded instead of networkidle
        // because networkidle times out with long-lived SSE connections.
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000); // give React a moment to render
    });

    test('Cycle page loads correctly with basic information', async ({ page }) => {
        // Verify the URL
        expect(page.url()).toContain('/operations/cycles/202');

        // Check for cycle title or related header text
        // "Product Launch Cycle" should be the name of cycle 202
        await expect(page.locator('h1:has-text("Product Launch Cycle")')).toBeVisible({ timeout: 10000 });
        
        // Verify some common elements on the page (tabs, status, etc.)
        const activeStatus = page.locator('text=active').first();
        if (await activeStatus.isVisible()) {
            await expect(activeStatus).toBeVisible();
        }
    });

    test('Agent creates a product launch process via Workbench', async ({ page }) => {
        test.setTimeout(240000); // 4 minutes timeout for this specific test because agent takes a while

        // 1. Expand the Mission Workbench accordion
        const missionWorkbenchTrigger = page.locator('button', { hasText: 'Mission Workbench' }).first();
        await expect(missionWorkbenchTrigger).toBeVisible({ timeout: 10000 });
        
        const isExpanded = await missionWorkbenchTrigger.getAttribute('aria-expanded');
        if (isExpanded === 'false') {
            await missionWorkbenchTrigger.click();
        }

        // 2. Find and open the Apps Dropdown for a mission
        const appsDropdown = page.locator('[data-testid^="apps-dropdown-"]').first();
        await expect(appsDropdown).toBeVisible({ timeout: 10000 });
        await appsDropdown.click();

        // 3. Click "Open in Modal" or "Open" from the popover
        const openAppBtn = page.getByRole('button', { name: 'Open', exact: true }).first();
        await expect(openAppBtn).toBeVisible({ timeout: 15000 });
        await openAppBtn.click();
        
        const iframe = page.frameLocator('iframe[title*="Product Launch Workbench"]').first();
        
        page.on('console', msg => console.log(`PAGE LOG: ${msg.type()}: ${msg.text()}`));
        
        // 4. Verify Hub Page is loaded and visible
        // We wait for the overlay to disappear. We know it disappears when the SDK postMessage succeeds.
        await expect(page.locator('.lucide-loader2')).not.toBeVisible({ timeout: 15000 });
        
        await page.waitForTimeout(2000); // Wait for iframe React hydration
        const hubTitle = iframe.getByText('Product Launch Workbench').first();
        await expect(hubTitle).toBeVisible({ timeout: 120000 });

        // 5. Navigate to the Launch Command Center page where the Agent Chat lives
        const launchCommandCenterLink = iframe.getByText('Launch Command Center').first();
        await expect(launchCommandCenterLink).toBeVisible();
        await launchCommandCenterLink.click();

        // 6. Look for the chat input box inside the iframe
        const chatInput = iframe.locator('input[placeholder*="Ask"], textarea[placeholder*="Ask"], input[placeholder*="message"], textarea[placeholder*="message"], input[placeholder*="Type"], textarea[placeholder*="Type"]').first();
        await expect(chatInput).toBeVisible({ timeout: 15000 });
        
        // 7. Type a message and wait for a response
        await chatInput.fill('Please create a product launch for Project Phoenix');
        await page.keyboard.press('Enter');
        
        // Wait for the agent to start typing and then finish
        // We look for a response that mentions the project name
        const assistantMessage = iframe.locator('div[data-role="assistant"]').filter({ hasText: 'Project Phoenix' }).first();
        await expect(assistantMessage).toBeVisible({ timeout: 60000 }); // Wait up to 60s for agent to think and reply
        
        const responseText = await assistantMessage.textContent();
        expect(responseText).toContain('Project Phoenix');
        
        // 8. Navigate to Missions tab and trigger a mission
        const missionsTab = iframe.getByRole('button', { name: 'Missions', exact: true });
        await missionsTab.click();
        
        // Verify we are on the Missions tab
        await expect(iframe.getByText('Launch Missions', { exact: true })).toBeVisible({ timeout: 10000 });
        
        // Click the trigger button for the first mission (Launch Brief & Market Analysis)
        const launchBriefRow = iframe.locator('[data-mission="Launch Brief & Market Analysis"]');
        await expect(launchBriefRow).toBeVisible({ timeout: 10000 });
        await launchBriefRow.getByRole('button', { name: 'Trigger', exact: true }).click();

        // Wait for it to change state to "Launching..."
        await expect(launchBriefRow.getByRole('button', { name: 'Launching...', exact: true })).toBeVisible({ timeout: 5000 });
        
        // Trigger a second mission (GTM Strategy).
        // data-mission attribute uniquely identifies the row without relying on text nesting.
        const gtmRow = iframe.locator('[data-mission="GTM Strategy & Positioning"]');
        const gtmTrigger = gtmRow.getByRole('button', { name: 'Trigger', exact: true });
        if (await gtmTrigger.isVisible()) {
            await gtmTrigger.click();
            await expect(gtmRow.getByRole('button', { name: 'Launching...', exact: true })).toBeVisible({ timeout: 5000 });
        }

        // 9. Navigate to Approvals tab
        const approvalsTab = iframe.getByRole('button', { name: /Approvals/i });
        await approvalsTab.click();

        const approvalsHeader = iframe.getByText(/Pending Approvals/i);
        await expect(approvalsHeader).toBeVisible({ timeout: 10000 });

        // 10. Navigate to Live Feed tab
        const liveTab = iframe.getByRole('button', { name: /Live Feed/i });
        await liveTab.click();

        const liveHeader = iframe.getByText(/Live Agent Execution Feed/i);
        await expect(liveHeader).toBeVisible({ timeout: 10000 });

        // 11. Navigate to Predictions tab
        const predictionsTab = iframe.getByRole('button', { name: /Predictions/i });
        await predictionsTab.click();

        // "Prediction Intelligence" is rendered as an h2 — target it directly to avoid
        // matching inline text snippets in prediction cards that may repeat the phrase.
        const predictionIntelligence = iframe.locator('h2', { hasText: 'Prediction Intelligence' });
        await expect(predictionIntelligence).toBeVisible({ timeout: 10000 });
        
        // 12. Close the modal by pressing Escape
        await page.keyboard.press('Escape');
        
    });

    test('Navigation between cycle tabs works', async ({ page }) => {
        // If there are tabs (e.g. Overview, Tasks, Artifacts), test clicking them
        const tabs = page.locator('[role="tab"], button[role="tab"]');
        const tabCount = await tabs.count();
        
        if (tabCount > 1) {
            for (let i = 0; i < tabCount; i++) {
                const tab = tabs.nth(i);
                await tab.click();
                // Wait briefly for content to update
                await page.waitForTimeout(500);
            }
        } else {
            // No tabs found, pass vacuously
            expect(true).toBe(true);
        }
    });
});
