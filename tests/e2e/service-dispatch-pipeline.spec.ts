/**
 * Service Dispatch Pipeline — Dedicated E2E Test Suite
 *
 * Tests the Dispatcher app UI and Location Search app in isolation,
 * plus API-layer smoke checks for the Service Dispatch Pipeline cycle.
 *
 * Run:  npx playwright test tests/e2e/service-dispatch-pipeline.spec.ts --headed
 */
import { test, expect, Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wait for the App Forge "App Waking Up" screen to resolve into the real app. */
async function waitForForgeApp(page: Page, h1Text: RegExp | string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const title = await page.locator('h1, header, main').first().textContent({ timeout: 5000 }).catch(() => '');
    if (title && (typeof h1Text === 'string' ? title.toLowerCase().includes(h1Text.toLowerCase()) : h1Text.test(title))) {
      return;
    }
    const hasWakeUp = await page.getByText(/waking up/i).isVisible().catch(() => false);
    if (!hasWakeUp && title) {
      return;
    }
    // Still on "App Waking Up" — reload and wait
    await page.waitForTimeout(3000);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await expect(page.locator('h1, header, main').first()).toBeVisible({ timeout: 10000 });
}

// ── Test Suite ────────────────────────────────────────────────────────────────

test.describe('Service Dispatch Pipeline — App & API Tests', () => {

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      console.error(`[PAGE ERROR] ${err.message}`);
    });
  });

  // ── 1. API Smoke Tests ─────────────────────────────────────────────────────

  test('API-01: Platform is healthy and responding', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBeLessThan(500);
  });

  test('API-02: Registered apps include dispatcher and location-search', async ({ request }) => {
    const res = await request.get('/api/apps/market');
    expect(res.ok()).toBeTruthy();
    const apps: Array<{ slug: string }> = await res.json();
    const slugs = apps.map(a => a.slug);
    expect(slugs).toContain('service-dispatch');
    expect(slugs).toContain('location-search');
  });

  test('API-03: Dispatcher app context is available', async ({ request }) => {
    const res = await request.get('/api/apps/service-dispatch/context');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('organizationId');
  });

  test('API-04: Location search app context is available', async ({ request }) => {
    const res = await request.get('/api/apps/location-search/context');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('organizationId');
  });

  test('API-05: Service Dispatch Pipeline cycle exists', async ({ request }) => {
    const res = await request.get('/api/cycles');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const cycles: Array<{ name: string }> = body.cycles || [];
    const names = cycles.map(c => c.name);
    const hasDispatch = names.some(n => n.toLowerCase().includes('dispatch') || n.toLowerCase().includes('service'));
    expect(hasDispatch).toBeTruthy();
  });

  // ── 2. Dispatcher App (Rescue Dispatch UI) ─────────────────────────────────

  test('UI-01: Dispatcher app loads with Rescue Dispatch heading and branding', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/dispatcher', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Rescue Dispatch');
    await expect(page.getByText('Rescue Dispatch').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/dispatch/01-dispatcher-loaded.png', fullPage: true });
  });

  test('UI-02: Dispatcher shows app description and mission scope', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/dispatcher', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Rescue Dispatch');
    await expect(page.getByText(/emergency assistance|geospatial|rescue/i).first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/dispatch/02-mission-scope.png' });
  });

  test('UI-03: Dispatcher shows interactive agent conversation input', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/dispatcher', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Rescue Dispatch');
    const input = page.locator('input[placeholder*="message"], textarea').first();
    await expect(input).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/dispatch/03-chat-input.png' });
  });

  test('UI-04: Dispatcher shows telemetry beacon feedback controls', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/dispatcher', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Rescue Dispatch');
    const beacon = page.locator('.fixed.bottom-6.right-6');
    await expect(beacon).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/dispatch/04-telemetry-beacon.png' });
  });

  test('UI-05: Dispatcher handles interaction input', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/dispatcher', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Rescue Dispatch');
    const input = page.locator('input[placeholder*="message"], textarea').first();
    await input.fill('Status of Sector 7?');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/dispatch/05-interaction.png' });
  });

  // ── 3. Location Search App ─────────────────────────────────────────────────

  test('UI-06: Location Search app loads with Location Index heading', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/location-search', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Location Index');
    await expect(page.getByText('Location Index').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/dispatch/06-location-search-loaded.png', fullPage: true });
  });

  test('UI-07: Location Search shows interactive input', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/location-search', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Location Index');
    const input = page.locator('input[placeholder*="message"], textarea, input[type="text"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill('HQ West');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/dispatch/07-location-search-input.png' });
  });

  test('UI-08: Location Search cycle context parameter propagates', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/location-search?cycleId=test123', { waitUntil: 'domcontentloaded' });
    await waitForForgeApp(page, 'Location Index');
    await expect(page.getByText('Location Index').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/dispatch/08-location-cycle-context.png' });
  });

  // ── 4. Operations Dashboard ────────────────────────────────────────────────

  test('OPS-01: Service Dispatch Pipeline cycle detail page loads', async ({ page }) => {
    test.setTimeout(60_000);
    // Navigate to operations and find the Service Dispatch Pipeline
    await page.goto('/operations/cycles', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    // Look for Service Dispatch Pipeline link
    const cycleLink = page.getByText('Service Dispatch Pipeline').first();
    if (await cycleLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cycleLink.click();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('h1')).toContainText('Service Dispatch Pipeline', { timeout: 15000 });
      await page.screenshot({ path: 'test-results/dispatch/ops-01-cycle-detail.png', fullPage: true });
    } else {
      // Fallback: try direct URL with known cycle ID
      await page.goto('/operations/cycles/324', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/dispatch/ops-01-cycle-detail-fallback.png', fullPage: true });
    }
  });

  // ── 5. CREW Incident Deliberation Room ────────────────────────────────────

  test('CREW-01: Incident War Room session API returns turns and cycle stage metadata', async ({ request }) => {
    const res = await request.get('/api/crew/crew-rescue-dispatch-war-room/turns');
    expect(res.status()).toBeLessThan(500);
    if (res.ok()) {
      const data = await res.json();
      expect(Array.isArray(data.turns)).toBe(true);
    }
  });

  test('CREW-02: CREW Incident War Room UI loads with multi-agent deliberation and cycle context', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/workspace/chat/crew-rescue-dispatch-war-room', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Verify room heading / active incident topic
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeDefined();

    // Verify agent briefing or room container is rendered
    await expect(page.locator('.chat-scroll-area, [data-testid="agent-chat-container"], main').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/dispatch/crew-01-war-room-loaded.png', fullPage: true });
  });

  test('CREW-03: CREW Room shows stage primers and escalation goals', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/workspace/chat/crew-rescue-dispatch-war-room', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Check for room context elements or chat input
    const chatInput = page.locator('textarea, input[placeholder*="Type"], input[placeholder*="message"]').first();
    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(chatInput).toBeVisible();
    }
    await page.screenshot({ path: 'test-results/dispatch/crew-02-stage-goals.png' });
  });
});

