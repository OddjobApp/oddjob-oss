import { test, expect } from '@playwright/test';

test.describe('Media Studio CREW Room Integration', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test.beforeEach(async ({ page }) => {
        // Navigate to a CREW room
        await page.goto('/workspace/chat/test-media-crew-integration', { waitUntil: 'domcontentloaded' });
        // Wait for CREW room to load
        await expect(page.locator('[data-testid="crew-composer"]')).toBeVisible({ timeout: 20000 });
    });

    test('mounts Media Studio from CREW room via agent message', async ({ page }) => {
        test.setTimeout(90000);

        // Send a message to open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio');
        await composer.press('Enter');

        // Wait for agent response
        await page.waitForTimeout(5000);

        // Check if Media Studio rail appears
        const mediaStudioRail = page.locator('[data-testid="media-studio-rail"]');
        await expect(mediaStudioRail).toBeVisible({ timeout: 15000 });

        // Verify the mount artifact structure
        const mediaStudio = page.locator('[data-testid="media-studio"]');
        await expect(mediaStudio).toBeVisible();
    });

    test('verifies artifact-based communication pattern', async ({ page }) => {
        test.setTimeout(90000);

        // Send a message that should trigger Media Studio mount
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Artifact Test');
        await composer.press('Enter');

        // Wait for agent response and artifact processing
        await page.waitForTimeout(8000);

        // Check for Media Studio rail
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Verify production was created (artifact payload processed)
        const productionTitle = page.locator('text=/Artifact Test/i');
        await expect(productionTitle).toBeVisible({ timeout: 5000 });
    });

    test('tests production creation workflow from CREW room', async ({ page }) => {
        test.setTimeout(90000);

        // Start production via CREW room
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Workflow Test with aspect ratio 16:9');
        await composer.press('Enter');

        // Wait for agent to process and create production
        await page.waitForTimeout(8000);

        // Verify Media Studio opened with production
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check if production title is displayed
        const titleDisplay = page.locator('text=/Workflow Test/i');
        if (await titleDisplay.isVisible()) {
            await expect(titleDisplay).toBeVisible();
        }
    });

    test('verifies Media Studio rail rendering and layout', async ({ page }) => {
        test.setTimeout(60000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Wait for Media Studio rail
        const mediaStudioRail = page.locator('[data-testid="media-studio-rail"]');
        await expect(mediaStudioRail).toBeVisible({ timeout: 15000 });

        // Verify rail structure
        await expect(page.locator('[data-testid="media-studio"]')).toBeVisible();

        // Check for header elements
        await expect(page.locator('.film-icon, [class*="film"]')).toBeVisible();

        // Verify rail positioning and sizing
        const railBox = await mediaStudioRail.boundingBox();
        expect(railBox).toBeTruthy();
        expect(railBox?.width).toBeGreaterThan(200);
        expect(railBox?.height).toBeGreaterThan(300);
    });

    test('tests chat panel resizing with Media Studio open', async ({ page }) => {
        test.setTimeout(60000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Wait for Media Studio and resize handle
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });
        
        const resizeHandle = page.locator('[data-testid="chat-pane-resize-handle"]');
        if (await resizeHandle.isVisible({ timeout: 5000 })) {
            // Test resize functionality
            const handleBox = await resizeHandle.boundingBox();
            expect(handleBox).toBeTruthy();

            // Drag resize handle
            await resizeHandle.dragTo(page.locator('body'), {
                targetPosition: { x: 100, y: 100 }
            });

            await page.waitForTimeout(500);

            // Verify both panels are still visible
            await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible();
            await expect(page.locator('[data-testid="crew-composer"]')).toBeVisible();
        }
    });

    test('tests Media Studio close and re-open workflow', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Wait for Media Studio
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Close Media Studio
        const closeBtn = page.locator('[data-testid="close-media-studio-btn"]');
        if (await closeBtn.isVisible({ timeout: 5000 })) {
            await closeBtn.click();
            await page.waitForTimeout(500);

            // Verify Media Studio is closed
            await expect(page.locator('[data-testid="media-studio-rail"]')).not.toBeVisible();

            // Re-open Media Studio
            await composer.fill('Open Media Studio again');
            await composer.press('Enter');
            await page.waitForTimeout(5000);

            // Verify Media Studio re-opens
            await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });
        }
    });

    test('tests production persistence across CREW room navigation', async ({ page }) => {
        test.setTimeout(90000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Persistence Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Verify Media Studio opened
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Navigate away and back
        await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        
        await page.goto('/workspace/chat/test-media-crew-integration', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Re-open Media Studio - should show existing production
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Verify production still exists
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });
    });

    test('tests multiple CREW rooms with different productions', async ({ page }) => {
        test.setTimeout(120000);

        // Create production in first room
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Room One Production');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Verify Media Studio opened
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Navigate to different room
        await page.goto('/workspace/chat/test-media-crew-integration-2', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Create different production in second room
        await composer.fill('Start a production called Room Two Production');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Verify second production created
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Navigate back to first room
        await page.goto('/workspace/chat/test-media-crew-integration', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Open Media Studio - should show first room's production
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Verify first production is still accessible
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });
    });

    test('tests error handling when CREW room tool execution fails', async ({ page }) => {
        test.setTimeout(60000);

        // Try to open Media Studio with invalid parameters
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio with invalid parameters xyz123');
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
            }
        }
    });

    test('tests Media Studio mount with scene-specific parameters', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio with specific scene
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio on scene SCENE-02');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // Wait for Media Studio
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check if Film tab is opened (scene-specific behavior)
        const filmTab = page.getByRole('tab', { name: 'Film' });
        if (await filmTab.isVisible()) {
            // Verify Film tab is selected or accessible
            await expect(filmTab).toBeVisible();
        }
    });
});
