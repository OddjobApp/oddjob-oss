import { describe, test, expect } from "vitest";
import {
  parseTestFile,
  assembleSpecContent,
  buildManifestV2,
  validateSuiteCatalog,
  type E2ESuiteCatalog,
} from "../autonomous/e2e-test-indexer.service.js";

describe("E2ETestIndexerService", () => {
  const dummySpecContent = `
import { test, expect } from '@playwright/test';

test.describe('Dashboard Smoke Tests', () => {
  test('should load the dashboard and display sidebar links', async ({ page }) => {
    console.log('[Smoke] Opening main page...');
    await page.goto('/');
    await expect(page.locator('[data-testid="link-dashboard"]')).toBeVisible();
  });

  test.only('should fail intentionally when checking non-existent element (failure demo)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#non-existent-failure-trigger-element')).toBeVisible({ timeout: 5000 });
  });

  test.skip('should skip this test', async ({ page }) => {
    console.log('Skipping...');
  });
});
`;

  test("should parse test blocks correctly", () => {
    const filePath = "playwright-test-repo/tests/smoke/dashboard.spec.ts";
    const tests = parseTestFile(filePath, dummySpecContent);

    expect(tests).toHaveLength(3);

    expect(tests[0]).toMatchObject({
      testName: "should load the dashboard and display sidebar links",
      id: "dashboard:should_load_the_dashboard_and_display_sidebar_links",
      filePath,
    });
    expect(tests[0].code).toContain("should load the dashboard and display sidebar links");
    expect(tests[0].startLine).toBe(5);

    expect(tests[1]).toMatchObject({
      testName: "should fail intentionally when checking non-existent element (failure demo)",
      id: "dashboard:should_fail_intentionally_when_checking_non_existent_element_failure_demo",
      filePath,
    });
    expect(tests[1].code).toContain("should fail intentionally when checking non-existent element");
    expect(tests[1].startLine).toBe(11);

    expect(tests[2]).toMatchObject({
      testName: "should skip this test",
      id: "dashboard:should_skip_this_test",
      filePath,
    });
    expect(tests[2].code).toContain("should skip this test");
    expect(tests[2].startLine).toBe(16);
  });

  test("should assemble spec content surgically", () => {
    const filePath = "playwright-test-repo/tests/smoke/dashboard.spec.ts";
    const testId = "dashboard:should_skip_this_test";
    const updatedTestBlock = `  test.skip('should skip this test', async ({ page }) => {
    console.log('This skipped test is updated!');
  });`;

    const updatedFileContent = assembleSpecContent(dummySpecContent, filePath, testId, updatedTestBlock);

    expect(updatedFileContent).toContain("This skipped test is updated!");
    expect(updatedFileContent).toContain("should load the dashboard and display sidebar links");
    // Ensure the structure remains intact
    const parsed = parseTestFile(filePath, updatedFileContent);
    expect(parsed).toHaveLength(3);
    expect(parsed[2].code).toContain("This skipped test is updated!");
  });

  test("builds a suite-aware v2 manifest with behavior links", () => {
    const behaviorSpec = `
test('opens E2E health', async ({ page }) => {
  // @behavior ui.health.navigation.e2e-tests.12345678
  // @tag critical
  await page.goto('/health/e2e-tests');
  await expect(page).toHaveURL('/health/e2e-tests');
});`;
    const tests = parseTestFile("playwright-test-repo/tests/features/health/e2e.spec.ts", behaviorSpec);
    const catalog: E2ESuiteCatalog = {
      schemaVersion: 1,
      suites: [{
        id: "health.e2e-testing",
        name: "E2E Test Health",
        path: "tests/features/health",
        domain: "health",
        feature: "e2e-testing",
        tier: "feature",
        owner: "platform",
        routes: ["/health/e2e-tests"],
        tags: ["health"],
        schedule: "on-change",
      }],
    };

    const manifest = buildManifestV2(tests, catalog, "2026-07-18T00:00:00.000Z");
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      summary: { suiteCount: 1, populatedSuiteCount: 1, testCount: 1, behaviorCount: 1, orphanTestCount: 0 },
      suites: [expect.objectContaining({ id: "health.e2e-testing", testCount: 1, behaviorCount: 1 })],
      tests: [expect.objectContaining({
        suiteId: "health.e2e-testing",
        behaviorIds: ["ui.health.navigation.e2e-tests.12345678"],
        tags: ["health", "critical"],
      })],
    });
  });

  test("rejects duplicate suites and orphan tests", () => {
    const duplicateCatalog: E2ESuiteCatalog = {
      schemaVersion: 1,
      suites: [
        { id: "platform.smoke", name: "One", path: "tests/smoke", domain: "platform", feature: "shell", tier: "smoke", owner: "platform", routes: [], tags: [], schedule: "per-commit" },
        { id: "platform.smoke", name: "Two", path: "tests/other", domain: "platform", feature: "other", tier: "feature", owner: "platform", routes: [], tags: [], schedule: "manual" },
      ],
    };
    expect(validateSuiteCatalog(duplicateCatalog)).toContain("Duplicate suite id: platform.smoke");

    const validCatalog: E2ESuiteCatalog = { schemaVersion: 1, suites: [duplicateCatalog.suites[0]] };
    const orphan = parseTestFile("playwright-test-repo/tests/unregistered/example.spec.ts", `test('orphan', async ({ page }) => { await expect(page).toHaveTitle('Oddjob'); });`);
    expect(() => buildManifestV2(orphan, validCatalog)).toThrow("Tests without a registered suite");
  });
});
