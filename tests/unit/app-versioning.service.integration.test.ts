/**
 * App Versioning Service Tests
 */
import { describe, it, expect, beforeEach } from "vitest";
import { appVersioningService } from "@domain/apps/core/app-versioning.service";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@server/database_service";
import { appVersions, apps } from "@shared/schema";
import { eq } from "drizzle-orm";

describe("AppVersioningService", () => {
  const testAppId = 999;
  const testAppSlug = "test-versioning-app";
  const testSourcePath = path.resolve("tests/fixtures/test-app");
  const testTargetPath = path.resolve("storage/test-versions");

  beforeEach(async () => {
    // Clean up test data
    await db.delete(appVersions).where(eq(appVersions.appId, testAppId));
    await db.delete(apps).where(eq(apps.id, testAppId));

    // Clean up filesystem to prevent cross-test contamination
    await fs.rm(testSourcePath, { recursive: true, force: true });
    await fs.rm(testTargetPath, { recursive: true, force: true });

    // Create test app
    await db.insert(apps).values({
      id: testAppId,
      name: "Test App",
      slug: testAppSlug,
      description: "Test versioning",
      status: "active",
      developerOrgId: 1
    });

    // Ensure test source exists with only the baseline file
    await fs.mkdir(testSourcePath, { recursive: true });
    await fs.writeFile(
      path.join(testSourcePath, "index.tsx"),
      "export default function App() { return <div>Test</div>; }"
    );
  });

  describe("commit", () => {
    it("should create a new version", async () => {
      const version = await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Initial commit",
        author: "test@example.com",
        branch: "main"
      });

      expect(version).toBeDefined();
      expect(version.appId).toBe(testAppId);
      expect(version.versionNumber).toBe(1);
      expect(version.message).toBe("Initial commit");
      expect(version.branch).toBe("main");
      expect(version.commitHash).toHaveLength(16);
    });

    it("should increment version numbers sequentially", async () => {
      const v1 = await appVersioningService.commit(testAppId, testSourcePath, {
        message: "First",
        author: "test@example.com"
      });

      // Modify source
      await fs.writeFile(
        path.join(testSourcePath, "index.tsx"),
        "export default function App() { return <div>Updated</div>; }"
      );

      const v2 = await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Second",
        author: "test@example.com"
      });

      expect(v1.versionNumber).toBe(1);
      expect(v2.versionNumber).toBe(2);
      expect(v2.parentVersionId).toBe(v1.id);
    });

    it("should track file changes", async () => {
      // Create additional file
      await fs.writeFile(
        path.join(testSourcePath, "utils.ts"),
        "export const helper = () => 'help';"
      );

      const version = await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Add utils",
        author: "test@example.com"
      });

      expect(version.fileCount).toBeGreaterThan(0);
      expect(version.linesChanged.added).toBeGreaterThan(0);
    });
  });

  describe("getHistory", () => {
    it("should return version history", async () => {
      await appVersioningService.commit(testAppId, testSourcePath, {
        message: "First",
        author: "test@example.com"
      });

      await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Second",
        author: "test@example.com"
      });

      const history = await appVersioningService.getHistory(testAppId);

      expect(history).toHaveLength(2);
      expect(history[0].versionNumber).toBe(2);
      expect(history[1].versionNumber).toBe(1);
    });

    it("should filter by branch", async () => {
      await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Main commit",
        author: "test@example.com",
        branch: "main"
      });

      await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Feature commit",
        author: "test@example.com",
        branch: "feature"
      });

      const mainHistory = await appVersioningService.getHistory(testAppId, "main");
      expect(mainHistory).toHaveLength(1);
      expect(mainHistory[0].branch).toBe("main");
    });
  });

  describe("rollback", () => {
    it("should restore to previous version", async () => {
      const v1 = await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Version 1",
        author: "test@example.com"
      });

      // Modify files
      await fs.writeFile(
        path.join(testSourcePath, "new-file.ts"),
        "export const new = true;"
      );

      await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Version 2",
        author: "test@example.com"
      });

      // Rollback
      await appVersioningService.rollback(testAppId, v1.id, testTargetPath);

      // Verify restored files
      const files = await fs.readdir(testTargetPath);
      expect(files).not.toContain("new-file.ts");
    });
  });

  describe("diff", () => {
    it("should detect added files", async () => {
      const oldPath = path.join(testTargetPath, "old");
      const newPath = path.join(testTargetPath, "new");

      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(newPath, { recursive: true });

      await fs.writeFile(path.join(oldPath, "file1.ts"), "const a = 1;");
      await fs.writeFile(path.join(newPath, "file1.ts"), "const a = 1;");
      await fs.writeFile(path.join(newPath, "file2.ts"), "const b = 2;");

      const diff = await appVersioningService.diffVersions(oldPath, newPath);

      expect(diff.filesChanged).toHaveLength(1);
      expect(diff.filesChanged[0].status).toBe("added");
      expect(diff.filesChanged[0].path).toBe("file2.ts");
    });

    it("should detect modified files", async () => {
      const oldPath = path.join(testTargetPath, "old2");
      const newPath = path.join(testTargetPath, "new2");

      await fs.mkdir(oldPath, { recursive: true });
      await fs.mkdir(newPath, { recursive: true });

      await fs.writeFile(path.join(oldPath, "file.ts"), "const a = 1;");
      await fs.writeFile(path.join(newPath, "file.ts"), "const a = 1;\nconst b = 2;");

      const diff = await appVersioningService.diffVersions(oldPath, newPath);

      expect(diff.filesChanged[0].status).toBe("modified");
      expect(diff.filesChanged[0].additions).toBe(1);
    });
  });

  describe("tagging", () => {
    it("should add tags to versions", async () => {
      const version = await appVersioningService.commit(testAppId, testSourcePath, {
        message: "Tagged version",
        author: "test@example.com",
        tags: ["v1.0", "stable"]
      });

      await appVersioningService.tagVersion(version.id, "release");

      const updated = await appVersioningService.getVersion(version.id);
      expect(updated?.tags).toContain("release");
      expect(updated?.tags).toContain("v1.0");
    });
  });
});
