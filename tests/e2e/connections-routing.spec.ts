/**
 * Connections routing — every nav destination must render its page.
 *
 * Regression cover for two independent faults that both surfaced as "Page not
 * found" while the sidebar and breadcrumb updated normally:
 *
 *   1. /connections/credentials, /connections/integrations and
 *      /connections/mcp-tokens were advertised by AppSidebar and the breadcrumb
 *      map but never registered in AdminRouting — only their legacy top-level
 *      aliases (/credentials, /admin/integrations, /admin/mcp-tokens) existed.
 *
 *   2. OperationsRouting delegated with `path="/connections/:rest*"`, which
 *      regexparam compiles to `([^/]+?)` — exactly ONE trailing segment. Every
 *      two-segment child (/connections/saas/workflows, /connections/saas/sync-config)
 *      failed to match and never reached AdminRouting at all.
 *
 * Asserting on NotFound specifically, rather than on each page's contents, keeps
 * this a routing test: it fails for the reason it is named after.
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/user.json' });

const CONNECTIONS_ROUTES = [
    '/connections',
    '/connections/credentials',
    '/connections/credentials/new',
    '/connections/integrations',
    '/connections/mcp-tokens',
    '/connections/saas',
    '/connections/saas/workflows',
    '/connections/saas/sync-config',
    '/connections/saas/analytics',
];

test.describe('Connections routes resolve', () => {
    for (const route of CONNECTIONS_ROUTES) {
        test(`${route} does not render NotFound`, async ({ page }) => {
            await page.goto(route, { waitUntil: 'domcontentloaded' });

            // The SPA renders the shell first, so wait for the route to settle
            // rather than sampling the very first paint.
            await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 20_000 });

            await expect(
                page.getByText('Page not found', { exact: false }),
                `${route} rendered NotFound — it is missing a Route, or its parent wildcard cannot reach it`,
            ).toHaveCount(0);
        });
    }
});
