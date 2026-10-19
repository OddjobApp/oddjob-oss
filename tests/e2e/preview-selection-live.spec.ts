/**
 * Live check of preview element selection.
 *
 * Selection only exists while the forged app is running, so this starts it first
 * and waits for the preview to actually serve HTML. The assertions that matter
 * are the two the feature promises: clicking an element in the iframe captures it,
 * and nothing the selection draws can cover the chat composer.
 */

import { test, expect } from '@playwright/test';

const APP_ID = process.env.TRIAGE_APP_ID ?? '824';
const SLUG = process.env.TRIAGE_APP_SLUG ?? 'rescue-dispatch';

test.setTimeout(600_000);

test('selecting an element scopes a request without covering the composer', async ({ page, request }) => {
    // ── Start the app, then wait for the preview to serve a real document ──
    const start = await request.post(`/api/apps/${APP_ID}/start`, { data: {} });
    console.log(`START status=${start.status()}`);

    let previewReady = false;
    for (let i = 0; i < 60; i++) {
        const res = await request.get(`/forged/${SLUG}`).catch(() => null);
        const body = res ? await res.text().catch(() => '') : '';
        // The unavailable page is HTML too, so check for it by name rather than
        // treating any 200 as success.
        if (res?.ok() && !/App unavailable|Oddjob is starting/i.test(body)) { previewReady = true; break; }
        await new Promise(r => setTimeout(r, 5000));
    }
    console.log(`PREVIEW_READY=${previewReady}`);
    test.skip(!previewReady, 'forged app did not come up; selection cannot be exercised');

    // ── Open the builder ───────────────────────────────────────────────────
    await page.goto(`/armory/apps/${APP_ID}`, { waitUntil: 'domcontentloaded' });
    const builderTab = page.getByRole('tab', { name: /builder|studio|interactive/i }).first();
    await builderTab.waitFor({ state: 'visible', timeout: 60_000 });
    await builderTab.click();

    const toggle = page.getByTestId('preview-select-toggle');
    await toggle.waitFor({ state: 'visible', timeout: 60_000 });
    await expect(toggle, 'Select is enabled once the app is running').toBeEnabled();

    await toggle.click();
    await expect(page.getByTestId('preview-selection-bar')).toBeVisible();

    // ── Click something inside the preview ─────────────────────────────────
    const frame = page.frameLocator('iframe[title="Forged App Preview"]');
    const target = frame.locator('h1, h2, button').first();
    await target.waitFor({ state: 'visible', timeout: 60_000 });
    await target.click();

    const chips = page.getByTestId('preview-selection-bar').locator('button', { hasText: /</ });
    await expect(chips.first(), 'the clicked element becomes a selection chip').toBeVisible({ timeout: 15_000 });

    // ── The promise the user asked about: nothing covers the composer ───────
    const composer = page.getByPlaceholder(/Direct the ARCHITECT|Refactor/i).first();
    await expect(composer).toBeVisible();

    const composerBox = await composer.boundingBox();
    const barBox = await page.getByTestId('preview-selection-bar').boundingBox();
    expect(composerBox, 'composer must have a box').not.toBeNull();
    expect(barBox, 'selection bar must have a box').not.toBeNull();

    const overlaps =
        composerBox!.x < barBox!.x + barBox!.width &&
        composerBox!.x + composerBox!.width > barBox!.x &&
        composerBox!.y < barBox!.y + barBox!.height &&
        composerBox!.y + composerBox!.height > barBox!.y;
    expect(overlaps, `selection bar ${JSON.stringify(barBox)} must not overlap composer ${JSON.stringify(composerBox)}`).toBe(false);

    // The composer must also be genuinely clickable, not merely painted.
    await composer.click({ timeout: 10_000 });
    await composer.fill('typed while a selection is active');
    await expect(composer).toHaveValue('typed while a selection is active');

    // ── Scoping seeds the composer rather than sending ─────────────────────
    await page.getByTestId('scope-change-request').click();
    await expect(composer).toHaveValue(/ONLY to the following selected element/i, { timeout: 15_000 });
    console.log('SCOPED_PROMPT=' + (await composer.inputValue()).slice(0, 200));
});
