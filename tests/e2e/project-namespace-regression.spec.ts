import { test, expect } from '@playwright/test';

/**
 * Regression guard for the useRoute -> useParams refactor that made CycleDetailPage
 * and MissionRunPage mountable under the project-namespaced routes.
 *
 * Those pages previously matched a HARDCODED route pattern, so the risk of the
 * refactor is the reverse direction: that the original flat routes stopped resolving
 * their ids. A page that renders its shell but never loads the entity looks fine in a
 * screenshot, so these assert on real content.
 */

test('flat /operations/cycles/:id still resolves the cycle', async ({ page }) => {
    const res = await page.request.get('/api/cycles');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const cycles = Array.isArray(body) ? body : (body.cycles ?? body.data ?? []);
    test.skip(cycles.length === 0, 'no cycles available in this environment');

    const cycle = cycles[0];
    await page.goto(`/operations/cycles/${cycle.id}`);

    await expect(page.getByText(/Page not found/)).toHaveCount(0);
    // The page must have actually loaded THIS cycle, not just rendered its chrome.
    await expect(page.getByText(cycle.name, { exact: false }).first()).toBeVisible();
});

test('the same cycle resolves under the project-namespaced route', async ({ page }) => {
    const projectsRes = await page.request.get('/api/projects');
    const { projects } = await projectsRes.json();
    test.skip(!projects?.length, 'no projects available');

    const key = projects[0].key;
    const cyclesRes = await page.request.get(`/api/projects/${key}/cycles`);
    const { cycles } = await cyclesRes.json();
    test.skip(!cycles?.length, 'no cycles in the first project');

    const cycle = cycles[0];
    await page.goto(`/projects/${key}/cycles/${cycle.id}`);

    await expect(page.getByText(/Page not found/)).toHaveCount(0);
    await expect(page.getByText(cycle.name, { exact: false }).first()).toBeVisible();
});
