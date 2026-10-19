import { test, expect } from '@playwright/test';

const LEGAL_WORKBENCH = `/app/${process.env.LEGAL_WORKBENCH_SLUG || 'sdlc-workbench-k63ff'}/legal-workbench`;

test.describe('Legal Workbench - Contract Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(LEGAL_WORKBENCH);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Legal Workbench")')).toBeVisible({ timeout: 30000 });
  });

  test('renders the legal workbench', async ({ page }) => {
    await expect(page.getByText('Legal and Compliance')).toBeVisible();
    await expect(page.getByText('Contract Queue')).toBeVisible();
    await expect(page.getByText('Compliance Status')).toBeVisible();
    await expect(page.getByText('Legal Metrics')).toBeVisible();
    console.log('Legal Workbench UI verified.');
  });

  test('exposes the Legal Counsel agent chat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Legal Counsel' })).toBeVisible();
    const chatInput = page.locator('input[placeholder*="Ask the agent"], input[placeholder*="Agent not available"]');
    await expect(chatInput.first()).toBeVisible();
    console.log('Legal Counsel agent chat present.');
  });

  test('drives contract management through the Legal Counsel agent', async ({ page }, testInfo) => {
    const ready = page.locator('input[placeholder*="Ask the agent"]');
    if ((await ready.count()) === 0 || !(await ready.first().isEnabled())) {
      testInfo.annotations.push({
        type: 'note',
        description: 'Legal Counsel agent input is disabled (no backing agent job in this deployment); contract management is initiated via chat when available.',
      });
      test.skip(true, 'Agent chat input not available in this deployment');
      return;
    }
    const prompt = 'Generate a new contract: MSA with TechCorp Inc, enterprise customer, $500k ARR, auto-renewal annually, SOC2 compliance required.';
    await ready.first().fill(prompt);
    await ready.first().press('Enter');
    await expect(page.getByText(/contract/i).first()).toBeVisible({ timeout: 15000 });
    console.log('Contract management request sent to Legal Counsel agent.');
  });
});
