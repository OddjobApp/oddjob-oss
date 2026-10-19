import { test, expect } from '@playwright/test';

/**
 * Regression test for "Open app results in broken screen".
 *
 * The bug: clicking "Open app" on an app card (e.g. "Research & RFC Synthesis
 * Portal") navigates to `/app/<slugified-title>` instead of
 * `/app/<public_slug>`. The proxy cannot resolve the invented slug and returns
 * a 404 / "App or Deployment not found" screen.
 *
 * This spec locates an installed app, clicks its launch button, and asserts
 * that the resulting URL uses a real public_slug (not a naive title slugification)
 * and that the page does NOT show an error.
 */

test.describe('App launch from crew chat / app catalog', () => {

    /**
     * Part 1 – Crew chat: ask Copilot to open an app and verify the launched URL.
     */
    test('Copilot open-app card navigates to a real slug, not a 404', async ({ page, context }) => {
        test.setTimeout(180_000);

        // Go to the crew / workspace chat
        await page.goto('/workspace/chat', { waitUntil: 'domcontentloaded' });

        // Wait for the page to be interactive
        const pageTitle = page.locator('h1, [data-testid="page-title"], .page-title').first();
        await page.waitForTimeout(3000);

        console.log('--- Navigated to /workspace/chat ---');
        await page.screenshot({ path: 'test-results/crew-open-app-01-loaded.png' });

        // Find the chat input in the crew room
        const chatInput = page.locator('textarea, input[type="text"]').filter({ hasText: '' }).first();
        
        // Wait for input to be visible
        await chatInput.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
            console.log('Chat input not immediately found, looking harder...');
        });

        // Try a broader selector if the first one failed
        const inputs = await page.locator('textarea').all();
        console.log(`Found ${inputs.length} textarea(s)`);

        if (inputs.length === 0) {
            // Maybe we need to navigate differently
            await page.screenshot({ path: 'test-results/crew-open-app-no-input.png' });
            console.log('Page URL:', page.url());
            console.log('Page content (first 1000 chars):', (await page.content()).slice(0, 1000));
        }

        const textarea = page.locator('textarea').first();
        await expect(textarea).toBeVisible({ timeout: 30_000 });

        // Track any new pages/tabs that open
        const newPagePromise = context.waitForEvent('page', { timeout: 15_000 }).catch(() => null);

        // Type a prompt that asks Copilot to open an app
        await textarea.fill('Open the Research RFC Synthesis app for me');
        
        // Wait for the chat API response
        const responsePromise = page.waitForResponse(
            (r) => r.url().includes('/api/crew') || r.url().includes('/api/agent/chat'),
            { timeout: 90_000 }
        );

        await textarea.press('Enter');
        console.log('--- Sent message, waiting for response ---');

        const response = await responsePromise.catch(() => null);
        if (response) {
            console.log('Response URL:', response.url(), '| Status:', response.status());
        }

        // Let the UI settle and render artifacts
        await page.waitForTimeout(5000);
        await page.screenshot({ path: 'test-results/crew-open-app-02-after-response.png' });

        // Find the Open app button
        const openAppBtn = page.locator('[data-testid="app-launch-open"]').first();
        const openAppBtnVisible = await openAppBtn.isVisible().catch(() => false);
        console.log('Open app button visible:', openAppBtnVisible);

        if (openAppBtnVisible) {
            // Read the displayed href from the card (the monospace URL slug shown below the title)
            const hrefDisplay = page.locator('[data-testid="turn-app-launch"] span.font-mono').first();
            const displayedHref = await hrefDisplay.textContent().catch(() => '');
            console.log('Displayed href on card:', displayedHref);

            // Slugified titles look like: research-rfc-synthesis-portal-org-1
            // Real public_slugs look like: research-workbench-8fd06
            const looksLikeSlugifiedTitle = /([a-z]+-){4,}/.test(displayedHref) &&
                !/[a-f0-9]{4,}/.test(displayedHref);
            console.log('Looks like slugified title?', looksLikeSlugifiedTitle);

            // Click Open app — it opens in a new tab
            const newTab = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
            await openAppBtn.click();
            const newPage = await newTab;

            if (newPage) {
                await newPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
                const newUrl = newPage.url();
                console.log('New tab URL:', newUrl);
                await newPage.screenshot({ path: 'test-results/crew-open-app-03-new-tab.png' });

                // Check the page doesn't show an error
                const bodyText = await newPage.locator('body').innerText().catch(() => '');
                console.log('New tab body (first 500):', bodyText.slice(0, 500));

                const hasError = bodyText.toLowerCase().includes('not found') ||
                    bodyText.toLowerCase().includes('deployment not found') ||
                    bodyText.toLowerCase().includes('app or deployment') ||
                    newPage.url().includes('404');
                console.log('Has error:', hasError);

                // Assert: the slug in the URL must NOT just be the title slugified
                // A real slug from the DB will contain a short hash (e.g. "-8fd06")
                // or at minimum should not be a naive kebab of the app title.
                expect(newUrl, 'The launched URL looks like a slugified title rather than a real public_slug').not.toMatch(
                    /\/app\/research-rfc-synthesis-portal/
                );
                expect(hasError, 'The launched app page shows an error/404').toBe(false);
            } else {
                // Button might navigate in-place
                await page.waitForTimeout(2000);
                const currentUrl = page.url();
                console.log('Current URL after click:', currentUrl);
                expect(currentUrl).not.toMatch(/\/app\/research-rfc-synthesis-portal/);
            }
        } else {
            // No button yet — log what's on screen for debugging
            const turnArtifacts = page.locator('[data-testid="turn-artifact"], [data-testid="turn-app-launch"]');
            const artifactCount = await turnArtifacts.count();
            console.log('Turn artifact count:', artifactCount);
            
            const fullText = await page.locator('body').innerText().catch(() => '');
            console.log('Page text (first 2000):', fullText.slice(0, 2000));
            await page.screenshot({ path: 'test-results/crew-open-app-no-button.png' });

            // Soft-fail with detail so we can see what happened
            test.fail(true, 'No Open app button rendered — see screenshot crew-open-app-no-button.png');
        }
    });

    /**
     * Part 2 – Direct proxy test: verify the real slug resolves, and the
     * slugified title does NOT (confirming the bug is proxy-side, not just UI).
     */
    test('proxy resolves real public_slug but rejects slugified title', async ({ page }) => {
        test.setTimeout(30_000);

        // The real public_slug we found in the DB
        const realSlug = 'research-workbench-8fd06';
        // The invented slug the agent produces by slugifying the title
        const badSlug = 'research-rfc-synthesis-portal-org-1';

        // Real slug should not 404
        const realResponse = await page.request.get(`/app/${realSlug}`);
        console.log(`GET /app/${realSlug} → ${realResponse.status()}`);
        expect(realResponse.status(), `Real slug ${realSlug} returned a non-2xx status`).toBeLessThan(400);

        // Bad slug should 404
        const badResponse = await page.request.get(`/app/${badSlug}`);
        console.log(`GET /app/${badSlug} → ${badResponse.status()}`);
        const badBody = await badResponse.text();
        console.log('Bad slug response body (first 300):', badBody.slice(0, 300));

        // We expect a 404 for the invented slug
        expect(badResponse.status(), `Slugified title ${badSlug} should return 404 but got ${badResponse.status()}`).toBe(404);
    });
});
