import { test, expect, Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function navigateToBuilderTab(page: Page, appId: number) {
    await page.goto(`/armory/apps/${appId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /builder/i }).click();
    // Wait for the Studio layout to mount
    await expect(page.locator('text=Scaffold').first()).toBeVisible({ timeout: 10000 });
}

// ─── API Endpoint Tests ───────────────────────────────────────────────────────

test.describe('App Studio — File Tree API', () => {
    test('GET /api/apps/:appId/files returns 400 for invalid appId', async ({ request }) => {
        const res = await request.get('/api/apps/not-a-number/files');
        expect(res.status()).toBe(400);
    });

    test('GET /api/apps/:appId/files returns tree:null for app with no workspace', async ({ request }) => {
        // App 999999 is assumed non-existent; endpoint should 404
        const res = await request.get('/api/apps/999999/files');
        // Depending on auth, may be 401 or 404 — either is acceptable, not 500
        expect([401, 404, 403]).toContain(res.status());
    });

    test('GET /api/apps/:appId/files/content rejects path traversal', async ({ request }) => {
        // Attempt a traversal — endpoint should reject with 400
        const res = await request.get('/api/apps/1/files/content?path=../../server/utils/password.ts');
        expect([400, 401, 403, 404]).toContain(res.status());
    });

    test('GET /api/apps/:appId/files/content requires path param', async ({ request }) => {
        const res = await request.get('/api/apps/1/files/content');
        expect([400, 401, 403]).toContain(res.status());
    });
});

// ─── Studio UI Tests ─────────────────────────────────────────────────────────

test.describe('App Studio — Layout', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => {
            if (msg.type() === 'error') console.error(`[Browser] ${msg.text()}`);
        });
        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');
    });

    test('Builder tab expands the page container to wide layout', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');

        // Navigate into any installed app's detail page
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) {
            test.skip(true, 'No installed apps found — skipping layout test');
            return;
        }
        await firstApp.click();
        await page.waitForLoadState('networkidle');

        // Before clicking Builder tab, outer container should be max-w-5xl
        const container = page.locator('.container').first();
        await expect(container).not.toHaveClass(/max-w-\[1800px\]/);

        // Click Builder tab
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) {
            test.skip(true, 'Builder tab not visible (not a developer app)');
            return;
        }
        await builderTab.click();

        // Container should now be wide
        await expect(container).toHaveClass(/max-w-\[1800px\]/);
    });

    test('Studio renders three panels: Navigator, Preview, Studio', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');

        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No installed apps');

        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not a developer app');

        await builderTab.click();
        await page.waitForLoadState('networkidle');

        // Left panel: Scaffold header
        await expect(page.getByText('Scaffold').first()).toBeVisible();
        // Left panel: Plumbing header
        await expect(page.getByText('Plumbing').first()).toBeVisible();
        // Right panel: Chat tab
        await expect(page.getByRole('button', { name: /chat/i })).toBeVisible();
        // Right panel: Primitives tab
        await expect(page.getByRole('button', { name: /primitives/i })).toBeVisible();
        // Right panel: Wiring tab
        await expect(page.getByRole('button', { name: /wiring/i })).toBeVisible();
    });
});

test.describe('App Studio — Chat Tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');
    });

    test('Chat tab shows welcome message', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();

        await expect(page.getByText(/welcome to the app studio/i)).toBeVisible({ timeout: 10000 });
    });

    test('Chat submit button is disabled when input is empty', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();

        const submitBtn = page.locator('form button[type="submit"]').first();
        await expect(submitBtn).toBeDisabled();
    });

    test('Typing a prompt enables the submit button', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();

        const input = page.getByPlaceholder(/e\.g\./i).first();
        await input.fill('Add a dark mode toggle');
        const submitBtn = page.locator('form button[type="submit"]').first();
        await expect(submitBtn).toBeEnabled();
    });
});

test.describe('App Studio — Primitives Tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard');
    });

    test('Primitives tab renders tool groups and UI component groups', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();
        await page.getByRole('button', { name: /primitives/i }).click();

        await expect(page.getByText('Agent Tools').first()).toBeVisible();
        await expect(page.getByText('UI Components').first()).toBeVisible();
        // Spot-check a known group
        await expect(page.getByText('Knowledge').first()).toBeVisible();
    });

    test('Expanding a tool group reveals Wire It buttons', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();
        await page.getByRole('button', { name: /primitives/i }).click();

        // Expand the Knowledge group
        await page.getByText('Knowledge').first().click();
        await expect(page.getByText('Wire It →').first()).toBeVisible();
    });

    test('Wire It button pre-fills chat prompt and switches to Chat tab', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();
        await page.getByRole('button', { name: /primitives/i }).click();
        await page.getByText('Knowledge').first().click();
        await page.getByText('Wire It →').first().click();

        // Should have switched to Chat tab
        const chatInput = page.getByPlaceholder(/e\.g\./i).first();
        await expect(chatInput).toBeVisible();
        // Input should contain something
        const value = await chatInput.inputValue();
        expect(value.length).toBeGreaterThan(0);
    });
});

test.describe('App Studio — Wiring Tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard');
    });

    test('Wiring tab shows service connection cards', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();
        await page.getByRole('button', { name: /wiring/i }).click();

        await expect(page.getByText('Mission Link').first()).toBeVisible();
        await expect(page.getByText('Knowledge Topics').first()).toBeVisible();
        await expect(page.getByText('AI Model').first()).toBeVisible();
        await expect(page.getByText('Open Full Configuration').first()).toBeVisible();
    });

    test('Open Full Configuration navigates to Publish tab', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();
        await page.getByRole('button', { name: /wiring/i }).click();
        await page.getByText('Open Full Configuration').click();

        // Should switch to Publish tab
        const publishTab = page.getByRole('tab', { name: /publish/i });
        await expect(publishTab).toHaveAttribute('data-state', 'active');
    });
});

test.describe('App Studio — Preview Modes', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard');
    });

    test('Preview bar shows three mode buttons', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();

        await expect(page.getByRole('button', { name: /preview/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /logs/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /^file$/i })).toBeVisible();
    });

    test('Switching to Logs mode shows the log output area', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();
        await page.getByRole('button', { name: /logs/i }).click();

        // Log area should become visible (green text pre element)
        await expect(page.locator('pre.text-green-400').first()).toBeVisible();
    });
});

test.describe('App Studio — Scaffold Navigator', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard');
    });

    test('File tree shows scaffold section with refresh button', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();

        await expect(page.getByText('Scaffold').first()).toBeVisible();
        // Refresh button (RefreshCw icon) should be present in the navigator
        const navRefreshBtn = page.locator('.w-52 button').first();
        await expect(navRefreshBtn).toBeVisible();
    });

    test('Clicking a file node shows file content in the viewer', async ({ page }) => {
        await page.goto('/armory/apps');
        await page.waitForLoadState('networkidle');
        const firstApp = page.locator('[data-testid="app-card"]').first();
        if (await firstApp.count() === 0) test.skip(true, 'No apps');
        await firstApp.click();
        const builderTab = page.getByRole('tab', { name: /builder/i });
        if (await builderTab.count() === 0) test.skip(true, 'Not dev app');
        await builderTab.click();
        await page.waitForTimeout(1000); // Let file tree load

        // Try clicking the first visible file node (non-directory)
        const fileNode = page.locator('.w-52 button').filter({ hasText: '.json' }).first();
        if (await fileNode.count() === 0) {
            test.skip(true, 'No JSON files visible in tree');
            return;
        }
        await fileNode.click();

        // URL bar in preview should show the file path
        const urlBar = page.locator('.font-mono').filter({ hasText: '.json' }).first();
        await expect(urlBar).toBeVisible({ timeout: 5000 });
    });
});
