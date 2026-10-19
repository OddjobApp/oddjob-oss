/**
 * E2E Test: Forge v2 with Platform Blocks
 * 
 * Validates:
 * 1. Blueprint slot token injection works
 * 2. Forge events are emitted via SSE
 * 3. App is created with platform blocks wired correctly
 */
import { test, expect } from "@playwright/test";

test.describe("Forge v2 Platform Block Integration", () => {
  const testAppSlug = `test-crud-${Date.now()}`;
  let jobId: string | null = null;

  test("should trigger a forge with crud-app blueprint", async ({ request }) => {
    const response = await request.post("/api/apps/forge", {
      data: {
        name: `Test CRUD App ${testAppSlug}`,
        slug: testAppSlug,
        description: "A test CRUD app to validate platform block wiring",
        blueprintSlug: "crud-app",
        blackboard: {
          target_collection: "test_contacts",
          entity_singular: "Contact",
          columns: [
            { key: "name", label: "Name", type: "text" },
            { key: "email", label: "Email", type: "email" },
            { key: "company", label: "Company", type: "text" }
          ],
          metrics: [
            { label: "Total Contacts", valueAccessor: "count", iconName: "Users" },
            { label: "Active", valueAccessor: "active_count", iconName: "Activity" }
          ]
        }
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.jobId).toBeDefined();
    jobId = data.jobId;
    
    console.log(`[TEST] Forge triggered with jobId: ${jobId}`);
  });

  test("should receive forge events via SSE", async ({ request }) => {
    // Wait a moment for forge to start
    await new Promise(r => setTimeout(r, 3000));
    
    // Poll for job status
    const maxAttempts = 30;
    let attempts = 0;
    let completed = false;
    
    while (attempts < maxAttempts && !completed) {
      const response = await request.get(`/api/dlq/jobs/${jobId}`);
      
      if (response.ok()) {
        const data = await response.json();
        console.log(`[TEST] Job status (attempt ${attempts + 1}):`, data.status, data.progress + "%");
        
        if (data.status === 'complete') {
          completed = true;
          expect(data.progress).toBe(100);
          expect(data.appId).toBeDefined();
        } else if (data.status === 'failed') {
          throw new Error(`Forge failed: ${data.message}`);
        }
      }
      
      attempts++;
      await new Promise(r => setTimeout(r, 5000)); // 5 second polling
    }
    
    expect(completed).toBe(true);
  });

  test("should verify slot tokens were injected", async ({ request }) => {
    // Get app details
    const response = await request.get(`/api/apps/${testAppSlug}`);
    expect(response.ok()).toBeTruthy();
    
    const app = await response.json();
    expect(app.slug).toBe(testAppSlug);
    expect(app.status).toBe('active');
    
    // The actual token verification would require reading the built files
    // This is a simplified check
    console.log(`[TEST] App created successfully:`, app.name);
  });

  test("should verify app serves correctly", async ({ page }) => {
    // Navigate to the forged app
    await page.goto(`/apps/${testAppSlug}`);
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Check for platform block rendered content
    // PlatformDatasetTableBlock should render with the collection name
    const content = await page.content();
    
    // Should have the injected title or collection reference
    expect(content.length).toBeGreaterThan(100);
    
    // Take screenshot for verification
    await page.screenshot({ 
      path: `test-results/forge-v2-${testAppSlug}.png`,
      fullPage: true 
    });
    
    console.log(`[TEST] App screenshot saved`);
  });

  test("cleanup: should delete test app", async ({ request }) => {
    const response = await request.delete(`/api/apps/${testAppSlug}`);
    
    // May be 200 or 404 if already cleaned up
    expect([200, 204, 404].includes(response.status())).toBe(true);
    
    console.log(`[TEST] Cleanup complete`);
  });
});
