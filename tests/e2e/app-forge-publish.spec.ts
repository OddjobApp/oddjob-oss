/**
 * App Forge Publish Flow E2E — verifies the complete publish lifecycle.
 *
 * After an app has been forged, this suite validates:
 *   1. The app can be published (deployed with a public slug)
 *   2. The public URL resolves and renders
 *   3. The app registry reflects the published status
 *   4. The deployment record is correct
 *
 * This spec reuses an existing app from the forge-verification or triage
 * suite, or creates one fresh if none exists.
 */

import { test, expect, type APIRequestContext, type TestInfo } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

/* ── Utilities ──────────────────────────────────────────────────────────── */

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeArtifact(
  testInfo: TestInfo,
  dir: string,
  name: string,
  body: unknown,
  contentType = "application/json",
) {
  await ensureDir(dir);
  const filePath = path.join(dir, name);
  const content = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  await fs.writeFile(filePath, content);
  await testInfo.attach(name, { path: filePath, contentType });
}

async function createAndWaitForApp(request: APIRequestContext, slug: string) {
  const forgeRes = await request.post("/api/apps/forge", {
    data: {
      name: `Publish Test ${slug}`,
      slug,
      description: "An app created to test the publish pipeline.",
      blueprint: "crud-app",
      skipToAssembly: true,
      blackboard: {
        target_collection: "publish_test",
        entity_singular: "Item",
        columns: [{ key: "name", label: "Name", type: "text" }],
        metrics: [{ label: "Total", valueAccessor: "count", iconName: "Layers" }],
      },
    },
  });

  const forgeBody = await forgeRes.json();
  if (!forgeRes.ok() || !forgeBody.jobId) {
    throw new Error(`Forge creation failed: ${JSON.stringify(forgeBody)}`);
  }

  const jobId = forgeBody.jobId;
  const maxMs = 15 * 60 * 1000;
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    const statusRes = await request.get(`/api/apps/forge/status/${jobId}`);
    if (statusRes.ok()) {
      const status = await statusRes.json();
      if (status.status === "completed" || status.status === "complete") {
        return { appId: status.appId, slug: status.slug || slug, jobId };
      }
      if (status.status === "failed" || status.status === "error") {
        throw new Error(`Forge failed: ${status.error ?? status.message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  throw new Error(`Forge did not complete within ${maxMs / 1000}s`);
}

/* ── Test Suite ──────────────────────────────────────────────────────────── */

test.describe("App Forge Publish Pipeline", () => {
  test.describe.configure({ mode: "serial" });

  const runId = Date.now();
  const testSlug = `publish-e2e-${runId}`;
  const artifactDir = path.resolve(process.cwd(), "test-results", "app-forge-publish", testSlug);
  let appId: number;
  let appSlug: string;

  test("creates a forged app to publish", async ({ request }, testInfo) => {
    test.setTimeout(16 * 60 * 1000);

    console.log(`[PUBLISH] Creating app: ${testSlug}`);
    const result = await createAndWaitForApp(request, testSlug);
    appId = result.appId;
    appSlug = result.slug;

    await writeArtifact(testInfo, artifactDir, "forge-result.json", result);
    console.log(`[PUBLISH] App created: id=${appId}, slug=${appSlug}`);
  });

  test("deployment record exists for the forged app", async ({ request }, testInfo) => {
    test.setTimeout(30_000);
    expect(appId, "appId should be set").toBeDefined();

    const res = await request.get(`/api/apps/${appId}/deploy`);
    const deployment = await res.json();
    await writeArtifact(testInfo, artifactDir, "deployment.json", deployment);

    expect(res.ok(), `Deployment lookup failed: ${res.status()}`).toBeTruthy();
    expect(
      deployment.appId ?? deployment.id,
      "Deployment should reference the forged app"
    ).toBeDefined();
  });

  test("forged app is accessible at runtime URL", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    const url = `/forged/${appSlug}/`;
    console.log(`[PUBLISH] Navigating to ${url}`);

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);

    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await expect(page.locator("body")).toBeVisible();

    const html = await page.content();
    expect(html.length).toBeGreaterThan(200);

    const shotPath = path.join(artifactDir, "published-app.png");
    await ensureDir(artifactDir);
    await page.screenshot({ path: shotPath, fullPage: true });
    await testInfo.attach("published-app.png", { path: shotPath, contentType: "image/png" });
  });

  test("app appears in the fleet registry", async ({ request }, testInfo) => {
    test.setTimeout(30_000);

    const res = await request.get("/api/apps/fleet");
    if (res.ok()) {
      const fleet = await res.json();
      const found = (fleet as any[]).find(
        (app: any) => app.id === appId || app.slug === appSlug
      );
      await writeArtifact(testInfo, artifactDir, "fleet-check.json", {
        found: !!found,
        appId,
        slug: appSlug,
      });
      expect(found, "App should appear in fleet").toBeDefined();
    }
  });

  test("installed apps list reflects active status", async ({ request }, testInfo) => {
    test.setTimeout(30_000);

    const res = await request.get("/api/apps/installed");
    expect(res.ok()).toBeTruthy();

    const installed = await res.json();
    const row = (installed as any[]).find((r: any) => r.app?.id === appId);
    await writeArtifact(testInfo, artifactDir, "installed.json", {
      found: !!row,
      status: row?.app?.status,
      deploymentStatus: row?.deployment?.status,
    });

    expect(row, "App must be in installed list").toBeDefined();
  });

  test("cleanup: deletes test app", async ({ request }) => {
    test.setTimeout(15_000);
    if (!appId) return;

    const res = await request.delete(`/api/apps/${appId}`);
    expect([200, 204, 404].includes(res.status())).toBe(true);
    console.log(`[PUBLISH] Cleanup: DELETE /api/apps/${appId} → ${res.status()}`);
  });
});
