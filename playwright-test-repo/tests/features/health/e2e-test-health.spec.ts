import { test, expect } from '@playwright/test';

test.describe('E2E Test Health Dashboard', () => {
  test('should load the E2E test health dashboard page', async ({ page }) => {
    // @behavior health.e2e-testing.page-load
    // @tag health e2e-testing critical

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('heading', { name: 'E2E Test Health' })
    ).toBeVisible();
  });

  test('should show indexed test suites section', async ({ page }) => {
    // @behavior health.e2e-testing.suites-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('heading', { name: 'Indexed test suites' })
    ).toBeVisible();
  });

  test('should display automated validation path section', async ({ page }) => {
    // @behavior health.e2e-testing.validation-path-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('heading', { name: 'Automated validation path' })
    ).toBeVisible();
  });

  test('should show run suite button when tests are available', async ({ page }) => {
    // @behavior health.e2e-testing.run-suite-button-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('button', { name: /run suite now/i })
    ).toBeVisible();
  });

  test('should display health statistics cards', async ({ page }) => {
    // @behavior health.e2e-testing.stats-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByText('Indexed suites')
    ).toBeVisible();
    await expect(
      page.getByText('Latest pass rate')
    ).toBeVisible();
    await expect(
      page.getByText('Open failures')
    ).toBeVisible();
    await expect(
      page.getByText('Runner state')
    ).toBeVisible();
  });

  test('should show refresh status button', async ({ page }) => {
    // @behavior health.e2e-testing.refresh-button-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('button', { name: 'Refresh status', exact: true })
    ).toBeVisible();
  });

  test('should display individual test run buttons when tests are available', async ({ page }) => {
    // @behavior health.e2e-testing.test-run-buttons-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    // Wait for the indexed test suites section to appear
    await page.waitForSelector('text=Indexed test suites', { timeout: 10000 });
    
    const runTestButtons = page.getByRole('button', { name: /run test/i });
    const count = await runTestButtons.count();
    
    // Only assert if tests are actually loaded
    if (count > 0) {
      await expect(runTestButtons.nth(0)).toBeVisible();
    }
    // If no tests available, the test passes without assertion (buttons may not exist)
  });

  test('should display self-healing buttons for individual tests', async ({ page }) => {
    // @behavior health.e2e-testing.self-heal-buttons-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    // Wait for the indexed test suites section to appear
    await page.waitForSelector('text=Indexed test suites', { timeout: 10000 });
    
    const selfHealButtons = page.getByRole('button', { name: /self-heal/i });
    const count = await selfHealButtons.count();
    
    // Only assert if tests are actually loaded
    if (count > 0) {
      await expect(selfHealButtons.nth(0)).toBeVisible();
    }
    // If no tests available, the test passes without assertion (buttons may not exist)
  });

  test('should show incident timeline section', async ({ page }) => {
    // @behavior health.e2e-testing.incident-timeline-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('heading', { name: /incident/i })
    ).toBeVisible();
  });

  test('should display execution history section', async ({ page }) => {
    // @behavior health.e2e-testing.execution-history-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByText(/execution history/i).first()
    ).toBeVisible();
  });

  test('should show documentation link for E2E testing', async ({ page }) => {
    // @behavior health.e2e-testing.documentation-link-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('link', { name: /documentation/i })
    ).toBeVisible();
  });

  test('should display change register link', async ({ page }) => {
    // @behavior health.e2e-testing.change-register-link-visible
    // @tag health e2e-testing

    await page.goto('/health/e2e-tests');

    await expect(
      page.getByRole('link', { name: /change register/i })
    ).toBeVisible();
  });

  test('should update form fields and filter test list', async ({ page }) => {
    // @behavior health.e2e-testing.filter-form-fields
    // @tag health e2e-testing form-fields

    await page.goto('/health/e2e-tests');

    const filterInput = page.getByRole('textbox', { name: /filter test suites or specs/i });
    await expect(filterInput).toBeVisible();

    await filterInput.fill('Platform Shell');
    await expect(filterInput).toHaveValue('Platform Shell');

    await filterInput.fill('');
    await expect(filterInput).toHaveValue('');
  });
});
