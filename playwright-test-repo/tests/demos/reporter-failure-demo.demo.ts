import { test, expect } from '@playwright/test';

// Deliberately excluded from the active *.spec.ts index and default suite runs.
// Run explicitly when validating the Dataset 71 reporter pipeline.
test('reports an intentional failure to the bug pipeline', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#non-existent-failure-trigger-element')).toBeVisible({ timeout: 5000 });
});
