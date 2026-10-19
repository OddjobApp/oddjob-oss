import { test, expect } from '@playwright/test';

test.describe('Signal Studio End-to-End Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to Signal Studio
    await page.goto('/workspace/signals', { waitUntil: 'domcontentloaded' });

    // Handle authentication redirect if session is not active
    if (page.url().includes('/auth/login') || page.url().includes('/login')) {
      await page.fill('#designation, input[name="username"], input[type="email"]', 'admin@example.com');
      await page.fill('#password, input[name="password"]', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/workspace/signals**', { timeout: 15_000 });
    }

    await page.waitForSelector('[data-testid="signal-studio-heading"]', { timeout: 20_000 });
  });

  test('1. mounts correctly at /workspace/signals with Signal Studio branding and tabs', async ({ page }) => {
    // Verify URL stays on /workspace/signals
    await expect(page).toHaveURL(/\/workspace\/signals/);

    // Verify main heading
    const heading = page.locator('[data-testid="signal-studio-heading"]');
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(heading).toHaveText('Signal Studio');

    // Verify root Signal Studio container
    const studioContainer = page.locator('[data-testid="signal-studio-pod"]');
    await expect(studioContainer).toBeVisible();

    // Verify all 6 tabs are present in navigation
    await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /spatial map/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /signals & decisions/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sources/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /rules/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /industry packs/i })).toBeVisible();
  });

  test('2. verifies Overview tab displays active exposure and response playbook', async ({ page }) => {
    // Default tab is Overview
    await expect(page.getByText(/Exposure Footprint/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Recommended Response Playbook/i)).toBeVisible();

    // Verify CTA action buttons
    await expect(page.getByRole('button', { name: /Discuss in CREW/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Launch Initiative/i })).toBeVisible();
  });

  test('3. verifies Spatial Map tab with Uber H3 analytics and Send to CREW', async ({ page }) => {
    // Switch to Spatial Map tab
    await page.getByRole('button', { name: /spatial map/i }).click();

    // Verify Uber H3 Engine title
    await expect(page.getByText(/Uber H3 Spatial Analytics/i)).toBeVisible({ timeout: 10_000 });

    // Verify Send to CREW quick action
    const sendCrewBtn = page.getByRole('button', { name: /Send to CREW/i });
    await expect(sendCrewBtn).toBeVisible();
  });

  test('4. verifies native Signals & Decisions workbench with Causal DAG and decision plays', async ({ page }) => {
    // Switch to Signals & Decisions tab
    await page.getByRole('button', { name: /signals & decisions/i }).click();

    // Verify modern workbench container
    const workbench = page.locator('[data-testid="signals-decisions-workbench"]');
    await expect(workbench).toBeVisible({ timeout: 10_000 });

    // Verify search input and severity filter pills
    await expect(page.getByTestId('signal-search-input')).toBeVisible();
    await expect(page.getByRole('button', { name: /^critical$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^high$/i })).toBeVisible();

    // Verify Causal Graph section
    await expect(page.getByText(/Causal Graph & Entity Blast Radius/i)).toBeVisible();

    // Verify 1-Click Executive Decision Plays
    await expect(page.getByTestId('decision-discuss-crew')).toBeVisible();
    await expect(page.getByTestId('decision-launch-initiative')).toBeVisible();
    await expect(page.getByTestId('decision-create-rule')).toBeVisible();
    await expect(page.getByTestId('decision-inspect-spatial')).toBeVisible();
  });

  test('5. verifies Sources tab for feed ingestion and channel management', async ({ page }) => {
    // Switch to Sources tab
    await page.getByRole('button', { name: /sources/i }).click();

    // Verify Sources view content
    await expect(page.getByText(/Add Intelligence Signal Source/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Quick Pre-fill Sample Feeds/i)).toBeVisible();
    await expect(page.getByText(/Configured Feeds/i)).toBeVisible();
  });

  test('6. verifies Rules tab with RuleBuilder and active subscriptions', async ({ page }) => {
    // Switch to Rules tab
    await page.getByRole('button', { name: /rules/i }).click();

    // Verify Rule Builder and Subscriptions
    await expect(page.getByText(/Rule Builder|Condition/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Active Cycle Subscriptions|Create Cycle Signal Subscription/i).first()).toBeVisible();
  });

  test('7. verifies Industry Packs tab with all 6 enterprise packs', async ({ page }) => {
    // Switch to Industry Packs tab
    await page.getByRole('button', { name: /industry packs/i }).click();

    await expect(page.getByText('Global Supply Chain & Logistics Pack')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Regulatory, Sanctions & Trade Policy Pack')).toBeVisible();
    await expect(page.getByText('Macroeconomic & Central Banking Pack')).toBeVisible();
    await expect(page.getByText('Critical Cloud & Cybersecurity Resilience Pack')).toBeVisible();
    await expect(page.getByText('Severe Weather & Energy Grid Resilience Pack')).toBeVisible();
    await expect(page.getByText('Corporate Filings & Competitor Watchlist')).toBeVisible();

    // Verify 1-click Activate button
    const activateButtons = page.getByRole('button', { name: /Activate Pack/i });
    await expect(activateButtons.first()).toBeVisible();
  });

  test('8. verifies Full Screen toggle and Escape shortcut', async ({ page }) => {
    const fullscreenToggle = page.locator('[data-testid="signal-pod-fullscreen-toggle"]');
    await expect(fullscreenToggle).toBeVisible();

    const podContainer = page.locator('[data-testid="signal-studio-pod"]');

    // Click to enter full screen
    await fullscreenToggle.click();
    await expect(fullscreenToggle).toContainText(/Exit Full Screen/i);
    await expect(podContainer).toHaveClass(/fixed inset-0 z-50/);

    // Press Escape to exit full screen
    await page.keyboard.press('Escape');
    await expect(fullscreenToggle).not.toContainText(/Exit Full Screen/i);
    await expect(podContainer).not.toHaveClass(/fixed inset-0 z-50/);
  });
});
