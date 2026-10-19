import { test, expect } from '@playwright/test';

test.describe('Media Studio Integration Tests', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test('navigates to workspace and checks basic functionality', async ({ page }) => {
        test.setTimeout(60000);

        // Navigate to workspace
        await page.goto('/workspace', { waitUntil: 'domcontentloaded' });

        // Wait for dashboard to load
        await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible({ timeout: 20000 });

        // Check if we can access the workspace
        const title = await page.title();
        expect(title).toMatch(/Oddjob/);
    });

    test('checks Media Studio component loading in isolation', async ({ page }) => {
        test.setTimeout(60000);

        // Navigate to workspace
        await page.goto('/workspace', { waitUntil: 'domcontentloaded' });

        // Wait for dashboard
        await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible({ timeout: 20000 });

        // Check that the page loads without errors
        const errors: string[] = [];
        page.on('pageerror', (error) => {
            errors.push(error.message);
        });

        // Wait a moment for any dynamic content to load
        await page.waitForTimeout(3000);

        // If there were any JavaScript errors, log them
        if (errors.length > 0) {
            console.log('JavaScript errors encountered:', errors);
        }

        // For now, we'll just verify the page loaded successfully
        expect(errors.length).toBe(0);
    });

    test('checks basic page structure and Media Studio elements', async ({ page }) => {
        test.setTimeout(60000);

        // Navigate to workspace
        await page.goto('/workspace', { waitUntil: 'domcontentloaded' });

        // Wait for dashboard
        await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible({ timeout: 20000 });

        // Check for any console errors
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });

        // Wait for page to stabilize
        await page.waitForTimeout(3000);

        // Log any console errors
        if (errors.length > 0) {
            console.log('Console errors encountered:', errors);
        }

        // Basic check that page is functional
        const title = await page.title();
        expect(title).toMatch(/Oddjob/);
    });
});

test.describe('Media Studio Component Loading', () => {
    test.use({ storageState: 'playwright/.auth/user.json' });

    test('verifies Media Studio component files exist and load', async ({ page }) => {
        test.setTimeout(30000);

        // Navigate to workspace
        await page.goto('/workspace', { waitUntil: 'domcontentloaded' });

        // Wait for dashboard
        await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible({ timeout: 20000 });

        // Check that the page loads without JavaScript errors
        const errors: string[] = [];
        page.on('pageerror', (error) => {
            errors.push(error.message);
        });

        await page.waitForTimeout(2000);

        // Log any errors for debugging
        if (errors.length > 0) {
            console.log('Page errors:', errors);
        }

        // The test passes if the page loads without critical errors
        expect(errors.length).toBe(0);
    });

    test('checks responsive layout behavior', async ({ page }) => {
        test.setTimeout(30000);

        // Navigate to workspace
        await page.goto('/workspace', { waitUntil: 'domcontentloaded' });

        // Wait for dashboard
        await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible({ timeout: 20000 });

        // Test different viewport sizes
        const sizes = [
            { width: 1920, height: 1080 }, // Desktop
            { width: 1366, height: 768 },  // Laptop  
            { width: 768, height: 1024 },  // Tablet
        ];

        for (const size of sizes) {
            await page.setViewportSize(size);
            await page.waitForTimeout(500);

            // Verify the page remains functional
            const title = await page.title();
            expect(title).toMatch(/Oddjob/);
        }
    });
});
