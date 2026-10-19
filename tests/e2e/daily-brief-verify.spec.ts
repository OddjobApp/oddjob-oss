import { test, expect } from '@playwright/test';

// Verification-only spec: drives the real Copilot "Daily brief" button end-to-end.
test('Copilot Daily brief button renders a real-data brief', async ({ page }) => {
    test.setTimeout(120000);

    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('text=Oddjob').first()).toBeVisible({ timeout: 30000 });

    // Open the Copilot sheet the same way the app does.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('agent-assist-request', { detail: {} })));

    const briefButton = page.getByRole('button', { name: 'Daily brief' });
    await expect(briefButton).toBeVisible({ timeout: 15000 });

    // Capture the actual API call the button triggers.
    const respPromise = page.waitForResponse(r => r.url().includes('/api/agent/daily-brief'), { timeout: 60000 });
    await briefButton.click();
    const resp = await respPromise;
    console.log('API STATUS:', resp.status(), resp.url());
    const body = await resp.json().catch(() => null);
    console.log('API markdown starts:', (body?.markdown ?? '').slice(0, 80));

    // The rendered brief must appear in the chat, not an error message.
    await expect(page.getByText('Oddjob Daily Brief').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Active work').first()).toBeVisible();

    const shot = 'test-results/daily-brief-verify.png';
    await page.screenshot({ path: shot, fullPage: false });
    console.log('SCREENSHOT:', shot);
    console.log('CONSOLE ERRORS:', consoleErrors.length ? consoleErrors.join(' | ') : 'none');
});
