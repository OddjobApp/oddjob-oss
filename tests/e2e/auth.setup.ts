import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
    const dir = path.dirname(authFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    console.log('Authenticating via API (/api/login)...');
    let res: any;
    for (let attempt = 1; attempt <= 15; attempt++) {
        try {
            res = await page.request.post('/api/login', {
                data: { username: 'admin@example.com', password: 'password123' }
            });
            console.log(`API Login status (attempt ${attempt}): ${res.status()}`);
            if (res.ok()) break;
        } catch (err: any) {
            console.log(`API Login notice (attempt ${attempt}): ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    expect(res && res.ok()).toBeTruthy();

    // Save storage state
    await page.context().storageState({ path: authFile });
});
