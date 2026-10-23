import { test, expect } from '@playwright/test';

test.describe('Critical route accessibility', () => {
  test('offers a keyboard-first skip link on Health', async ({ page }) => {
    // @behavior platform.accessibility.health-skip-link
    // @tag accessibility keyboard health critical

    await page.goto('/health');
    // The shell renders after load; a Tab pressed before then lands on nothing.
    await expect(page.locator('#main-content')).toBeAttached();
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAttribute('href', '#main-content');
    await expect(page.locator('#main-content')).toBeAttached();
  });

  test('gives Health destination cards accessible link names', async ({ page }) => {
    // @behavior platform.accessibility.health-card-link-names
    // @tag accessibility semantics health navigation

    await page.goto('/health');

    await expect(
      page.locator('a[href="/health/pulse"]').filter({ hasText: 'Live system pulse' }),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/health/e2e-tests"]').filter({ hasText: 'Playwright coverage' }),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/health/monitoring"]').filter({ hasText: 'Runtime monitoring' }),
    ).toBeVisible();
  });

  test('labels E2E execution and recovery controls by their target test', async ({ page }) => {
    // @behavior platform.accessibility.e2e-control-names
    // @tag accessibility semantics e2e-testing controls

    await page.goto('/health/e2e-tests');

    await expect(page.getByRole('button', { name: /^Run should load the dashboard/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Self-heal should load the dashboard/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run suite now', exact: true })).toBeVisible();
  });

  test('exposes documentation navigation as an accessible tab set', async ({ page }) => {
    // @behavior platform.accessibility.documentation-tabs
    // @tag accessibility semantics documentation tabs

    await page.goto('/platform-maintenance/documentation?tab=ui');

    const tabList = page.getByRole('tablist');
    await expect(tabList).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Current Modules', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'UI Spec', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Change Register', exact: true })).toBeVisible();
  });
});
