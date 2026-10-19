import { test, expect } from '@playwright/test';

// Reset storage state for this file to test unauthenticated scenarios
test.use({ storageState: { cookies: [], origins: [] } });

test('redirects to login if not authenticated', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for potential redirect
    await page.waitForURL(url => url.pathname.includes('/auth/login') || url.pathname.includes('/login'));

    // Use a more robust locator for the title
    await expect(page.getByRole('heading', { name: 'Oddjob' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Establish_Connection' })).toBeVisible();
});
