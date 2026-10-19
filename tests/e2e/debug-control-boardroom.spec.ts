import { test, expect } from '@playwright/test';

test('debug control room, boardroom, and insights load behavior', async ({ page }) => {
  // Listen to browser console
  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`);
  });

  // Listen to page errors
  page.on('pageerror', err => {
    console.error(`[BROWSER PAGEERROR] ${err.message}`);
  });

  // Listen to network request failures
  page.on('requestfailed', request => {
    console.log(`[BROWSER REQUEST FAILED] ${request.method()} ${request.url()}`);
  });

  page.on('response', response => {
    const status = response.status();
    if (status >= 400) {
      console.log(`[BROWSER RESPONSE ERROR] ${response.request().method()} ${response.url()} -> ${status}`);
    }
  });

  console.log('Navigating to dashboard (should be auto-logged in via storageState)...');
  await page.goto('/dashboard');
  
  // Verify we are indeed on the dashboard
  await expect(page.locator('text=Oddjob')).toBeVisible({ timeout: 15000 });
  console.log('Dashboard loaded successfully.');

  console.log('\n--- NAVIGATING TO CONTROL ROOM ---');
  await page.goto('/control');

  // Let's wait a bit and capture page reloads or loops
  let navCount = 0;
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      navCount++;
      console.log(`[NAVIGATION #${navCount}] Navigated to ${frame.url()}`);
    }
  });

  // Wait 10 seconds to see if it blinks/reloads or gets stuck in a loop
  console.log('Waiting 10s on Control Room page...');
  await page.waitForTimeout(10000);

  // Take a screenshot of the Control Room page state
  await page.screenshot({ path: 'test-results/control-room-state.png' });
  console.log('Control Room screenshot saved to test-results/control-room-state.png');

  console.log('\n--- NAVIGATING TO BOARD ROOM ---');
  await page.goto('/control/board-room');

  console.log('Waiting 10s on Board Room page...');
  await page.waitForTimeout(10000);

  // Take a screenshot of the Board Room page state
  await page.screenshot({ path: 'test-results/board-room-state.png' });
  console.log('Board Room screenshot saved to test-results/board-room-state.png');

  console.log('\n--- NAVIGATING TO INSIGHTS OVERVIEW ---');
  await page.goto('/insights');

  console.log('Waiting 10s on Insights page...');
  await page.waitForTimeout(10000);

  // Take a screenshot of the Insights page state
  await page.screenshot({ path: 'test-results/insights-state.png' });
  console.log('Insights screenshot saved to test-results/insights-state.png');

  console.log('\n--- NAVIGATING TO PREDICTION INTELLIGENCE ---');
  await page.goto('/prediction-intelligence');

  console.log('Waiting 10s on Prediction Intelligence page...');
  await page.waitForTimeout(10000);

  // Take a screenshot of the Prediction Intelligence page state
  await page.screenshot({ path: 'test-results/prediction-intelligence-state.png' });
  console.log('Prediction Intelligence screenshot saved to test-results/prediction-intelligence-state.png');
});
