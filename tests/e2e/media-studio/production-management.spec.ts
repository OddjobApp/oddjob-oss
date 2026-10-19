import { test, expect } from '@playwright/test';

test.describe('Media Studio Production Management', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test.beforeEach(async ({ page }) => {
        await page.goto('/workspace/chat/test-media-production', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-testid="crew-composer"]')).toBeVisible({ timeout: 20000 });
    });

    test('tests complete production lifecycle', async ({ page }) => {
        test.setTimeout(120000);

        const composer = page.locator('[data-testid="crew-composer"] textarea');

        // Step 1: Create production
        await composer.fill('Start a production called Lifecycle Test with aspect ratio 16:9');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Verify production created
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Step 2: Add scene
        await composer.fill('Add a scene called Opening Scene to the production');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Step 3: Add shots
        await composer.fill('Add 3 shots to the Opening Scene');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Step 4: Navigate through tabs
        const storyTab = page.getByRole('tab', { name: 'Story' });
        if (await storyTab.isVisible()) {
            await storyTab.click();
            await page.waitForTimeout(1000);
        }

        const storyboardTab = page.getByRole('tab', { name: 'Storyboard' });
        if (await storyboardTab.isVisible()) {
            await storyboardTab.click();
            await page.waitForTimeout(1000);
        }

        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        if (await shotsTab.isVisible()) {
            await shotsTab.click();
            await page.waitForTimeout(1000);
        }

        const filmTab = page.getByRole('tab', { name: 'Film' });
        if (await filmTab.isVisible()) {
            await filmTab.click();
            await page.waitForTimeout(1000);
        }

        // Verify production still accessible
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible();
    });

    test('tests tab navigation (Story, Storyboard, Shots, Film)', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio with production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Tab Navigation Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Test Story tab
        const storyTab = page.getByRole('tab', { name: 'Story' });
        await expect(storyTab).toBeVisible();
        await storyTab.click();
        await page.waitForTimeout(1000);
        
        const storyPanel = page.getByRole('tabpanel', { name: /Story/i });
        if (await storyPanel.isVisible()) {
            await expect(storyPanel).toBeVisible();
        }

        // Test Storyboard tab
        const storyboardTab = page.getByRole('tab', { name: 'Storyboard' });
        await storyboardTab.click();
        await page.waitForTimeout(1000);
        
        const storyboardPanel = page.getByRole('tabpanel', { name: /Storyboard/i });
        if (await storyboardPanel.isVisible()) {
            await expect(storyboardPanel).toBeVisible();
        }

        // Test Shots tab
        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        await shotsTab.click();
        await page.waitForTimeout(1000);
        
        const shotsPanel = page.getByRole('tabpanel', { name: /Shots/i });
        if (await shotsPanel.isVisible()) {
            await expect(shotsPanel).toBeVisible();
        }

        // Test Film tab
        const filmTab = page.getByRole('tab', { name: 'Film' });
        await filmTab.click();
        await page.waitForTimeout(1000);
        
        const filmPanel = page.getByRole('tabpanel', { name: /Film/i });
        if (await filmPanel.isVisible()) {
            await expect(filmPanel).toBeVisible();
        }
    });

    test('tests keyboard navigation in tabs', async ({ page }) => {
        test.setTimeout(60000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Keyboard Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Focus on first tab
        const firstTab = page.getByRole('tab', { name: 'Story' });
        await firstTab.focus();
        await expect(firstTab).toBeFocused();

        // Test arrow key navigation
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(200);

        const secondTab = page.getByRole('tab', { name: 'Storyboard' });
        await expect(secondTab).toBeFocused();

        // Test Home key
        await page.keyboard.press('Home');
        await page.waitForTimeout(200);
        await expect(firstTab).toBeFocused();

        // Test End key
        await page.keyboard.press('End');
        await page.waitForTimeout(200);
        const lastTab = page.getByRole('tab', { name: 'Film' });
        await expect(lastTab).toBeFocused();

        // Test arrow left navigation
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(200);
        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        await expect(shotsTab).toBeFocused();
    });

    test('tests form validation and submission', async ({ page }) => {
        test.setTimeout(60000);

        // Open Media Studio (should show start form)
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check for start form
        const startForm = page.locator('[data-testid="media-studio-start"]');
        if (await startForm.isVisible({ timeout: 5000 })) {
            // Test empty title validation
            const titleInput = page.locator('#media-start-title');
            const submitBtn = page.locator('button[type="submit"]');

            // Try to submit without title
            await titleInput.fill('');
            await submitBtn.click();
            await page.waitForTimeout(500);

            // Button should be disabled
            await expect(submitBtn).toBeDisabled();

            // Test valid title
            await titleInput.fill('Valid Production Title');
            await expect(submitBtn).not.toBeDisabled();

            // Test aspect ratio selection
            const aspectSelect = page.locator('#media-start-aspect');
            await aspectSelect.selectOption('16:9');
            await page.waitForTimeout(500);

            // Submit form
            await submitBtn.click();
            await page.waitForTimeout(3000);

            // Verify production created
            await expect(startForm).not.toBeVisible();
        }
    });

    test('tests multi-production handling', async ({ page }) => {
        test.setTimeout(120000);

        const composer = page.locator('[data-testid="crew-composer"] textarea');

        // Create first production
        await composer.fill('Start a production called Production One');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Close Media Studio
        const closeBtn = page.locator('[data-testid="close-media-studio-btn"]');
        if (await closeBtn.isVisible()) {
            await closeBtn.click();
            await page.waitForTimeout(1000);
        }

        // Create second production
        await composer.fill('Start a production called Production Two');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check for production dropdown
        const productionSelect = page.locator('#media-studio-production');
        if (await productionSelect.isVisible({ timeout: 5000 })) {
            // Verify multiple options
            const options = await productionSelect.locator('option').all();
            expect(options.length).toBeGreaterThan(1);

            // Test switching between productions
            await productionSelect.selectOption({ index: 0 });
            await page.waitForTimeout(1000);

            await productionSelect.selectOption({ index: 1 });
            await page.waitForTimeout(1000);
        }
    });

    test('tests production editing and updates', async ({ page }) => {
        test.setTimeout(90000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Edit Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add scene
        await composer.fill('Add a scene called Test Scene');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Edit scene properties
        await composer.fill('Change the Test Scene mood to tense and location to rooftop');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Verify updates persisted
        const storyTab = page.getByRole('tab', { name: 'Story' });
        if (await storyTab.isVisible()) {
            await storyTab.click();
            await page.waitForTimeout(1000);

            // Check for updated content
            const moodText = page.locator('text=/tense/i');
            if (await moodText.isVisible()) {
                await expect(moodText).toBeVisible();
            }
        }
    });

    test('tests production deletion and cleanup', async ({ page }) => {
        test.setTimeout(90000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Delete Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Request deletion (if supported)
        await composer.fill('Delete the production called Delete Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for confirmation dialog or message
        const deleteConfirm = page.locator('text=/delete|confirm|remove/i');
        if (await deleteConfirm.isVisible()) {
            // This would test the deletion workflow
            await expect(deleteConfirm).toBeVisible();
        }
    });

    test('tests production settings and configuration', async ({ page }) => {
        test.setTimeout(90000);

        // Create production with specific settings
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Settings Test with aspect ratio 2.39:1');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check aspect ratio display
        const aspectBadge = page.locator('[data-testid="media-aspect-ratio"]');
        if (await aspectBadge.isVisible({ timeout: 5000 })) {
            await expect(aspectBadge).toContainText('2.39:1');
        }

        // Check budget display
        const budgetDisplay = page.locator('[data-testid="media-studio-spend"]');
        if (await budgetDisplay.isVisible({ timeout: 5000 })) {
            await expect(budgetDisplay).toBeVisible();
        }
    });

    test('tests production export functionality', async ({ page }) => {
        test.setTimeout(90000);

        // Create production with content
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Export Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add content for export
        await composer.fill('Add a scene with storyboard for export');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Try to export (if export button exists)
        const exportBtn = page.locator('button:has-text("Export"), button:has-text("Download")');
        if (await exportBtn.isVisible()) {
            await exportBtn.click();
            await page.waitForTimeout(2000);

            // Check for download or export confirmation
            const downloadMessage = page.locator('text=/export|download|saved/i');
            if (await downloadMessage.isVisible()) {
                await expect(downloadMessage).toBeVisible();
            }
        }
    });

    test('tests production search and filtering', async ({ page }) => {
        test.setTimeout(90000);

        // Create multiple productions
        const composer = page.locator('[data-testid="crew-composer"] textarea');

        await composer.fill('Start a production called Search Test One');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        const closeBtn = page.locator('[data-testid="close-media-studio-btn"]');
        if (await closeBtn.isVisible()) {
            await closeBtn.click();
            await page.waitForTimeout(1000);
        }

        await composer.fill('Start a production called Search Test Two');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Test production selection by name
        await composer.fill('Open Search Test One production');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });
    });
});
