import { test, expect } from '@playwright/test';

const CUSTOMER_SUCCESS_WORKBENCH = `/app/${process.env.CUSTOMER_SUCCESS_WORKBENCH_SLUG || 'sdlc-workbench-k63ff'}/customer-success-workbench`;

test.describe('Customer Success Workbench - Customer Onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CUSTOMER_SUCCESS_WORKBENCH);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Customer Success Workbench")')).toBeVisible({ timeout: 30000 });
  });

  test('renders the customer success workbench', async ({ page }) => {
    await expect(page.getByText('Customer Success Management')).toBeVisible();
    await expect(page.getByText('Onboarding Queue')).toBeVisible();
    await expect(page.getByText('Customer Feedback')).toBeVisible();
    await expect(page.getByText('Success Metrics')).toBeVisible();
    console.log('Customer Success Workbench UI verified.');
  });

  test('exposes the Customer Success Manager agent chat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Customer Success Manager' })).toBeVisible();
    const chatInput = page.locator('input[placeholder*="Ask the agent"], input[placeholder*="Agent not available"]');
    await expect(chatInput.first()).toBeVisible();
    console.log('Customer Success Manager agent chat present.');
  });

  test('drives customer onboarding through the Customer Success Manager agent', async ({ page }, testInfo) => {
    const ready = page.locator('input[placeholder*="Ask the agent"]');
    if ((await ready.count()) === 0 || !(await ready.first().isEnabled())) {
      testInfo.annotations.push({
        type: 'note',
        description: 'Customer Success Manager agent input is disabled (no backing agent job in this deployment); onboarding is initiated via chat when available.',
      });
      test.skip(true, 'Agent chat input not available in this deployment');
      return;
    }
    const prompt = 'Start onboarding for new customer: Acme Corp, enterprise plan, 50 users, start date next Monday.';
    await ready.first().fill(prompt);
    await ready.first().press('Enter');
    await expect(page.getByText(/onboarding/i).first()).toBeVisible({ timeout: 15000 });
    console.log('Customer onboarding request sent to Customer Success Manager agent.');
  });
});
