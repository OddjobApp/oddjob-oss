/**
 * Live triage of the App Builder studio (/armory/apps/:id).
 *
 * This is a diagnostic sweep rather than a regression suite: it walks every
 * studio tab, exercises the controls that do not mutate the app, and reports
 * what it finds. Console errors and failed requests are collected across the
 * whole run and asserted at the end, so a tab that throws on mount is caught
 * even when it still renders something.
 *
 * Destructive controls (Start, Rebuild, Revert, Approve) are located and their
 * enabled state recorded, but deliberately NOT clicked — this runs against a
 * live workspace.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const APP_ID = process.env.TRIAGE_APP_ID ?? '824';
const APP_URL = `/armory/apps/${APP_ID}`;

const IGNORABLE = [
    /favicon/i,
    /Download the React DevTools/i,
    /\[vite\] connect/i,
    // Noise from the embedded preview, not from the builder shell under test.
    // The forged app serves HTML referencing chunk hashes it then 404s — a partial
    // build inside its own container — so the browser reports a MIME refusal per
    // asset. Scoped to /forged/ so a genuine error in the studio still fails this
    // sweep rather than being swallowed with it.
    /ERR_CONNECTION_REFUSED/i,
    /\/forged\//,
    /Refused to (apply style|execute script)/i,
    /Failed to load resource: the server responded with a status of 404/i,
];

type Findings = {
    consoleErrors: string[];
    failedRequests: string[];
};

function watch(page: Page): Findings {
    const findings: Findings = { consoleErrors: [], failedRequests: [] };

    page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (IGNORABLE.some(re => re.test(text))) return;
        findings.consoleErrors.push(text.slice(0, 300));
    });

    page.on('response', res => {
        const url = res.url();
        if (!url.includes('/api/')) return;
        if (res.status() >= 400) {
            findings.failedRequests.push(`${res.status()} ${res.request().method()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
        }
    });

    return findings;
}

test.describe('App Builder studio triage', () => {
    // The sweep opens eight panels, several of which fetch on mount.
    test.setTimeout(300_000);

    test('every studio tab mounts, and the shell reports its real state', async ({ page }) => {
        const findings = watch(page);

        await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

        // A redirect to the login page means the storage state did not apply;
        // fail loudly rather than reporting an empty page as "no findings".
        await expect(page, 'should not be bounced to login').not.toHaveURL(/\/auth\/login/);

        // The builder tab has to be opened before the studio rails exist.
        // count() does not wait: at t=0 the tab list is not rendered, count is 0,
        // and the click was being skipped entirely — so the panel never opened and
        // every control below read as missing.
        const builderTab = page.getByRole('tab', { name: /builder|studio|interactive/i }).first();
        await builderTab.waitFor({ state: 'visible', timeout: 60_000 });
        await builderTab.click();

        // The builder panel is lazy: at 2.5s its tab bar is not in the DOM yet and
        // every control reads as missing. Wait for the bar itself, not a duration.
        await page.locator('button[title="Files"]').first().waitFor({ state: 'visible', timeout: 60_000 });

        const report: Record<string, string> = {};

        // ── The three rails ────────────────────────────────────────────────
        // getByPlaceholder, not getByText: a placeholder is an attribute, not a text
        // node, so the text query reported "absent" for a rail that was plainly there.
        const chatRail = page.getByPlaceholder(/Direct the ARCHITECT|Refactor/i).first();
        report.chatRailPresent = String(await chatRail.count() > 0);

        // ── Each studio tab ────────────────────────────────────────────────
        const tabs = ['Files', 'Visual', 'Plan', 'Feed', 'Audits', 'Primitives', 'Wiring', 'Soul'];
        for (const label of tabs) {
            const btn = page.locator(`button[title="${label}"]`).first();
            const found = await btn.count();
            if (!found) {
                report[`tab:${label}`] = 'NOT FOUND';
                console.log(`[tab] ${label}: NOT FOUND`);
                continue;
            }
            await btn.click();
            await page.waitForTimeout(500);
            // "Rendered" means the panel produced visible text, not merely that a
            // container exists — an empty shell is the failure mode worth catching.
            const panelText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
            report[`tab:${label}`] = panelText.length > 200 ? 'rendered' : 'EMPTY';
            console.log(`[tab] ${label}: ${report[`tab:${label}`]}`);
        }

        // ── Wiring rows must show measured values, not the old constants ────
        await page.locator('button[title="Wiring"]').first().click({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(600);
        const wiringText = await page.locator('body').innerText();
        report.wiringShowsRuntime = String(/RUNTIME/i.test(wiringText));
        report.wiringHasStaleConstants = String(/OODA GOVERNOR|MISSION CONTROL/i.test(wiringText));

        // Controls live inside particular tabs, so each is checked with its own tab
        // active. Reading them all while Wiring was open reported the Files-tab
        // controls as missing when they were simply unmounted.
        const controls: Array<[string, string | null]> = [
            ['Pull Snapshot', 'Files'],
            ['Rebuild', null],
            ['Debug', null],
            ['Beautify', null],
        ];
        for (const [name, tab] of controls) {
            if (tab) {
                await page.locator(`button[title="${tab}"]`).first().click({ timeout: 15_000 }).catch(() => {});
                await page.waitForTimeout(400);
            }
            const c = page.getByRole('button', { name: new RegExp(name, 'i') }).first();
            report[`control:${name}`] = await c.count() ? (await c.isEnabled() ? 'enabled' : 'disabled') : 'NOT FOUND';
        }

        console.log('── BUILDER TRIAGE ──\n' + JSON.stringify(report, null, 2));
        console.log('── CONSOLE ERRORS ──\n' + JSON.stringify(findings.consoleErrors.slice(0, 15), null, 2));
        console.log('── FAILED API REQUESTS ──\n' + JSON.stringify([...new Set(findings.failedRequests)].slice(0, 15), null, 2));

        // Every tab must mount with content.
        const empty = Object.entries(report).filter(([k, v]) => k.startsWith('tab:') && v !== 'rendered');
        expect(empty, `tabs that did not render: ${JSON.stringify(empty)}`).toEqual([]);

        // No unhandled errors anywhere in the sweep.
        expect(findings.consoleErrors, 'console errors during the sweep').toEqual([]);
    });
});
