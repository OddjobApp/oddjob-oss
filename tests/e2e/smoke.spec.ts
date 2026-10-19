import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Oddjob/);
    // Verify dashboard sidebar is visible (authenticated)
    await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible();
});
