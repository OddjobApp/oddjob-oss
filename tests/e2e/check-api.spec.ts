import { test, expect } from '@playwright/test';

test('Check mission-bindings API', async ({ page }) => {
    // 1. Listen for the specific network response
    page.on('response', async response => {
        if (response.url().includes('/api/operational-cycles/202/mission-bindings')) {
            console.log('<<', response.status(), response.url());
            try {
                const body = await response.text();
                console.log('Body:', body);
            } catch(e) {
                console.log('Error reading body:', e);
            }
        }
    });

    await page.goto('/operations/cycles/202');
    await page.waitForTimeout(5000);
});
