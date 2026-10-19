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

    console.log('[Setup] Waiting for redirect to dashboard...');
    await page.waitForURL('**/dashboard*', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('[Setup] Dashboard reached, verifying visibility...');
    await expect(page.locator('text=Oddjob').first()).toBeVisible();

    console.log('[Setup] Authentication successful, saving state...');
    await page.context().storageState({ path: authFile });
});
