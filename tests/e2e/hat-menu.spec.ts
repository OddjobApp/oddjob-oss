/**
 * Operational mode card strip (the "hat menu").
 *
 * This lives in e2e rather than jsdom on purpose. The bug that took the menu
 * down was a decorative glow div painted over the hat icon and swallowing its
 * clicks — a pure hit-testing failure. jsdom does no layout and no hit testing,
 * so the unit tests stayed green throughout; only a real browser sees it.
 *
 * The original code worked around that interception with an invisible
 * fixed-position button at z-[100], which is why removing the workaround looked
 * safe and was not.
 */

import { test, expect } from '@playwright/test';

const TRIGGER = '[data-testid="sidebar-hat-trigger"]';
const CARDS = '[data-testid="hat-menu-cards"]';

test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator(TRIGGER)).toBeVisible();
});

test('the sidebar hat icon actually receives the click', async ({ page }) => {
    // A plain click, with no force: if anything overlaps the icon this fails,
    // which is exactly the regression being guarded.
    await expect(page.locator(CARDS)).toBeHidden();

    await page.locator(TRIGGER).click({ timeout: 5_000 });

    await expect(page.locator(CARDS)).toBeVisible();
    await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-testid^="hat-mode-card-"]')).toHaveCount(3);
});

test('the same icon closes the strip again', async ({ page }) => {
    // The trigger sits outside the menu's subtree, so click-outside has to
    // exempt it — otherwise mousedown closes and the click reopens.
    await page.locator(TRIGGER).click();
    await expect(page.locator(CARDS)).toBeVisible();

    await page.locator(TRIGGER).click();

    await expect(page.locator(CARDS)).toBeHidden();
    await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'false');
});

test('picking a mode navigates, persists and closes', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await page.locator('[data-testid="hat-mode-card-h3-spatial-watch"]').click();

    await expect(page).toHaveURL(/\/workspace\/spatial/);
    await expect(page.locator(CARDS)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('oddjob:operational-mode')))
        .toBe('h3-spatial-watch');

    // Reopening shows the new mode as the active card.
    await page.locator(TRIGGER).click();
    await expect(page.locator('[data-testid="hat-mode-card-h3-spatial-watch"]'))
        .toHaveAttribute('data-active', 'true');
});

test('Escape and click-outside both dismiss the strip', async ({ page }) => {
    await page.locator(TRIGGER).click();
    await expect(page.locator(CARDS)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(CARDS)).toBeHidden();

    await page.locator(TRIGGER).click();
    await expect(page.locator(CARDS)).toBeVisible();
    await page.mouse.click(1200, 700);
    await expect(page.locator(CARDS)).toBeHidden();
});
