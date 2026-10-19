import { test, expect } from '@playwright/test';
test('same-origin iframe overlay test', async ({ page }) => {
  await page.route('**/empty.html', route => {
    route.fulfill({
      contentType: 'text/html',
      body: '<body><button id="btn" onclick="document.body.style.background=`green`">Click me</button></body>'
    });
  });

  await page.setContent(`
    <div style="position: relative; width: 400px; height: 400px; background: red;">
      <iframe id="myframe" src="/empty.html" style="width: 100%; height: 100%; border: none;"></iframe>
      <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.8); z-index: 10;"></div>
    </div>
  `);
  
  const btn = page.frameLocator('#myframe').locator('#btn');
  await expect(btn).toBeVisible({ timeout: 5000 });
  
  try {
    await btn.click({ timeout: 2000 });
    console.log("CLICK SUCCEEDED WITHOUT FORCE!");
  } catch (e) {
    console.log("CLICK FAILED AS EXPECTED:", e.message);
  }
});
