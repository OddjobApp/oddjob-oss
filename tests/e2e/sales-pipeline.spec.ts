import { test, expect } from '@playwright/test';

const SALES_WORKBENCH = `/app/${process.env.SALES_WORKBENCH_SLUG || 'sdlc-workbench-k63ff'}/sales-workbench`;

test.describe('Sales Workbench - Sales Pipeline Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SALES_WORKBENCH);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Sales Workbench")')).toBeVisible({ timeout: 30000 });
  });

  test('renders the sales pipeline management workbench', async ({ page }) => {
    await expect(page.getByText('Sales Pipeline Management')).toBeVisible();
    await expect(page.getByText('Active Pipeline')).toBeVisible();
    await expect(page.getByText('Recent Deals')).toBeVisible();
    await expect(page.getByText('Revenue Metrics')).toBeVisible();
    console.log('Sales Workbench pipeline management UI verified.');
  });

  test('exposes the Sales Representative agent chat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sales Representative' })).toBeVisible();
    const chatInput = page.locator('input[placeholder*="Ask the agent"], input[placeholder*="Agent not available"]');
    await expect(chatInput.first()).toBeVisible();
    console.log('Sales Representative agent chat present.');
  });

  test('drives lead qualification through the Sales Representative agent', async ({ page }, testInfo) => {
    const ready = page.locator('input[placeholder*="Ask the agent"]');
    if ((await ready.count()) === 0 || !(await ready.first().isEnabled())) {
      testInfo.annotations.push({
        type: 'note',
        description: 'Sales Representative agent input is disabled (no backing agent job in this deployment); lead qualification is initiated via chat when available.',
      });
      test.skip(true, 'Agent chat input not available in this deployment');
      return;
    }
    const prompt = 'Qualify a new lead: TechCorp Inc, enterprise customer, $500k ARR potential, interested in our platform.';
    await ready.first().fill(prompt);
    await ready.first().press('Enter');
    await expect(page.getByText(/lead/i).first()).toBeVisible({ timeout: 15000 });
    console.log('Lead qualification request sent to Sales Representative agent.');
  });
});
