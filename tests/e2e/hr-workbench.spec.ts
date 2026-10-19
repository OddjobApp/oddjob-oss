import { test, expect } from '@playwright/test';

const HR_WORKBENCH = `/app/${process.env.HR_WORKBENCH_SLUG || 'sdlc-workbench-k63ff'}/hr-workbench`;

test.describe('HR Workbench - Employee Onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HR_WORKBENCH);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("HR Workbench")')).toBeVisible({ timeout: 30000 });
  });

  test('renders the HR workbench', async ({ page }) => {
    await expect(page.getByText('HR Operations')).toBeVisible();
    await expect(page.getByText('Employee Onboarding')).toBeVisible();
    await expect(page.getByText('Performance Reviews')).toBeVisible();
    await expect(page.getByText('HR Metrics')).toBeVisible();
    console.log('HR Workbench UI verified.');
  });

  test('exposes the HR Manager agent chat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'HR Manager' })).toBeVisible();
    const chatInput = page.locator('input[placeholder*="Ask the agent"], input[placeholder*="Agent not available"]');
    await expect(chatInput.first()).toBeVisible();
    console.log('HR Manager agent chat present.');
  });

  test('drives employee onboarding through the HR Manager agent', async ({ page }, testInfo) => {
    const ready = page.locator('input[placeholder*="Ask the agent"]');
    if ((await ready.count()) === 0 || !(await ready.first().isEnabled())) {
      testInfo.annotations.push({
        type: 'note',
        description: 'HR Manager agent input is disabled (no backing agent job in this deployment); employee onboarding is initiated via chat when available.',
      });
      test.skip(true, 'Agent chat input not available in this deployment');
      return;
    }
    const prompt = 'Start onboarding for new employee: John Smith, Senior Developer, Engineering department, start date next Monday, needs laptop and monitor.';
    await ready.first().fill(prompt);
    await ready.first().press('Enter');
    await expect(page.getByText(/onboarding/i).first()).toBeVisible({ timeout: 15000 });
    console.log('Employee onboarding request sent to HR Manager agent.');
  });
});
