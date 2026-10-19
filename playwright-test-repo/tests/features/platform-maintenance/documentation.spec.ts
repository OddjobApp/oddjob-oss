import { test, expect } from '@playwright/test';

test.describe('Platform documentation and change register', () => {
  test('loads the documentation workspace with platform health indicators', async ({ page }) => {
    // @behavior platform-maintenance.documentation.workspace-visible
    // @tag documentation platform-maintenance critical

    await page.goto('/platform-maintenance/documentation');

    await expect(page.getByRole('heading', { name: 'Platform Documentation' })).toBeVisible();
    await expect(page.getByText('Coverage', { exact: true })).toBeVisible();
    await expect(page.getByText('Freshness Score', { exact: true })).toBeVisible();
    await expect(page.getByText('Total Docs', { exact: true })).toBeVisible();
    await expect(page.getByText('Maintenance Scheduler', { exact: true })).toBeVisible();
  });

  test('exposes each documentation surface as a named tab', async ({ page }) => {
    // @behavior platform-maintenance.documentation.surfaces-visible
    // @tag documentation platform-maintenance navigation

    await page.goto('/platform-maintenance/documentation');

    for (const tabName of [
      'Current Modules',
      'API Spec',
      'UI Spec',
      'Health',
      'Maintenance',
      'Change Register',
      'Release Notes',
      'Search',
    ]) {
      await expect(page.getByRole('tab', { name: tabName, exact: true })).toBeVisible();
    }
  });

  test('deep-links to the E2E architecture reference with trust status', async ({ page }) => {
    // @behavior platform-maintenance.documentation.e2e-reference-deep-link
    // @tag documentation platform-maintenance e2e-testing

    await page.goto('/platform-maintenance/documentation?tab=modules&feature=e2e-testing');

    await expect(page.getByRole('heading', { name: 'E2E Testing', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Implementation status:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy markdown', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  });

  test('opens the stored UI specification from its URL state', async ({ page }) => {
    // @behavior platform-maintenance.documentation.ui-spec-deep-link
    // @tag documentation platform-maintenance ui-spec

    await page.goto('/platform-maintenance/documentation?tab=ui');

    await expect(page.getByRole('tab', { name: 'UI Spec', exact: true })).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByRole('heading', { name: /Implementation status:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy markdown', exact: true })).toBeVisible();
  });

  test('opens the dated change register from its URL state', async ({ page }) => {
    // @behavior platform-maintenance.documentation.change-register-deep-link
    // @tag documentation platform-maintenance change-register

    await page.goto('/platform-maintenance/documentation?tab=changes');

    await expect(page.getByRole('tab', { name: 'Change Register', exact: true })).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByRole('heading', { name: 'Change register', exact: true })).toBeVisible();
    await expect(
      page.getByText('Every meaningful documentation regeneration is dated, classified, and explained.'),
    ).toBeVisible();
  });
});
