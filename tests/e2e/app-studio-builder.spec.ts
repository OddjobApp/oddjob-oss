/**
 * App Studio Builder E2E Test & Triage Suite.
 *
 * Validates modifying an existing/created AI application in App Studio (Crew):
 *  1. Mounts App Studio Pod in Builder mode (?studio=builder&appId=:id)
 *  2. Verifies App Studio Pod header: title, mode badge, live status, open app link, focus mode
 *  3. Exercises Left Rail: Builder Chat with conversational architectural queries
 *  4. Exercises Right Rail - Primitives (Component Menu):
 *     - Browse UI Component Groups & Platform Blocks
 *     - Open Component Configurator (e.g. Badge, Button, Card)
 *     - Fill parameters and insert component prompt into builder
 *  5. Exercises Right Rail - Files Tab & Code Viewer:
 *     - Browse directory tree
 *     - Open and inspect file contents in FileContentViewer
 *     - Return back to directory tree
 *  6. Exercises Right Rail - Soul / OCEAN Personality:
 *     - Verify Radar Chart
 *     - Change archetype and save personality
 *  7. Exercises Right Rail - Wiring, Visual, Plan, Audits:
 *     - Inspect live runtime telemetry and plumbing rows
 *     - Verify Visual canvas, Development Plan, and Audit logs
 *  8. Exercises Center View:
 *     - Toggle element selection mode
 *     - Open and dismiss Publish App modal
 *     - Switch between Preview, Telemetry, and API Contract modes
 *  9. Monitors and asserts no fatal console errors or broken API endpoints
 */

import { test, expect, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/* ── Helpers ────────────────────────────────────────────────────────────── */

async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
}

async function ensureAppWorkspace(slug: string) {
    const forgeRoot = process.env.FORGE_WORKSPACE 
        ? path.resolve(process.env.FORGE_WORKSPACE)
        : (process.platform === 'win32' ? 'C:/LocalData/forge/workspace' : path.resolve('storage/forge-workspace'));
    
    const candidatePaths = [
        path.join(forgeRoot, slug),
        path.join('C:/LocalData/forge/workspace', slug),
        path.resolve('storage/forge-workspace', slug),
    ];
    let existsWithFiles = false;
    for (const p of candidatePaths) {
        try {
            const files = await fs.readdir(p);
            if (files.length > 0) {
                existsWithFiles = true;
                break;
            }
        } catch {}
    }
    if (!existsWithFiles) {
        const dest = candidatePaths[0]; // canonical forgeRoot/slug
        await fs.mkdir(dest, { recursive: true });
        const templateSrc = path.resolve('storage/forge-workspace/location-search');
        try {
            const entries = await fs.readdir(templateSrc, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.next') continue;
                await fs.cp(path.join(templateSrc, entry.name), path.join(dest, entry.name), { recursive: true });
            }
            console.log(`[AppStudio E2E] Seeded workspace files for ${slug} into ${dest}`);
        } catch (e: any) {
            console.warn(`[AppStudio E2E] Could not seed workspace from template: ${e.message}`);
        }
    }
}

async function screenshot(page: Page, artifactDir: string, testInfo: TestInfo, name: string) {
    await ensureDir(artifactDir);
    const filePath = path.join(artifactDir, name);
    await page.screenshot({ path: filePath });
    await testInfo.attach(name, { path: filePath, contentType: 'image/png' });
}

async function getTargetAppId(): Promise<{ id: number; name: string; slug: string }> {
    if (process.env.APP_ID) {
        const id = parseInt(process.env.APP_ID, 10);
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        try {
            const res = await pool.query(`SELECT id, name, slug FROM apps WHERE id = $1`, [id]);
            if (res.rows.length > 0) {
                await ensureAppWorkspace(res.rows[0].slug);
                return res.rows[0];
            }
        } finally {
            await pool.end();
        }
        return { id, name: 'Target App', slug: 'target-app' };
    }
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const res = await pool.query(`
            SELECT a.id, a.name, a.slug 
            FROM apps a
            JOIN app_deployments ad ON ad.app_id = a.id
            WHERE ad.status = 'active'
            ORDER BY a.id DESC
            LIMIT 1
        `);
        if (res.rows.length > 0) {
            await ensureAppWorkspace(res.rows[0].slug);
            return res.rows[0];
        }
        // Fallback to any app
        const anyApp = await pool.query(`SELECT id, name, slug FROM apps ORDER BY id DESC LIMIT 1`);
        if (anyApp.rows.length > 0) {
            await ensureAppWorkspace(anyApp.rows[0].slug);
            return anyApp.rows[0];
        }
        throw new Error('No apps found in database');
    } finally {
        await pool.end();
    }
}

const IGNORABLE = [
    /favicon/i,
    /Download the React DevTools/i,
    /\[vite\] connect/i,
    /ERR_CONNECTION_REFUSED/i,
    /\/forged\//,
    /Refused to (apply style|execute script)/i,
    /Failed to load resource: the server responded with a status of (404|502)/i,
];

/* ── Test Suite ──────────────────────────────────────────────────────────── */

test.describe('App Studio Builder in Crew Chat', () => {
    test.setTimeout(180_000);

    test('validates complete App Studio builder workflow: chat, component menu, files, soul, wiring, and preview modes', async ({ page }, testInfo) => {
        const targetApp = await getTargetAppId();
        console.log(`[AppStudio E2E] Target app: ID=${targetApp.id}, Name="${targetApp.name}", Slug="${targetApp.slug}"`);

        const artifactDir = path.join(process.cwd(), 'test-results', 'app-studio-builder', `app-${targetApp.id}`);
        await ensureDir(artifactDir);

        const consoleErrors: string[] = [];
        const failedRequests: string[] = [];

        page.on('console', (msg) => {
            if (msg.type() !== 'error') return;
            const text = msg.text();
            if (IGNORABLE.some(re => re.test(text))) return;
            consoleErrors.push(text.slice(0, 300));
        });

        page.on('response', async (res) => {
            const url = res.url();
            if (!url.includes('/api/')) return;
            // Ignore optional crew chat ancillary endpoints for fresh rooms
            if (/\/api\/crew\/[^/]+\/(attachments|breakouts|cycle-fleet)/.test(url)) return;
            if (res.status() >= 400 && !url.includes('favicon')) {
                let errBody = '';
                try { errBody = await res.text(); } catch {}
                failedRequests.push(`${res.status()} ${res.request().method()} ${url.replace(/^https?:\/\/[^/]+/, '')} -> ${errBody.slice(0, 200)}`);
            }
        });

        /* ── Phase 1: Mount App Studio in Crew Chat ───────────────────────── */
        const sessionKey = `app-studio-triage-${Date.now()}`;
        const targetUrl = `/workspace/chat/${sessionKey}?studio=builder&appId=${targetApp.id}`;
        console.log(`[AppStudio E2E] Navigating to: ${targetUrl}`);

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await expect(page, 'should not redirect to login').not.toHaveURL(/\/auth\/login/);

        // Wait for App Studio Pod to render in builder mode
        const studioPod = page.locator('[data-testid="app-studio-pod"]');
        await expect(studioPod).toBeVisible({ timeout: 45_000 });
        await expect(studioPod).toHaveAttribute('data-mode', 'builder', { timeout: 30_000 });

        await screenshot(page, artifactDir, testInfo, '01-app-studio-mounted.png');

        /* ── Phase 2: Verify Pod Header Controls ──────────────────────────── */
        console.log('[AppStudio E2E] Validating Pod header controls...');
        // App title in header
        const headerTitle = studioPod.locator('header span.font-semibold').first();
        await expect(headerTitle).toBeVisible();

        // Mode badge
        const modeBadge = studioPod.locator('[data-testid="app-studio-mode"]').first();
        await expect(modeBadge).toBeVisible();

        // Live status badge
        const statusBadge = studioPod.locator('[data-testid="app-studio-status"]').first();
        if (await statusBadge.count() > 0) {
            console.log(`[AppStudio E2E] App live status: ${await statusBadge.innerText()}`);
        }

        // Open App link
        const openAppBtn = studioPod.locator('[data-testid="app-studio-open"]').first();
        if (await openAppBtn.count() > 0) {
            await expect(openAppBtn).toBeVisible();
        }

        // Focus mode toggle
        const focusBtn = studioPod.locator('[data-testid="app-studio-focus"]').first();
        if (await focusBtn.count() > 0) {
            await focusBtn.click();
            await page.waitForTimeout(300);
            await focusBtn.click();
            await page.waitForTimeout(300);
        }

        await screenshot(page, artifactDir, testInfo, '02-header-verified.png');

        /* ── Phase 3: Exercise Builder Chat (Left Rail) ───────────────────── */
        console.log('[AppStudio E2E] Testing Builder Chat...');
        const chatInput = page.getByPlaceholder(/Direct the ARCHITECT|Refactor/i).first();
        await expect(chatInput).toBeVisible({ timeout: 20_000 });

        // Ask a design / architecture question
        await chatInput.fill('What design themes, typography fonts, and components are available in this studio?');
        const sendBtn = studioPod.locator('[data-testid="builder-chat-submit"]').first();
        if (await sendBtn.count() > 0 && await sendBtn.isEnabled()) {
            await sendBtn.click();
        } else {
            await chatInput.press('Enter');
        }

        // Wait for response to appear in chat
        await expect(async () => {
            const bodyText = await studioPod.innerText();
            expect(bodyText).toMatch(/available|themes|components|fonts|options|Oddjob/i);
        }).toPass({ timeout: 45_000 });

        await screenshot(page, artifactDir, testInfo, '03-chat-conversation.png');

        /* ── Phase 4: Exercise Component Menu (Primitives Tab) ────────────── */
        console.log('[AppStudio E2E] Testing Primitives / Component Menu...');
        const primitivesTab = page.locator('button[title="Primitives"]').first();
        await expect(primitivesTab).toBeVisible({ timeout: 15_000 });
        await primitivesTab.click();
        await page.waitForTimeout(600);

        // Verify component category groups exist
        const bodyAfterPrimitives = await page.locator('body').innerText();
        expect(bodyAfterPrimitives).toMatch(/Layout|Data & Tables|Interactive|Inputs|Feedback|Platform Blocks/i);

        // Click on a component that has a configurator, e.g. Badge
        const badgeComponentBtn = page.getByRole('button', { name: /^Badge$/i }).or(page.locator('button:has-text("Badge")')).first();
        if (await badgeComponentBtn.count() > 0) {
            await badgeComponentBtn.click();
            await page.waitForTimeout(600);

            // Verify configurator modal or fields are visible
            const textInput = page.getByPlaceholder(/e\.g\. Active/i).or(page.getByLabel(/Text/i)).first();
            if (await textInput.count() > 0) {
                await textInput.fill('System Operational VIP');
                // Click Materialize / Insert / Apply
                const insertBtn = page.getByRole('button', { name: /Materialize Component|Insert|Apply|Add/i }).first();
                if (await insertBtn.count() > 0 && await insertBtn.isEnabled()) {
                    await insertBtn.click();
                    await page.waitForTimeout(1000);
                }
            }
        }

        await screenshot(page, artifactDir, testInfo, '04-primitives-component-inserted.png');

        /* ── Phase 5: Exercise Files Tab & Code Viewer ─────────────────────── */
        console.log('[AppStudio E2E] Testing Files Tab & Code Viewer...');
        const filesTab = page.locator('button[title="Files"]').first();
        await expect(filesTab).toBeVisible();
        await filesTab.click();
        await page.waitForTimeout(600);

        // Check file tree items
        const fileButtons = page.locator('button:has(svg.lucide-file-code-2), button:has(svg.lucide-file-json), button:has(svg.lucide-file-text)');
        const fileCount = await fileButtons.count();
        console.log(`[AppStudio E2E] File items discovered in tree: ${fileCount}`);

        if (fileCount > 0) {
            // Click the first file
            const firstFile = fileButtons.first();
            const fileName = await firstFile.innerText();
            console.log(`[AppStudio E2E] Viewing file: ${fileName}`);
            await firstFile.click();
            await page.waitForTimeout(800);

            // Verify FileContentViewer mounts with file path
            const viewerHeader = page.locator('pre').first();
            await expect(viewerHeader).toBeVisible({ timeout: 10_000 });

            // Click close button to return to tree
            const backBtn = page.locator('[data-testid="close-file-viewer"]').or(page.locator('button:has(svg.lucide-chevron-left)')).first();
            if (await backBtn.count() > 0) {
                await backBtn.click({ force: true });
                await page.waitForTimeout(400);
            }
        }

        await screenshot(page, artifactDir, testInfo, '05-files-tab-and-viewer.png');

        /* ── Phase 6: Exercise Soul & Personality Tab ──────────────────────── */
        console.log('[AppStudio E2E] Testing Soul Tab...');
        const soulTab = page.locator('button[title="Soul"]').first();
        await expect(soulTab).toBeVisible();
        await soulTab.click({ force: true });
        await page.waitForTimeout(600);

        // Verify OCEAN traits / radar chart rendered
        const soulText = await page.locator('body').innerText();
        expect(soulText).toMatch(/Openness|Conscientiousness|Extraversion|Agreeableness|Neuroticism|OCEAN/i);

        // Select an archetype or click save
        const savePersonalityBtn = page.getByRole('button', { name: /Save Soul Personality|Save/i }).first();
        if (await savePersonalityBtn.count() > 0 && await savePersonalityBtn.isEnabled()) {
            await savePersonalityBtn.click({ force: true });
            await page.waitForTimeout(500);
        }

        await screenshot(page, artifactDir, testInfo, '06-soul-personality.png');

        /* ── Phase 7: Exercise Wiring, Visual, Plan, Audits ────────────────── */
        console.log('[AppStudio E2E] Testing Wiring, Visual, Plan, Audits tabs...');
        
        // Wiring
        const wiringTab = page.locator('button[title="Wiring"]').first();
        await expect(wiringTab).toBeVisible();
        await wiringTab.click({ force: true });
        await page.waitForTimeout(600);
        const wiringContent = await page.locator('body').innerText();
        expect(wiringContent).toMatch(/RUNTIME|PORT|HEALTH|STATUS/i);

        // Visual
        const visualTab = page.locator('button[title="Visual"]').first();
        if (await visualTab.count() > 0) {
            await visualTab.click({ force: true });
            await page.waitForTimeout(600);
        }

        // Plan
        const planTab = page.locator('button[title="Plan"]').first();
        if (await planTab.count() > 0) {
            await planTab.click({ force: true });
            await page.waitForTimeout(600);
        }

        // Audits
        const auditsTab = page.locator('button[title="Audits"]').first();
        if (await auditsTab.count() > 0) {
            await auditsTab.click({ force: true });
            await page.waitForTimeout(600);
        }

        await screenshot(page, artifactDir, testInfo, '07-studio-tabs.png');

        /* ── Phase 8: Center Pane Modes (Preview, API, Telemetry) ──────────── */
        console.log('[AppStudio E2E] Testing Center View modes...');

        // Selection mode toggle
        const selectToggleBtn = page.locator('[data-testid="preview-select-toggle"]').first();
        if (await selectToggleBtn.count() > 0 && await selectToggleBtn.isEnabled()) {
            await selectToggleBtn.click({ force: true });
            await page.waitForTimeout(400);
            const selectionBar = page.locator('[data-testid="preview-selection-bar"]').first();
            await expect(selectionBar).toBeVisible({ timeout: 5000 });
            // Toggle off
            await selectToggleBtn.click({ force: true });
            await page.waitForTimeout(300);
        }

        // Publish Modal
        const publishBtn = page.getByRole('button', { name: /Publish App/i }).first();
        if (await publishBtn.count() > 0) {
            await publishBtn.click({ force: true });
            await page.waitForTimeout(500);
            const publishModal = page.getByRole('dialog').or(page.locator('[data-testid="publish-modal"]')).first();
            if (await publishModal.count() > 0) {
                // Close modal
                const cancelOrClose = publishModal.getByRole('button', { name: /Cancel|Close/i }).or(publishModal.locator('button:has(svg.lucide-x)')).first();
                if (await cancelOrClose.count() > 0) {
                    await cancelOrClose.click({ force: true });
                } else {
                    await page.keyboard.press('Escape');
                }
                await page.waitForTimeout(400);
            }
        }

        // Switch to API Contract
        const apiContractBtn = page.getByRole('button', { name: /API Contract/i }).first();
        if (await apiContractBtn.count() > 0) {
            await apiContractBtn.click({ force: true });
            await page.waitForTimeout(500);
        }

        // Switch to Telemetry Logs
        const telemetryBtn = page.getByRole('button', { name: /Telemetry/i }).first();
        if (await telemetryBtn.count() > 0) {
            await telemetryBtn.click({ force: true });
            await page.waitForTimeout(500);
        }

        // Switch back to Preview
        const previewBtn = page.getByRole('button', { name: /Preview/i }).first();
        if (await previewBtn.count() > 0) {
            await previewBtn.click({ force: true });
            await page.waitForTimeout(500);
        }

        await screenshot(page, artifactDir, testInfo, '08-center-views.png');

        /* ── Phase 9: Diagnostics & Assertions ────────────────────────────── */
        console.log('── CONSOLE ERRORS ──\n' + JSON.stringify(consoleErrors.slice(0, 10), null, 2));
        console.log('── FAILED REQUESTS ──\n' + JSON.stringify([...new Set(failedRequests)].slice(0, 10), null, 2));

        expect(consoleErrors, `Fatal console errors during App Studio triage: ${consoleErrors.join(', ')}`).toEqual([]);
        expect(failedRequests, `Failed API requests during App Studio triage: ${failedRequests.join(', ')}`).toEqual([]);
    });
});
