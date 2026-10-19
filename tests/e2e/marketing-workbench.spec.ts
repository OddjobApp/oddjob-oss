import { test, expect } from '@playwright/test';

const MARKETING_WORKBENCH = `/app/${process.env.MARKETING_WORKBENCH_SLUG || 'sdlc-workbench-k63ff'}/marketing-workbench`;

test.describe('Marketing Workbench - Campaign Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(MARKETING_WORKBENCH);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Marketing Workbench")')).toBeVisible({ timeout: 30000 });
  });

  test('renders the marketing workbench', async ({ page }) => {
    await expect(page.getByText('Marketing Campaign Management')).toBeVisible();
    await expect(page.getByText('Active Campaigns')).toBeVisible();
    await expect(page.getByText('Content Calendar')).toBeVisible();
    await expect(page.getByText('Marketing Metrics')).toBeVisible();
    console.log('Marketing Workbench UI verified.');
  });

  test('exposes the Marketing Manager agent chat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Marketing Manager' })).toBeVisible();
    const chatInput = page.locator('input[placeholder*="Ask the agent"], input[placeholder*="Agent not available"]');
    await expect(chatInput.first()).toBeVisible();
    console.log('Marketing Manager agent chat present.');
  });

  test('drives campaign planning through the Marketing Manager agent', async ({ page }, testInfo) => {
    const ready = page.locator('input[placeholder*="Ask the agent"]');
    if ((await ready.count()) === 0 || !(await ready.first().isEnabled())) {
      testInfo.annotations.push({
        type: 'note',
        description: 'Marketing Manager agent input is disabled (no backing agent job in this deployment); campaign planning is initiated via chat when available.',
      });
      test.skip(true, 'Agent chat input not available in this deployment');
      return;
    }
    const prompt = 'Plan a new marketing campaign: Q4 product launch, target enterprise customers, budget $100k, channels: email, LinkedIn, content.';
    await ready.first().fill(prompt);
    await ready.first().press('Enter');
    await expect(page.getByText(/campaign/i).first()).toBeVisible({ timeout: 15000 });
    console.log('Campaign planning request sent to Marketing Manager agent.');
  });
});
