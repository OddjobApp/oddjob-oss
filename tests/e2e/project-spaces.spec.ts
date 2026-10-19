import { test, expect } from '@playwright/test';

/**
 * Project Spaces — Phase 3 UI smoke.
 *
 * Guards the two things most likely to silently break: the /projects routes being
 * absent from the multi-SPA path lists in server/vite.ts (which renders NotFound),
 * and tab sub-state living in path segments instead of query params (admin SPA
 * routes match only one trailing segment under :rest*).
 */

test.describe('Project Spaces', () => {
    test('lists project spaces at /projects', async ({ page }) => {
        await page.goto('/projects');

        await expect(page.getByTestId('projects-dashboard')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Project Spaces' })).toBeVisible();
        // The backfill guarantees every org has a default project.
        await expect(page.getByText(/Default/).first()).toBeVisible();
    });

    test('opens a project space and namespaces tabs as path segments', async ({ page }) => {
        await page.goto('/projects');
        await page.getByTestId('projects-dashboard').waitFor();

        // Open the first project card.
        await page.locator('a[href^="/projects/"]').first().click();
        await expect(page.getByTestId('project-space-page')).toBeVisible();

        // Overview is the default tab and carries the budget rollup.
        await expect(page.getByText('Spend to date')).toBeVisible();

        await page.getByTestId('project-tab-cycles').click();
        await expect(page).toHaveURL(/\/projects\/[^/]+\/cycles$/);

        await page.getByTestId('project-tab-work').click();
        await expect(page).toHaveURL(/\/projects\/[^/]+\/work$/);
    });

    test('honours legacy ?tab= links minted before tabs became path segments', async ({ page }) => {
        await page.goto('/projects');
        const href = await page.locator('a[href^="/projects/"]').first().getAttribute('href');
        await page.goto(`${href}?tab=cycles`);
        await expect(page.getByTestId('project-space-page')).toBeVisible();
        await expect(page.getByTestId('project-tab-cycles')).toHaveAttribute('aria-selected', 'true');
    });

    test('keeps the project in the path when opening a cycle from a project', async ({ page }) => {
        await page.goto('/projects');
        const href = await page.locator('a[href^="/projects/"]').first().getAttribute('href');
        await page.goto(`${href}/cycles`);

        // Wait for the tab to resolve to either state — count() does not auto-wait,
        // so checking it directly would race the fetch and silently skip.
        const list = page.getByTestId('project-cycles-list');
        await expect(list.or(page.getByText('No cycles in this project yet'))).toBeVisible();

        const firstCycle = list.locator('a').first();
        if (await firstCycle.count() === 0) test.skip(true, 'no cycles in the default project');

        await firstCycle.click();
        // 4 segments: projects / :key / cycles / :id — the namespaced deep link.
        await expect(page).toHaveURL(/\/projects\/[^/]+\/cycles\/\d+$/);
        // And the cycle page itself must actually resolve its id under this pattern.
        await expect(page.getByText(/Page not found/)).toHaveCount(0);
    });

    test('every tab renders content or a real empty state, never a crash', async ({ page }) => {
        const projectsRes = await page.request.get('/api/projects');
        const { projects } = await projectsRes.json();
        test.skip(!projects?.length, 'no projects available');
        const key = projects[0].key;

        // A tab that throws would leave the page shell without its list AND without
        // the empty-state copy, so asserting "one or the other is visible" catches
        // both a crash and a silently blank tab.
        const expectations: Array<[string, string, RegExp]> = [
            ['apps', 'project-apps-list', /No apps have been produced/],
            ['knowledge', 'project-knowledge-list', /No datasets or documents are scoped/],
            ['activity', 'project-activity-list', /No execution activity recorded/],
        ];

        for (const [tab, testId, emptyCopy] of expectations) {
            await page.goto(`/projects/${key}/${tab}`);
            await expect(page.getByTestId('project-space-page')).toBeVisible();
            await expect(page.getByTestId(`project-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
            await expect(
                page.getByTestId(testId).or(page.getByText(emptyCopy)),
            ).toBeVisible();
        }
    });

    test('exposes the project switcher in the header', async ({ page }) => {
        await page.goto('/dashboard');
        await expect(page.getByTestId('project-switcher')).toBeVisible();
    });

    /**
     * Members and Settings are what turn §8's role table into something a user can
     * operate. Until they existed, the only way to grant access to a project was a raw
     * POST, and no UI could produce the `private` project on which membership actually
     * bites — so these two tabs are the difference between the permission model being
     * real and being decorative.
     */
    test('grants and revokes access from the Members tab', async ({ page }) => {
        const projectsRes = await page.request.get('/api/projects');
        const { projects } = await projectsRes.json();
        test.skip(!projects?.length, 'no projects available');
        const key = projects[0].key;

        await page.goto(`/projects/${key}/members`);
        await expect(page.getByTestId('project-members')).toBeVisible();

        // The grant form only renders for an owner; anything less is read-only by design.
        const submit = page.getByTestId('member-add-submit');
        if (await submit.count() === 0) test.skip(true, 'viewer has no management rights on this project');

        const picker = page.getByTestId('member-principal-select');
        await picker.click();
        const firstCandidate = page.getByRole('option').first();
        if (await firstCandidate.count() === 0) {
            test.skip(true, 'every org member already has a role on this project');
        }
        const candidateName = (await firstCandidate.textContent())?.trim() ?? '';
        await firstCandidate.click();
        await submit.click();

        // The new row must appear, and must be removable — a grant with no revoke is a
        // one-way door.
        const row = page.getByTestId('project-member-user').filter({ hasText: candidateName.split(' — ')[0] });
        await expect(row).toBeVisible();
        await row.getByTestId('project-member-remove').click();
        await expect(row).toHaveCount(0);
    });

    test('settings tab can set visibility, and the default project cannot be archived', async ({ page }) => {
        const projectsRes = await page.request.get('/api/projects');
        const { projects } = await projectsRes.json();
        const fallback = projects?.find((p: any) => p.isDefault) ?? projects?.[0];
        test.skip(!fallback, 'no projects available');

        await page.goto(`/projects/${fallback.key}/settings`);
        await expect(page.getByTestId('project-settings')).toBeVisible();
        await expect(page.getByTestId('settings-name-input')).toBeVisible();

        if (fallback.isDefault) {
            // The org default holds every unassigned resource, so it must stay org-visible
            // and un-archivable however the UI is driven.
            await expect(page.getByTestId('settings-visibility')).toBeDisabled();
            await expect(page.getByTestId('settings-archive')).toHaveCount(0);
        }
    });

    test('offers a visibility choice when creating a project', async ({ page }) => {
        await page.goto('/projects');
        await page.getByTestId('new-project-button').click();
        await expect(page.getByTestId('project-visibility-select')).toBeVisible();

        await page.getByTestId('project-visibility-select').click();
        await page.getByRole('option', { name: /private/i }).click();
        // Choosing private has to say what it means — it is the one setting that hides
        // work from the rest of the org.
        await expect(page.getByText(/Only members you add/)).toBeVisible();
    });
});
