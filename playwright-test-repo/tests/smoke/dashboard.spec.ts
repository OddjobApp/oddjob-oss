import { test, expect } from '@playwright/test';

test.describe('Dashboard Smoke Tests', () => {
  test('should load the dashboard and display sidebar links', async ({ page }) => {
    // @behavior platform.shell-navigation.dashboard-sidebar-visible
    // @tag smoke navigation critical

    // `/` is the public site; the signed-in workspace lives at /dashboard.
    console.log('[Smoke] Opening the dashboard...');
    await page.goto('/dashboard');

    console.log('[Smoke] Verifying title...');
    await expect(page).toHaveTitle(/Oddjob/);

    console.log('[Smoke] Checking dashboard sidebar link...');
    await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible();
  });
});
