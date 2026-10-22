import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
    // Ensure the directory exists
    const dir = path.dirname(authFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    console.log('[Setup] Navigating to login page...');
    await page.goto('/auth/login');

    console.log('[Setup] Filling credentials...');
    // Fill credentials matching standard Oddjob seed user
    await page.locator('input#designation').fill(process.env.TEST_USER_EMAIL || 'admin@example.com');
    await page.locator('input#password').fill(process.env.TEST_USER_PASSWORD || 'password123');

    console.log('[Setup] Clicking login...');
    await page.locator('button[type="submit"]').click();

    // Signed in = off the login page. The landing page has moved (dashboard, then
    // the Launchpad), so waiting for one particular route failed a good sign-in.
    console.log('[Setup] Waiting to leave the login page...');
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('text=Oddjob').first()).toBeVisible();

    // The privacy notice covers the lower part of every page until dismissed; dismissing it
    // here stores the choice in the saved state, so no test clicks through an overlay.
    const dismiss = page.getByRole('button', { name: 'Dismiss notice' });
    if (await dismiss.isVisible().catch(() => false)) {
        await dismiss.click();
    }

    console.log('[Setup] Authentication successful, saving state...');
    await page.context().storageState({ path: authFile });
});
