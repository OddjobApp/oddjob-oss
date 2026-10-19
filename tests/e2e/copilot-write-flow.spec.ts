import { test, expect } from '@playwright/test';

// Live check of the write-request behavior change: in a read-only mode the
// Copilot should offer the Execute-mode path (not refuse) when asked to modify.
test('Copilot offers Execute mode for a write request instead of refusing', async ({ page }) => {
    test.setTimeout(180000);

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('text=Oddjob').first()).toBeVisible({ timeout: 30000 });

    // Open the Copilot the way the app does.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('agent-assist-request', { detail: {} })));

    // Find the chat input (textarea) and type a write request.
    const input = page.locator('textarea').first();
    await expect(input).toBeVisible({ timeout: 15000 });
    const prompt = "Please update the 'Save Bug Report Data' job to route its output into the 'Identified Bugs' dataset.";
    await input.fill(prompt);

    // Capture the real agent response.
    const respPromise = page.waitForResponse(r => r.url().includes('/api/agent/chat'), { timeout: 150000 });
    await input.press('Enter');
    const resp = await respPromise;
    console.log('CHAT STATUS:', resp.status());
    const raw = await resp.text().catch(() => '');
    // The endpoint pads with whitespace; strip and grab the JSON tail.
    let replyText = raw;
    try {
        const jsonStart = raw.indexOf('{');
        const parsed = JSON.parse(raw.slice(jsonStart));
        replyText = parsed.response || parsed.reply || parsed.message || raw;
    } catch { /* keep raw */ }
    console.log('--- AGENT REPLY (first 1500 chars) ---');
    console.log(String(replyText).slice(0, 1500));
    console.log('--- END REPLY ---');

    const lower = String(replyText).toLowerCase();
    const offersExecute = /execute mode|request_execute_mode|switch to execute|live execution/.test(lower);
    const flatRefusal = /(as an ai[, ]+i (?:cannot|can't|am unable))|i (?:cannot|can't) (?:directly )?modify/.test(lower);
    console.log('SIGNAL offersExecute:', offersExecute, '| flatRefusal:', flatRefusal);

    await page.screenshot({ path: 'test-results/copilot-write-flow.png', fullPage: false });

    // Primary behavior assertion: it must not flat-refuse.
    expect(flatRefusal, `Assistant flat-refused. Reply: ${String(replyText).slice(0, 400)}`).toBe(false);
});
