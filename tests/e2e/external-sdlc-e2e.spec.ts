import { test, expect } from '@playwright/test';

test.describe('External SDLC Cycle UI Integration', () => {
    test('should stage, configure, and launch an external SDLC cycle through the UI', async ({ page }) => {
        // 1. Navigate to cycles dashboard
        console.log('Navigating to cycles dashboard...');
        await page.goto('/operations/cycles');
        await expect(page).toHaveTitle(/Oddjob/);

        // 2. Click "New Cycle"
        console.log('Navigating to Stage Cycle page...');
        await page.goto('/operations/cycles/new');
        await expect(page.locator('text=Stage New')).toBeVisible();

        // 3. Find "Security Sweep" template and click "Skip to Builder"
        console.log('Selecting template and skipping to builder...');
        const templateCard = page.locator('div.group', { has: page.locator('h3', { hasText: 'Security Sweep' }) }).first();
        await expect(templateCard).toBeVisible();
        await templateCard.locator('text=Skip to Builder').click();

        // 4. Fill in the strategic details
        console.log('Filling strategic definition...');
        const nameInput = page.locator('label:has-text("Cycle Name") + input');
        await expect(nameInput).toBeVisible();
        await nameInput.clear();
        await nameInput.fill('Playwright External Dev Test');

        const objectiveTextarea = page.locator('label:has-text("Strategic Objective") + textarea');
        await objectiveTextarea.clear();
        await objectiveTextarea.fill('End-to-end test of managing coding agents for external systems via GitHub MCP and remote pipelines.');

        // 5. Toggle off Human-in-the-Loop Gate to auto-launch the cycle
        console.log('Disabling Human-in-the-Loop Gate...');
        const hilCheckbox = page.locator('label:has-text("Human-in-the-Loop Gate")');
        await hilCheckbox.click(); // Uncheck it

        // 6. Click "Launch Fleet"
        console.log('Launching fleet...');
        const launchButton = page.locator('button:has-text("Launch Fleet")');
        await expect(launchButton).toBeVisible();
        await launchButton.click();

        // 7. Verify redirect back to /operations/cycles and presence of the new cycle card
        console.log('Verifying cycle list redirect...');
        await page.waitForURL('**/operations/cycles', { timeout: 30000 });
        
        const newCycleCard = page.locator('div.group', { hasText: 'Playwright External Dev Test' }).first();
        await expect(newCycleCard).toBeVisible({ timeout: 15000 });
        
        // Take a screenshot of the dashboard
        await page.screenshot({ path: 'test-results/cycles-dashboard-launched.png' });
        console.log('Saved dashboard screenshot');

        // 8. Open the Cycle Detail page
        console.log('Opening cycle detail page...');
        await newCycleCard.locator('text=Playwright External Dev Test').click();
        
        // Verify we are on the detail page
        await page.waitForURL('**/operations/cycles/*', { timeout: 30000 });
        console.log('Successfully navigated to cycle detail page!');

        // Wait for page load state
        await page.waitForLoadState('domcontentloaded');
        
        // Take a screenshot of the detail page
        await page.screenshot({ path: 'test-results/cycle-detail-launched.png' });
        console.log('Saved detail page screenshot');
    });
});
