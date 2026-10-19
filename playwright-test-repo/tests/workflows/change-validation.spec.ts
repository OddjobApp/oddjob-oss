import { test, expect } from '@playwright/test';

test.describe('Change validation workflow', () => {
  test('presents the governed validation stages in execution order', async ({ page }) => {
    // @behavior sdlc.change-validation.governed-stages-visible
    // @tag workflow change-validation governance

    await page.goto('/health/e2e-tests');

    await expect(page.getByRole('heading', { name: 'Automated validation path' })).toBeVisible();
    for (const stage of [
      '1. Change registered',
      '2. Impact scoped',
      '3. Tests executed',
      '4. Block assembled',
      '5. Bug triaged',
    ]) {
      await expect(page.getByText(stage, { exact: true })).toBeVisible();
    }
  });

  test('shows graph behavior IDs beside their executable atomic tests', async ({ page }) => {
    // @behavior sdlc.change-validation.graph-test-traceability
    // @tag workflow change-validation system-graph manifest

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByText(/sdlc\.change-validation\.governed-stages-visible/),
    ).toBeVisible();
    await expect(
      page.getByText(/Atomic block \/ change-validation:presents_the_governed_validation_stages/),
    ).toBeVisible();
  });

  test('exposes documentation and change evidence from validation health', async ({ page }) => {
    // @behavior sdlc.change-validation.documentation-evidence-visible
    // @tag workflow change-validation documentation change-register

    await page.goto('/health/e2e-tests');

    await expect(page.getByText(/E2E documentation/)).toBeVisible();
    await expect(page.getByText(/Latest register entry:/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Documentation', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Change register', exact: true })).toBeVisible();
  });

  test('provides a Pulse surface for pipeline lifecycle evidence', async ({ page }) => {
    // @behavior sdlc.change-validation.pulse-lifecycle-surface
    // @tag workflow change-validation pulse events

    await page.goto('/health/pulse');

    await expect(page.getByRole('heading', { name: 'System Pulse' })).toBeVisible();
    await expect(page.getByText('Live Activity Log', { exact: true })).toBeVisible();
    await expect(page.getByText('Network Health', { exact: true })).toBeVisible();
    await expect(page.getByText(/Protocol: SSE\/EventStream/)).toBeVisible();
  });
});
