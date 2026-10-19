import { test, expect } from '@playwright/test';

test.describe('E2E Test Health contracts', () => {
  test('opens E2E Test Health from the Health overview', async ({ page }) => {
    // @behavior health.e2e-testing.navigation-from-health-overview
    // @tag health e2e-testing navigation

    await page.goto('/health');

    const e2eTestingCard = page.getByRole('link', { name: /E2E Testing/i });
    await expect(e2eTestingCard).toBeVisible();
    await e2eTestingCard.click();

    await expect(page).toHaveURL(/\/health\/e2e-tests$/);
    await expect(page.getByRole('heading', { name: 'E2E Test Health' })).toBeVisible();
  });

  test('shows every registered suite', async ({ page }) => {
    // @behavior health.e2e-testing.registered-suites-visible
    // @tag health e2e-testing manifest

    await page.goto('/health/e2e-tests');

    for (const suiteName of [
      'Platform Shell & Navigation',
      'E2E Test Health',
      'Platform Documentation & Change Register',
      'Change Validation Workflow',
      'Critical Route Accessibility',
      'Generated UI Behavior Contracts',
    ]) {
      await expect(page.getByText(suiteName, { exact: true }).last()).toBeVisible();
    }
  });

  test('links validation evidence to documentation and the change register', async ({ page }) => {
    // @behavior health.e2e-testing.validation-evidence-navigation
    // @tag health e2e-testing documentation change-register

    await page.goto('/health/e2e-tests');

    await expect(page.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      '/platform-maintenance/documentation?tab=modules&feature=e2e-testing',
    );
    await expect(page.getByRole('link', { name: 'Change register' })).toHaveAttribute(
      'href',
      '/platform-maintenance/documentation?tab=changes',
    );
  });

  test('exposes focused execution controls for indexed tests', async ({ page }) => {
    // @behavior health.e2e-testing.focused-test-controls
    // @tag health e2e-testing execution self-healing

    await page.goto('/health/e2e-tests');

    await expect(page.getByRole('button', { name: /^Run should load the dashboard/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Self-heal should load the dashboard/ })).toBeVisible();
  });
});
