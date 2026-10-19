/**
 * Multi-SPA route resolution — a URL must reach the SPA that owns it.
 *
 * A route here has to clear two independent hurdles, and missing either one
 * produces the same symptom: "Page not found" while the sidebar and breadcrumb
 * still update, because the shell renders before the router resolves.
 *
 *   1. shared/spa-routes.ts must map the path prefix to the right HTML template.
 *      It lists prefixes per SPA, and both dev and prod serving use it; a prefix
 *      missing from every list gets the login recovery page with a 404, so the
 *      owning SPA never loads at all.
 *
 *   2. That SPA's router must register the route. The same path registered in a
 *      sibling router does nothing — only the bundle actually served can match.
 *
 * The three routes below deliberately span three different bundles, so a
 * regression in the dispatch layer breaks this file rather than one page.
 * Note that shared/spa-routes.ts runs under tsx with no hot reload: changing the
 * prefix lists requires a dev-server restart before this suite reflects them.
 *
 * Asserting on NotFound's absence plus the page's own heading keeps this a
 * routing test — it fails for the reason it is named after, not because a
 * page's contents were redesigned.
 *
 * See also connections-routing.spec.ts, which covers hurdle 2 within a single
 * SPA (nested wildcard depth in the /connections subtree).
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: 'playwright/.auth/user.json' });

const ROUTES = [
    {
        path: '/projects',
        bundle: 'operations',
        heading: /Project Spaces/i,
    },
    {
        path: '/health/monitoring/1640',
        bundle: 'intelligence',
        // Detail route: the :id segment must survive to the page, so assert on
        // the id rather than a generic title.
        heading: /Execution #1640/i,
    },
    {
        path: '/a/rescue-dispatcher',
        bundle: 'login',
        // Public agent-deployment page: served by the auth bundle with no app
        // chrome, which is exactly what the /a prefix mapping exists to do.
        heading: /Rescue Dispatch AI Coordinator/i,
    },
    {
        path: '/app/dispatcher',
        bundle: 'login',
        // Public app-deployment page: served by the auth bundle (login.html).
        heading: /Dispatcher/i,
    },
];

test.describe('SPA routes resolve to their owning bundle', () => {
    for (const { path, bundle, heading } of ROUTES) {
        test(`${path} renders (${bundle} bundle)`, async ({ page }) => {
            await page.goto(path, { waitUntil: 'domcontentloaded' });

            await expect(
                page.getByRole('heading', { name: heading }).first(),
                `${path} never rendered its page — check the ${bundle} prefix list in shared/spa-routes.ts and the route registration in that SPA's router`,
            ).toBeVisible({ timeout: 20_000 });

            await expect(
                page.getByText('Page not found', { exact: false }),
                `${path} rendered NotFound — it is missing a Route, or its bundle mapping sends it to the wrong SPA`,
            ).toHaveCount(0);
        });
    }
});
