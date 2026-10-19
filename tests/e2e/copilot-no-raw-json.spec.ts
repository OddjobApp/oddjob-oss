import { test, expect } from '@playwright/test';

/**
 * Live check that the copilot never shows raw JSON or internal agent-loop
 * scaffolding to the user.
 *
 * Regression for the "why am I seeing JSON in instant apps" report: the prose
 * stripper used a lazy regex ending in `\}`, which stopped at the first NESTED
 * closing brace, so the tail of every nested payload (`,{"key":"annualRate",…]}}`)
 * rendered as prose above the app. The orchestrator also prefixed rich payloads
 * with `[Verification: FAILED] … Context: Verification tool … returned failure`.
 *
 * The assertion is deliberately on the RENDERED TEXT, not the wire: the wire
 * legitimately carries JSON: the fix is that the UI never displays it.
 */

/** Substrings that must never appear in the visible transcript. */
const FORBIDDEN = [
    '"type":',
    '"key":',
    '"module":',
    '"componentName":',
    '"props":',
    '"formula":',
    '"defaultValue":',
    '[Verification:',
    'Verification tool',
    'Self-Corrected from previous error',
    'Invalid parameters for tool',
];

async function askCopilot(page: any, prompt: string) {
    await page.goto('/knowledge/graph', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('text=Oddjob').first()).toBeVisible({ timeout: 30000 });

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('agent-assist-request', { detail: {} })));

    const sheet = page.getByTestId('copilot-chat-sheet');
    await expect(sheet).toBeVisible({ timeout: 20000 });

    const input = page.locator('textarea').first();
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill(prompt);

    const respPromise = page.waitForResponse(
        (r: any) => r.url().includes('/api/agent/chat'),
        { timeout: 240000 },
    );
    await input.press('Enter');
    const resp = await respPromise;
    console.log('CHAT STATUS:', resp.status());

    // Let the client render the payload it just received.
    await page.waitForTimeout(4000);
    return { sheet, resp };
}

test('copilot renders a calculator request without leaking JSON or scaffolding', async ({ page }) => {
    test.setTimeout(300000);

    const { sheet, resp } = await askCopilot(
        page,
        'Build me a mortgage calculator with loan principal, annual interest rate, loan term in years, and the estimated monthly payment.',
    );

    const wire = await resp.text().catch(() => '');
    console.log('--- WIRE (first 900 chars) ---');
    console.log(wire.slice(0, 900));

    const visible = (await sheet.innerText()).trim();
    console.log('--- VISIBLE TRANSCRIPT (first 2000 chars) ---');
    console.log(visible.slice(0, 2000));
    console.log('--- END ---');

    await page.screenshot({ path: 'test-results/copilot-no-raw-json.png', fullPage: false });

    const leaks = FORBIDDEN.filter(f => visible.includes(f));
    expect(leaks, `Raw JSON / internal scaffolding visible in the transcript: ${leaks.join(', ')}`).toEqual([]);

    // A bare `{"` or a JSON array-of-objects tail is the shape of the original bug.
    expect(visible, 'A JSON object literal is visible in the transcript').not.toMatch(/\{\s*"[a-zA-Z_]+"\s*:/);
    expect(visible, 'A JSON payload tail is visible in the transcript').not.toMatch(/\}\s*\]\s*\}/);

    // ---- Submitting the form must not echo raw JSON back as the user's message ----
    // This is the 08:45 failure: the transcript showed
    //   Submitted assistant form:
    //   { "principal": "1600000", "annualRate": "5.6", … "monthlyPayment": false }
    const numberInputs = sheet.locator('input[type="number"]');
    const inputCount = await numberInputs.count();
    console.log('number inputs in the rendered form:', inputCount);

    if (inputCount >= 3) {
        await numberInputs.nth(0).fill('1600000');
        await numberInputs.nth(1).fill('5.6');
        await numberInputs.nth(2).fill('15');

        const submitBtn = sheet.locator('button[type="submit"]').last();
        await expect(submitBtn).toBeVisible({ timeout: 10000 });
        await submitBtn.click();
        await page.waitForTimeout(4000);

        const afterSubmit = (await sheet.innerText()).trim();
        console.log('--- AFTER SUBMIT (first 1200 chars) ---');
        console.log(afterSubmit.slice(0, 1200));
        console.log('--- END ---');
        await page.screenshot({ path: 'test-results/copilot-after-submit.png', fullPage: false });

        expect(afterSubmit, 'The raw JSON submission wrapper is visible').not.toContain('Submitted assistant form:');
        expect(afterSubmit, 'A JSON object literal is visible after submitting').not.toMatch(/\{\s*"[a-zA-Z_]+"\s*:/);
        // The old summary shouted raw camelCase keys; it must now read as labels.
        expect(afterSubmit, 'A raw camelCase key is visible').not.toContain('ANNUALRATE');
        expect(afterSubmit, 'A raw camelCase key is visible').not.toContain('LOANTERMYEARS');
        // And a computed field must never submit as a bare boolean.
        expect(afterSubmit, 'A computed field submitted as `false`').not.toMatch(/\bfalse\b/);
    }
});
