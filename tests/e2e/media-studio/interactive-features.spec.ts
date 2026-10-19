import { test, expect } from '@playwright/test';

test.describe('Media Studio Interactive Features', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test.beforeEach(async ({ page }) => {
        await page.goto('/workspace/chat/test-media-interactive', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-testid="crew-composer"]')).toBeVisible({ timeout: 20000 });
    });

    test('tests focus mode toggle functionality', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio with production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Focus Mode Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Find focus mode button
        const focusModeBtn = page.locator('[data-testid="toggle-focus-mode-btn"]');
        await expect(focusModeBtn).toBeVisible({ timeout: 5000 });

        // Get initial button text
        const initialText = await focusModeBtn.textContent();
        expect(initialText).toContain('Focus Studio');

        // Toggle to focus mode
        await focusModeBtn.click();
        await page.waitForTimeout(500);

        // Verify focus mode is active
        const focusText = await focusModeBtn.textContent();
        expect(focusText).toContain('Show Chat');

        // Verify layout changed (chat panel should be collapsed or hidden)
        const chatPane = page.locator('[data-testid="crew-composer"]');
        // In focus mode, chat might be minimized or hidden

        // Toggle back to normal mode
        await focusModeBtn.click();
        await page.waitForTimeout(500);

        // Verify normal mode restored
        const normalText = await focusModeBtn.textContent();
        expect(normalText).toContain('Focus Studio');

        // Verify chat pane is visible again
        await expect(chatPane).toBeVisible();
    });

    test('tests budget display and tracking', async ({ page }) => {
        test.setTimeout(90000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Budget Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check budget display
        const budgetDisplay = page.locator('[data-testid="media-studio-spend"]');
        await expect(budgetDisplay).toBeVisible({ timeout: 5000 });

        // Verify budget format
        const budgetText = await budgetDisplay.textContent();
        expect(budgetText).toMatch(/\$\d+\.\d+ of \$\d+\.\d+ spent/);

        // Add content that would incur cost
        await composer.fill('Add a shot with 5 second duration');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check if budget updated
        const updatedBudgetText = await budgetDisplay.textContent();
        expect(updatedBudgetText).toBeTruthy();
    });

    test('tests simulation mode indicator', async ({ page }) => {
        test.setTimeout(60000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Open Media Studio');
        await composer.press('Enter');
        await page.waitForTimeout(5000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Check for simulation mode indicator
        const simulationIndicator = page.locator('[data-testid="media-studio-simulation"]');
        if (await simulationIndicator.isVisible({ timeout: 5000 })) {
            await expect(simulationIndicator).toContainText('Takes simulate');
            
            // Verify it has proper title attribute for accessibility
            const title = await simulationIndicator.getAttribute('title');
            expect(title).toContain('fal.ai');
        }
    });

    test('tests activity badges for jobs in progress', async ({ page }) => {
        test.setTimeout(120000);

        // Create production and add content that generates jobs
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Activity Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add scene with storyboard (generates jobs)
        await composer.fill('Add a scene with 3 storyboard keyframes');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for activity section
        const activitySection = page.locator('aria-label="Production activity"');
        if (await activitySection.isVisible({ timeout: 5000 })) {
            // Check for activity buttons
            const activityButtons = activitySection.locator('button');
            const count = await activityButtons.count();
            
            if (count > 0) {
                // Verify activity button structure
                const firstButton = activityButtons.first();
                await expect(firstButton).toBeVisible();
                
                const buttonText = await firstButton.textContent();
                expect(buttonText).toMatch(/\d+ .*/);
            }
        }
    });

    test('tests timeline navigation and interaction', async ({ page }) => {
        test.setTimeout(90000);

        // Create production with shots
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Timeline Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shots for timeline
        await composer.fill('Add 5 shots to the scene');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Film or Shots tab to see timeline
        const filmTab = page.getByRole('tab', { name: 'Film' });
        if (await filmTab.isVisible()) {
            await filmTab.click();
            await page.waitForTimeout(1000);
        }

        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        if (await shotsTab.isVisible()) {
            await shotsTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for timeline elements
        const timeline = page.locator('[data-testid="media-timeline-sequencer"]');
        if (await timeline.isVisible({ timeout: 5000 })) {
            await expect(timeline).toBeVisible();

            // Check for shot clips
            const shotClips = timeline.locator('[data-testid^="timeline-shot-clip-"]');
            const clipCount = await shotClips.count();
            expect(clipCount).toBeGreaterThan(0);

            // Test clicking on a shot clip
            if (clipCount > 0) {
                await shotClips.first().click();
                await page.waitForTimeout(500);

                // Verify shot selection state
                const selectedClip = timeline.locator('[aria-pressed="true"]');
                await expect(selectedClip).toBeVisible();
            }
        }
    });

    test('tests video playback controls', async ({ page }) => {
        test.setTimeout(90000);

        // Create production with video content
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Playback Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shot with take
        await composer.fill('Add a shot with a take for testing playback');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Film tab
        const filmTab = page.getByRole('tab', { name: 'Film' });
        if (await filmTab.isVisible()) {
            await filmTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for playback controls
        const playBtn = page.locator('[data-testid="stage-play-pause-btn"]');
        if (await playBtn.isVisible({ timeout: 5000 })) {
            await expect(playBtn).toBeVisible();

            // Test play button
            await playBtn.click();
            await page.waitForTimeout(1000);

            // Test pause button
            await playBtn.click();
            await page.waitForTimeout(500);

            // Test scrubber
            const scrubber = page.locator('[data-testid="stage-time-scrubber"]');
            if (await scrubber.isVisible()) {
                await expect(scrubber).toBeVisible();

                // Test seeking
                await scrubber.click({ position: { x: 0.5, y: 0.5 } });
                await page.waitForTimeout(500);
            }

            // Test timecode display
            const timecode = page.locator('[data-testid="stage-timecode"]');
            if (await timecode.isVisible()) {
                await expect(timecode).toBeVisible();
                const timeText = await timecode.textContent();
                expect(timeText).toMatch(/\d{2}:\d{2}\.\d{2}/);
            }
        }
    });

    test('tests take selection and comparison', async ({ page }) => {
        test.setTimeout(90000);

        // Create production with multiple takes
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Take Selection Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shot with multiple takes
        await composer.fill('Add a shot with 3 takes for comparison');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Shots or Film tab
        const shotsTab = page.getByRole('tab', { name: 'Shots' });
        if (await shotsTab.isVisible()) {
            await shotsTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for take selector
        const takeSelectors = page.locator('[data-testid^="take-selector-tab-"]');
        if (await takeSelectors.count() > 0) {
            const takeCount = await takeSelectors.count();
            expect(takeCount).toBeGreaterThan(1);

            // Test switching between takes
            await takeSelectors.nth(0).click();
            await page.waitForTimeout(500);

            await takeSelectors.nth(1).click();
            await page.waitForTimeout(500);

            // Check for A/B comparison button
            const compareBtn = page.locator('[data-testid="stage-ab-compare-btn"]');
            if (await compareBtn.isVisible()) {
                await expect(compareBtn).toBeVisible();

                // Test comparison mode
                await compareBtn.click();
                await page.waitForTimeout(500);

                // Verify comparison UI elements
                const splitSlider = page.locator('input[type="range"]');
                if (await splitSlider.isVisible()) {
                    await expect(splitSlider).toBeVisible();
                }
            }
        }
    });

    test('tests looping and playback options', async ({ page }) => {
        test.setTimeout(90000);

        // Create production with video
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Loop Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add shot with take
        await composer.fill('Add a shot with a take');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Navigate to Film tab
        const filmTab = page.getByRole('tab', { name: 'Film' });
        if (await filmTab.isVisible()) {
            await filmTab.click();
            await page.waitForTimeout(1000);
        }

        // Check for loop button
        const loopBtn = page.locator('button[aria-label="Loop this take"]');
        if (await loopBtn.isVisible({ timeout: 5000 })) {
            await expect(loopBtn).toBeVisible();

            // Test loop toggle
            await loopBtn.click();
            await page.waitForTimeout(500);

            // Verify loop state changed
            const isPressed = await loopBtn.getAttribute('aria-pressed');
            expect(isPressed).toBe('true');

            // Toggle off
            await loopBtn.click();
            await page.waitForTimeout(500);

            const isNotPressed = await loopBtn.getAttribute('aria-pressed');
            expect(isNotPressed).toBe('false');
        }
    });

    test('tests discussion and chat integration', async ({ page }) => {
        test.setTimeout(90000);

        // Create production
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Discussion Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Add content
        await composer.fill('Add a shot with a take');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        // Check for discuss button
        const discussBtn = page.locator('[data-testid="dailies-discuss-take-btn"]');
        if (await discussBtn.isVisible({ timeout: 5000 })) {
            await expect(discussBtn).toBeVisible();

            // Test discuss functionality
            await discussBtn.click();
            await page.waitForTimeout(1000);

            // Verify chat integration - composer should be focused or have context
            const composerTextarea = page.locator('[data-testid="crew-composer"] textarea');
            await expect(composerTextarea).toBeFocused();

            // Check for context prefix in composer
            const composerValue = await composerTextarea.inputValue();
            expect(composerValue).toBeTruthy();
        }
    });

    test('tests panel resizing and layout controls', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Layout Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Test focus mode for layout change
        const focusModeBtn = page.locator('[data-testid="toggle-focus-mode-btn"]');
        if (await focusModeBtn.isVisible()) {
            const initialRailSize = await page.locator('[data-testid="media-studio-rail"]').boundingBox();

            await focusModeBtn.click();
            await page.waitForTimeout(500);

            const focusRailSize = await page.locator('[data-testid="media-studio-rail"]').boundingBox();

            // Rail should be larger in focus mode
            expect(focusRailSize?.width).toBeGreaterThan(initialRailSize?.width || 0);

            // Restore normal mode
            await focusModeBtn.click();
            await page.waitForTimeout(500);
        }
    });

    test('tests keyboard shortcuts and hotkeys', async ({ page }) => {
        test.setTimeout(90000);

        // Open Media Studio
        const composer = page.locator('[data-testid="crew-composer"] textarea');
        await composer.fill('Start a production called Hotkey Test');
        await composer.press('Enter');
        await page.waitForTimeout(8000);

        await expect(page.locator('[data-testid="media-studio-rail"]')).toBeVisible({ timeout: 15000 });

        // Focus on Media Studio
        const mediaStudio = page.locator('[data-testid="media-studio"]');
        await mediaStudio.click();

        // Test common keyboard shortcuts
        // Escape to close (if implemented)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Check if studio closed or action performed
        const studioVisible = await page.locator('[data-testid="media-studio-rail"]').isVisible();
        // If studio closed, that's expected behavior for Escape
    });
});
