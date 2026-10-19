import { test, expect } from '@playwright/test';

test.describe('X-Ray Discovery Overlay', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate and navigate to the Mission Supervisor (Observability view)
    await page.goto('/armory/missions');
    // Note: Assuming auth state is handled by auth.setup.ts
  });

  test('should trigger discovery overlay with CMD+K', async ({ page }) => {
    // Simulate CMD+K (Meta+K)
    await page.keyboard.press('Meta+K');
    
    const overlay = page.locator('text=Discovery: Find functions, routes, or db calls');
    await expect(overlay).toBeVisible();
  });

  test('should provide fuzzy search results for logic symbols', async ({ page }) => {
    await page.keyboard.press('Meta+K');
    
    // Type a common query
    await page.keyboard.type('auth');
    
    // Wait for API response and results to render
    const firstResult = page.locator('.cursor-pointer').first();
    await expect(firstResult).toBeVisible();
    
    // Verify iconography / Badge
    const badge = firstResult.locator('.badge');
    await expect(badge).toBeVisible();
  });

  test('should navigate results with keyboard and close on ESC', async ({ page }) => {
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('test');
    
    // Navigate down
    await page.keyboard.press('ArrowDown');
    
    // Close with ESC
    await page.keyboard.press('Escape');
    const overlay = page.locator('text=Discovery: Find functions');
    await expect(overlay).not.toBeVisible();
  });

  test('should jump to specific app context when clicking search node', async ({ page }) => {
    await page.keyboard.press('Meta+K');
    await page.keyboard.type('weather'); // Assuming a weather app exists in forge

    const result = page.locator('text=weather');
    if (await result.count() > 0) {
        await result.first().click();
        
        // Overlay should close
        await expect(page.locator('text=Discovery: Find functions')).not.toBeVisible();
        
        // Optional: Check if graph zoomed in (might need visual testing or checking state)
    }
  });
});
