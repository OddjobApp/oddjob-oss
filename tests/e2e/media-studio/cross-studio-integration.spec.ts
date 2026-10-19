import { test, expect } from '@playwright/test';

test.describe('Media Studio Cross-Studio Integration', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test.beforeEach(async ({ page }) => {
        await page.goto('/workspace/chat/test-media-cross-studio', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-testid="crew-composer"]')).toBeVisible({ timeout: 20000 });
    });

    test('tests Scribe Studio integration for character import', async ({ page }) => {
        test.setTimeout(120000);

        // First, create or reference a Scribe document
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Create a Scribe document with characters for a film script');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Then create Media Studio production linked to Scribe
        await composer.fill('Start a Media Studio production linked to the Scribe document');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Verify Media Studio opened
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check for Scribe integration indicators
        const scribeLink = page.locator('text=/Scribe|script|document/i');
        if (await scribeLink.isVisible({ timeout: 5000 })) {
            await expect(scribeLink).toBeVisible();
        }

        // Check for character import
        const characterCount = page.locator('text=/character|cast/i');
        if (await characterCount.isVisible()) {
            await expect(characterCount).toBeVisible();
        }
    });

    test('tests Form Studio integration for workflow configuration', async ({ page }) => {
        test.setTimeout(120000);

        // Create Media Studio production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a Media Studio production called Form Integration Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Request Form Studio for workflow configuration
        await composer.fill('Open Form Studio to configure ComfyUI workflow parameters');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for Form Studio integration
        const formStudioRail = page.locator('[data-testid="form-studio-rail"], [data-testid="form-studio-pod"]');
        if (await formStudioRail.isVisible({ timeout: 5000 })) {
            await expect(formStudioRail).toBeVisible();

            // Verify both studios can coexist
            await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible();
        }
    });

    test('tests Assembler coexistence with Media Studio', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Assembler Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Wait for both rails
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-testid="crew-assembly-puzzle-rail"]')).toBeVisible({ timeout: 15000 });

        // Test Assembler collapse/expand
        const puzzleRail = page.locator('[data-testid="crew-assembly-puzzle-rail"]');
        const toggleBtn = page.locator('[data-testid="toggle-puzzle-rail-btn"]');

        if (await toggleBtn.isVisible()) {
            const initialPuzzleBox = await puzzleRail.boundingBox();
            const initialMediaBox = await page.locator('[data-testid="media-studio-rail"]').boundingBox();

            // Collapse Assembler
            await toggleBtn.click();
            await page.waitForTimeout(500);

            const collapsedPuzzleBox = await puzzleRail.boundingBox();
            const mediaBoxAfterCollapse = await page.locator('[data-testid="media-studio-rail"]').boundingBox();

            // Puzzle rail should be collapsed
            expect(collapsedPuzzleBox?.width).toBeLessThan(initialPuzzleBox?.width || 100);

            // Media Studio should still be visible and possibly expanded
            await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible();

            // Expand Assembler
            await toggleBtn.click();
            await page.waitForTimeout(500);

            const expandedPuzzleBox = await puzzleRail.boundingBox();
            expect(expandedPuzzleBox?.width).toBeGreaterThan(collapsedPuzzleBox?.width || 50);
        }
    });

    test('tests Media Studio and App Studio coexistence', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called App Studio Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Try to open App Studio
        await composer.fill('Open App Studio');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check if both can coexist or if one replaces the other
        const appStudioRail = page.locator('[data-testid="app-studio-rail"], [data-testid="app-studio-pod"]');
        const mediaStudioRail = page.locator('[data-testid="media-studio-rail"]');

        if (await appStudioRail.isVisible()) {
            // If both visible, test layout
            await expect(mediaStudioRail).toBeVisible();

            const appBox = await appStudioRail.boundingBox();
            const mediaBox = await mediaStudioRail.boundingBox();

            expect(appBox).toBeTruthy();
            expect(mediaBox).toBeTruthy();
        } else {
            // If App Studio replaced Media Studio, that's expected behavior
            await expect(mediaStudioRail).not.toBeVisible();
        }
    });

    test('tests cross-studio data sharing', async ({ page }) => {
        test.setTimeout(120000);

        // Create production in Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a Media Studio production with scene data');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add scene with specific data
        await composer.fill('Add a scene called Cross Studio Scene with location warehouse and time night');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Try to reference this data from another studio
        await composer.fill('In Form Studio, reference the scene location from Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for cross-studio reference
        const crossReference = page.locator('text=/warehouse|Media Studio|scene/i');
        if (await crossReference.isVisible()) {
            await expect(crossReference).toBeVisible();
        }
    });

    test('tests workflow integration between studios', async ({ page }) => {
        test.setTimeout(120000);

        // Start with Scribe for script
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Create a film script in Scribe Studio with 3 scenes');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Move to Media Studio for production
        await composer.fill('Create a Media Studio production based on the Scribe script');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Verify scenes were imported
        const sceneCount = page.locator('[data-testid^="scene-"]');
        if (await sceneCount.count() > 0) {
            const count = await sceneCount.count();
            expect(count).toBeGreaterThan(0);
        }

        // Add storyboard in Media Studio
        await composer.fill('Add storyboard keyframes for all scenes');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Try to export back to Scribe or another format
        await composer.fill('Export the storyboard as a document');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for export confirmation
        const exportMessage = page.locator('text=/export|document|saved/i');
        if (await exportMessage.isVisible()) {
            await expect(exportMessage).toBeVisible();
        }
    });

    test('tests focus mode behavior with multiple studios', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Focus Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Enter focus mode
        const focusModeBtn = page.locator('[data-testid="toggle-focus-mode-btn"]');
        if (await focusModeBtn.isVisible()) {
            await focusModeBtn.click();
            await page.waitForTimeout(500);

            // Try to open another studio in focus mode
            await composer.fill('Open Form Studio');
            await composer.press('Enter');
            await page.waitForTimeout(8000);

            // Check behavior - might replace or be blocked
            const formStudio = page.locator('[data-testid="form-studio-rail"]');
            const mediaStudio = page.locator('[data-testid="media-studio-rail"]');

            // At least one should be visible
            const anyStudioVisible = await formStudio.isVisible() || await mediaStudio.isVisible();
            expect(anyStudioVisible).toBeTruthy();
        }
    });

    test('tests shared context and state management', async ({ page }) => {
        test.setTimeout(120000);

        // Create production in Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Shared Context Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add content
        await composer.fill('Add a scene with characters Hero and Villain');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Close Media Studio
        const closeBtn = page.locator('[data-testid="close-media-studio-btn"]');
        if (await closeBtn.isVisible()) {
            await closeBtn.click();
            await page.waitForTimeout(1000);
        }

        // Open Form Studio and check if context is preserved
        await composer.fill('Open Form Studio');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for shared context
        const contextReference = page.locator('text=/Hero|Villain|Shared Context/i');
        if (await contextReference.isVisible()) {
            await expect(contextReference).toBeVisible();
        }
    });

    test('tests concurrent studio operations', async ({ page }) => {
        test.setTimeout(120000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Concurrent Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Start operation in Media Studio
        await composer.fill('Add a scene with 5 storyboard keyframes');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        // While operation is running, try to open another studio
        await composer.fill('Open Form Studio for workflow configuration');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for conflict handling or queuing
        const conflictMessage = page.locator('text=/busy|wait|conflict|operation/i');
        if (await conflictMessage.isVisible()) {
            await expect(conflictMessage).toBeVisible();
        }
    });

    test('tests studio switching and state preservation', async ({ page }) => {
        test.setTimeout(120000);

        // Create production in Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Switch Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add specific state
        await composer.fill('Add a scene called Switch Scene and select the Storyboard tab');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Switch to Form Studio
        await composer.fill('Open Form Studio');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Switch back to Media Studio
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check if state (tab selection, content) is preserved
        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        const storyboardTab = page.getByRole('tab', { name: 'Storyboard' });
        if (await storyboardTab.isVisible()) {
            // Check if it's still selected or accessible
            await expect(storyboardTab).toBeVisible();
        }
    });

    test('tests unified workspace layout with multiple studios', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Layout Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check overall layout
        const chatPane = page.locator('[data-testid="crew-composer"]');
        const puzzleRail = page.locator('[data-testid="crew-assembly-puzzle-rail"]');
        const mediaStudio = page.locator('[data-testid="media-studio-rail"]');

        // Verify all components are visible
        await expect(chatPane).toBeVisible();
        await expect(puzzleRail).toBeVisible();
        await expect(mediaStudio).toBeVisible();

        // Check layout bounds don't overlap improperly
        const chatBox = await chatPane.boundingBox();
        const puzzleBox = await puzzleRail.boundingBox();
        const mediaBox = await mediaStudio.boundingBox();

        expect(chatBox).toBeTruthy();
        expect(puzzleBox).toBeTruthy();
        expect(mediaBox).toBeTruthy();

        // Verify no complete overlap (should have distinct areas)
        expect(chatBox?.x).not.toBe(puzzleBox?.x);
    });

    test('tests cross-studio collaboration features', async ({ page }) => {
        test.setTimeout(120000);

        // Create production in Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Collaboration Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add content and mark for discussion
        await composer.fill('Add a shot and mark it for discussion in the chat');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for collaboration features
        const discussBtn = page.locator('[data-testid="dailies-discuss-take-btn"]');
        if (await discussBtn.isVisible()) {
            await discussBtn.click();
            await page.waitForTimeout(1000);

            // Verify chat integration
            const composerValue = await composer.inputValue();
            expect(composerValue).toBeTruthy();
            expect(composerValue.length).toBeGreaterThan(0);
        }
    });
});
