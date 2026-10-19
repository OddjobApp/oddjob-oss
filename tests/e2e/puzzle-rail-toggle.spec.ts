import { test, expect } from '@playwright/test';

test.describe('Assembler Collapse & Expand', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test('Assembler toggles collapse and expand cleanly', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/workspace/chat', { waitUntil: 'domcontentloaded' });

        // Wait for page load
        const puzzleRail = page.getByTestId('crew-assembly-puzzle-rail');
        await expect(puzzleRail).toBeVisible({ timeout: 20000 });

        const toggleBtn = page.getByTestId('toggle-puzzle-rail-btn');
        await expect(toggleBtn).toBeVisible({ timeout: 5000 });

        const initialBox = await puzzleRail.boundingBox();
        console.log('Initial rail bounding box:', initialBox);

        if (initialBox && initialBox.width > 50) {
            // Click to collapse
            await toggleBtn.click();
            await page.waitForTimeout(500);
            const collapsedBox = await puzzleRail.boundingBox();
            console.log('Collapsed bounding box:', collapsedBox);
            expect(collapsedBox?.width).toBeLessThanOrEqual(60);

            // Click to expand
            await toggleBtn.click();
            await page.waitForTimeout(500);
            const expandedBox = await puzzleRail.boundingBox();
            console.log('Expanded bounding box:', expandedBox);
            expect(expandedBox?.width).toBeGreaterThan(100);
        } else {
            // Click to expand
            await toggleBtn.click();
            await page.waitForTimeout(500);
            const expandedBox = await puzzleRail.boundingBox();
            console.log('Expanded bounding box:', expandedBox);
            expect(expandedBox?.width).toBeGreaterThan(100);

            // Click to collapse
            await toggleBtn.click();
            await page.waitForTimeout(500);
            const collapsedBox = await puzzleRail.boundingBox();
            console.log('Collapsed bounding box:', collapsedBox);
            expect(collapsedBox?.width).toBeLessThanOrEqual(60);
        }
    });
});
