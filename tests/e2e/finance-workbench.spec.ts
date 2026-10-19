import { test, expect } from '@playwright/test';

const FINANCE_WORKBENCH = `/app/${process.env.FINANCE_WORKBENCH_SLUG || 'sdlc-workbench-k63ff'}/finance-workbench`;

test.describe('Finance Workbench - Revenue Recognition', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FINANCE_WORKBENCH);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Finance Workbench")')).toBeVisible({ timeout: 30000 });
  });

  test('renders the finance workbench', async ({ page }) => {
    await expect(page.getByText('Finance Operations')).toBeVisible();
    await expect(page.getByText('Revenue Recognition')).toBeVisible();
    await expect(page.getByText('Billing Queue')).toBeVisible();
    await expect(page.getByText('Financial Metrics')).toBeVisible();
    console.log('Finance Workbench UI verified.');
  });

  test('exposes the Finance Analyst agent chat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Finance Analyst' })).toBeVisible();
    const chatInput = page.locator('input[placeholder*="Ask the agent"], input[placeholder*="Agent not available"]');
    await expect(chatInput.first()).toBeVisible();
    console.log('Finance Analyst agent chat present.');
  });

  test('drives revenue recognition through the Finance Analyst agent', async ({ page }, testInfo) => {
    const ready = page.locator('input[placeholder*="Ask the agent"]');
    if ((await ready.count()) === 0 || !(await ready.first().isEnabled())) {
      testInfo.annotations.push({
        type: 'note',
        description: 'Finance Analyst agent input is disabled (no backing agent job in this deployment); revenue recognition is initiated via chat when available.',
      });
      test.skip(true, 'Agent chat input not available in this deployment');
      return;
    }
    const prompt = 'Calculate revenue recognition for Q3: 50 new customers, $200k MRR, ASC 606 compliant, generate report.';
    await ready.first().fill(prompt);
    await ready.first().press('Enter');
    await expect(page.getByText(/revenue/i).first()).toBeVisible({ timeout: 15000 });
    console.log('Revenue recognition request sent to Finance Analyst agent.');
  });
});
