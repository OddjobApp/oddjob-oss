import { test, expect } from '@playwright/test';

test('shows the E2E runner ready state', async ({ page }) => {
  // @behavior generated.ui-contracts.e2e-runner-ready-state
  // @tag generated behavior-contract health e2e-testing

  await page.goto('/health/e2e-tests');
  await expect(page.getByText('Runner state', { exact: true })).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
});
