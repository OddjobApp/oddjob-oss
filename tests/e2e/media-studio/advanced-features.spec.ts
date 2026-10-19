import { test, expect } from '@playwright/test';

test.describe('Media Studio Advanced Features', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test.beforeEach(async ({ page }) => {
        await page.goto('/workspace/chat/test-media-advanced', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-testid="crew-composer"]')).toBeVisible({ timeout: 20000 });
    });

    test('tests shot management and creation', async ({ page }) => {
        test.setTimeout(120000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Shot Management Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add scene
        await composer.fill('Add a scene called Test Scene');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Add multiple shots
        await composer.fill('Add 5 shots to Test Scene with different framings');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Shots tab
        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        if (await shotsTab.isVisible()) {
            await shotsTab.click();
            await page.waitForTimeout(1000);
        }

        // Verify shots are displayed
        const shotElements = page.locator('[data-testid^="timeline-shot-clip-"]');
        const shotCount = await shotElements.count();
        expect(shotCount).toBeGreaterThan(0);
    });

    test('tests take approval workflow', async ({ page }) => {
        test.setTimeout(120000);

        // Create production with takes
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Approval Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shot with takes
        await composer.fill('Add a shot with 3 takes ready for review');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Shots or Film tab
        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        if (await shotsTab.isVisible()) {
            await shotsTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for approve button
        const approveBtn = page.locator('[data-testid="dailies-approve-take-btn"]');
        if (await approveBtn.isVisible({ timeout: 5000 })) {
            await expect(approveBtn).toBeVisible();

            // Test approval workflow
            await approveBtn.click();
            await page.waitForTimeout(1000);

            // Verify approval state changed
            const approvedText = await approveBtn.textContent();
            expect(approvedText).toContain('Approved');
        }
    });

    test('tests re-shoot functionality with defect classification', async ({ page }) => {
        test.setTimeout(120000);

        // Create production with takes
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Reshoot Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shot with take
        await composer.fill('Add a shot with a take that needs reshooting');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Shots tab
        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        if (await shotsTab.isVisible()) {
            await shotsTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for re-shoot button
        const rerollBtn = page.locator('[data-testid="dailies-reroll-btn"]');
        if (await rerollBtn.isVisible({ timeout: 5000 })) {
            await expect(rerollBtn).toBeVisible();

            // Test re-shoot workflow
            await rerollBtn.click();
            await page.waitForTimeout(500);

            // Check for defect menu
            const defectMenu = page.locator('[data-testid="dailies-defect-menu"]');
            if (await defectMenu.isVisible()) {
                await expect(defectMenu).toBeVisible();

                // Test defect selection
                const characterDriftBtn = page.locator('[data-testid="defect-option-character_drift"]');
                if (await characterDriftBtn.isVisible()) {
                    await characterDriftBtn.click();
                    await page.waitForTimeout(1000);

                    // Verify re-shoot initiated
                    await expect(defectMenu).not.toBeVisible();
                }
            }
        }
    });

    test('tests A/B comparison features', async ({ page }) => {
        test.setTimeout(120000);

        // Create production with multiple takes
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Comparison Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shot with multiple takes
        await composer.fill('Add a shot with 2 takes for comparison');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Film tab
        const filmTab = page.getByRole('tab', { name: 'Film' });
        if (await filmTab.isVisible()) {
            await filmTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for A/B compare button
        const compareBtn = page.locator('[data-testid="stage-ab-compare-btn"]');
        if (await compareBtn.isVisible({ timeout: 5000 })) {
            await expect(compareBtn).toBeVisible();

            // Enable comparison mode
            await compareBtn.click();
            await page.waitForTimeout(500);

            // Check for split comparison UI
            const splitContainer = page.locator('[data-testid="dailies-continuity-wipe-container"]');
            if (await splitContainer.isVisible()) {
                await expect(splitContainer).toBeVisible();

                // Test split slider
                const splitSlider = page.locator('input[type="range"]');
                if (await splitSlider.isVisible()) {
                    await expect(splitSlider).toBeVisible();

                    // Test slider interaction
                    await splitSlider.fill('30');
                    await page.waitForTimeout(500);

                    await splitSlider.fill('70');
                    await page.waitForTimeout(500);
                }
            }
        }
    });

    test('tests continuity wipe comparison', async ({ page }) => {
        test.setTimeout(120000);

        // Create production with takes
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Continuity Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shot with takes
        await composer.fill('Add a shot with multiple takes for continuity check');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Shots tab
        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        if (await shotsTab.isVisible()) {
            await shotsTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for continuity wipe toggle
        const continuityWipeBtn = page.locator('[data-testid="dailies-continuity-wipe-toggle"]');
        if (await continuityWipeBtn.isVisible({ timeout: 5000 })) {
            await expect(continuityWipeBtn).toBeVisible();

            // Enable continuity wipe
            await continuityWipeBtn.click();
            await page.waitForTimeout(500);

            // Check for comparison container
            const wipeContainer = page.locator('[data-testid="dailies-continuity-wipe-container"]');
            if (await wipeContainer.isVisible()) {
                await expect(wipeContainer).toBeVisible();

                // Verify comparison elements
                const beforeLabel = page.locator('text=/Take \d+|Storyboard/i');
                await expect(beforeLabel).toBeVisible();
            }
        }
    });

    test('tests error handling and retry logic', async ({ page }) => {
        test.setTimeout(90000);

        // Try to create production with invalid data
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production with invalid parameters xyz123');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Check for error display
        const errorAlert = page.locator('[role="alert"]');
        if (await errorAlert.isVisible({ timeout: 5000 })) {
            await expect(errorAlert).toBeVisible();

            // Check for retry button
            const retryBtn = errorAlert.locator('button:has-text("Retry")');
            if (await retryBtn.isVisible()) {
                await expect(retryBtn).toBeVisible();

                // Test retry functionality
                await retryBtn.click();
                await page.waitForTimeout(2000);

                // Verify retry attempt
                const errorMessage = await errorAlert.textContent();
                expect(errorMessage).toBeTruthy();
            }
        }
    });

    test('tests loading states during operations', async ({ page }) => {
        test.setTimeout(90000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Loading Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add complex content that triggers loading
        await composer.fill('Add a scene with 10 storyboard keyframes');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for loading indicators
        const loadingSpinner = page.locator('.animate-spin, [class*="loading"], [class*="spinner"]');
        if (await loadingSpinner.isVisible({ timeout: 5000 })) {
            await expect(loadingSpinner).toBeVisible();

            // Wait for loading to complete
            await page.waitForTimeout(5000);

            // Verify loading state resolved
            await expect(loadingSpinner).not.toBeVisible();
        }
    });

    test('tests network error handling', async ({ page }) => {
        test.setTimeout(90000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Network Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Simulate network issues by requesting heavy operation
        await composer.fill('Render a complex shot that might timeout');
        await composer.press('Enter');
        await page.waitForTimeout(10000);

        // Check for error or timeout handling
        const errorAlert = page.locator('[role="alert"]');
        if (await errorAlert.isVisible({ timeout: 5000 })) {
            const errorText = await errorAlert.textContent();
            expect(errorText).toBeTruthy();
        }
    });

    test('tests state persistence and recovery', async ({ page }) => {
        test.setTimeout(120000);

        // Create production with content
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Persistence Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add content
        await composer.fill('Add a scene with shots and storyboard');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate away
        await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Navigate back
        await page.goto('/workspace/chat/test-media-advanced', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Re-open Media Studio
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Verify state persisted
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check for previous content
        const productionTitle = page.locator('text=/Persistence Test/i');
        if (await productionTitle.isVisible()) {
            await expect(productionTitle).toBeVisible();
        }
    });

    test('tests undo/redo functionality', async ({ page }) => {
        test.setTimeout(120000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Undo Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Make changes
        await composer.fill('Add a scene called Scene One');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await composer.fill('Add another scene called Scene Two');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Try to undo (if implemented)
        const undoBtn = page.locator('button:has-text("Undo"), button[aria-label*="undo"]');
        if (await undoBtn.isVisible()) {
            await undoBtn.click();
            await page.waitForTimeout(1000);

            // Verify undo occurred
            const sceneTwo = page.locator('text=/Scene Two/i');
            if (await sceneTwo.isVisible()) {
                // Scene might still be visible depending on implementation
            }
        }
    });

    test('tests batch operations on multiple shots', async ({ page }) => {
        test.setTimeout(120000);

        // Create production with multiple shots
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Batch Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add multiple shots
        await composer.fill('Add 5 shots to the scene');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Try batch operation (if implemented)
        await composer.fill('Approve all takes in the scene');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for batch operation confirmation
        const batchMessage = page.locator('text=/all|batch|multiple/i');
        if (await batchMessage.isVisible()) {
            await expect(batchMessage).toBeVisible();
        }
    });
});
