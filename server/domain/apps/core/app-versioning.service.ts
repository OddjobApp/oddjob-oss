/**
 * AppVersioningService
 * 
 * Git-like version control for forged apps. Tracks changes, supports branching,
 * diffing, and rollback operations.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { appVersions, apps } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("AppVersioningService");

export interface VersionMetadata {
  message: string;
  author: string;
  branch?: string;
  parentVersionId?: string;
  tags?: string[];
}

export interface AppVersion {
  id: string;
  appId: number;
  versionNumber: number;
  commitHash: string;
  message: string;
  author: string;
  branch: string;
  parentVersionId?: string;
  tags: string[];
  snapshotPath: string;
  fileCount: number;
  linesChanged: { added: number; removed: number };
  createdAt: Date;
}

export interface DiffResult {
  filesChanged: FileChange[];
  stats: { added: number; removed: number; modified: number };
}

interface FileChange {
  path: string;
  status: "added" | "removed" | "modified" | "unchanged";
  additions: number;
  deletions: number;
  diff?: string;
}

export class AppVersioningService {
  private versionsRoot: string;

  constructor() {
    this.versionsRoot = path.resolve("storage/app-versions");
  }

  /**
   * Initialize version control for an app
   */
  async initApp(appId: number, appSlug: string): Promise<void> {
    const appDir = path.join(this.versionsRoot, appSlug);
    await fs.mkdir(appDir, { recursive: true });
    
    logger.info(`[Versioning] Initialized version control for ${appSlug}`);
    
    await eventStream.publish(`version.init`, {
      appId,
      appSlug,
      timestamp: Date.now()
    });
  }

  /**
   * Create a new version (commit) of an app
   */
  async commit(
    appId: number,
    sourcePath: string,
    metadata: VersionMetadata
  ): Promise<AppVersion> {
    const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
    if (!app) throw new Error(`App ${appId} not found`);

    // Get next version number
    const [lastVersion] = await db
      .select()
      .from(appVersions)
      .where(eq(appVersions.appId, appId))
      .orderBy(desc(appVersions.versionNumber))
      .limit(1);

    const versionNumber = (lastVersion?.versionNumber || 0) + 1;
    const commitHash = crypto.randomBytes(8).toString("hex");
    const versionId = `v${versionNumber}-${commitHash}`;

    // Calculate diff if not first version
    let linesChanged = { added: 0, removed: 0 };
    let fileCount = 0;
    let changedFiles: string[] = [];

    if (lastVersion) {
      const diff = await this.diffVersions(lastVersion.snapshotPath, sourcePath);
      linesChanged = {
        added: diff.stats.added,
        removed: diff.stats.removed
      };
      fileCount = diff.filesChanged.filter(f => f.status !== "unchanged").length;
      changedFiles = diff.filesChanged.filter(f => f.status !== "unchanged").map(f => f.path);
    } else {
      // First version - count all files
      const files = await this.getAllFiles(sourcePath);
      fileCount = files.length;
      linesChanged.added = await this.countLines(files);
      changedFiles = files;
    }

    // Create snapshot
    const snapshotPath = path.join(
      this.versionsRoot,
      app.slug,
      versionId
    );
    await this.createSnapshot(sourcePath, snapshotPath);

    // Resolve the owning org explicitly — never silently fall back to a default tenant
    const versionOrgId = (app as any).organizationId ?? (app as any).developerOrgId ?? null;
    if (versionOrgId == null) {
      throw new Error(`App ${appId} has no organization; refusing to create a version under a default org.`);
    }

    // Persist to database
    const results = await db
      .insert(appVersions)
      .values({
        id: versionId,
        appId,
        organizationId: versionOrgId,
        versionNumber,
        commitHash,
        message: metadata.message,
        author: metadata.author,
        branch: metadata.branch || "main",
        parentVersionId: metadata.parentVersionId || lastVersion?.id,
        tags: metadata.tags || [],
        snapshotPath,
        fileCount,
        linesChanged,
        createdAt: new Date(),
      })
      .returning();

    const version = { ...(results as any)[0], linesChanged };

    logger.info(`[Versioning] Created version ${versionId} for ${app.slug}: ${metadata.message}`);

    await eventStream.publish(`version.commit`, {
      versionId,
      appId,
      appSlug: app.slug,
      versionNumber,
      message: metadata.message,
      author: metadata.author,
      organizationId: versionOrgId,
      fileCount,
      linesChanged,
      changedFiles,
      snapshotPath,
      previousSnapshotPath: lastVersion?.snapshotPath ?? null,
    });

    return version as any as AppVersion;
  }

  /**
   * Get version history for an app
   */
  async getHistory(appId: number, branch?: string): Promise<AppVersion[]> {
    const conditions = [eq(appVersions.appId, appId)];
    
    if (branch) {
      conditions.push(eq(appVersions.branch, branch));
    }

    const versions = await db
      .select()
      .from(appVersions)
      .where(and(...conditions))
      .orderBy(desc(appVersions.versionNumber));

    return versions as any as AppVersion[];
  }

  /**
   * Get a specific version
   */
  async getVersion(versionId: string): Promise<AppVersion | null> {
    const [version] = await db
      .select()
      .from(appVersions)
      .where(eq(appVersions.id, versionId))
      .limit(1);

    return version as AppVersion | null;
  }

  /**
   * Rollback to a specific version
   */
  async rollback(
    appId: number,
    targetVersionId: string,
    targetPath: string
  ): Promise<void> {
    const version = await this.getVersion(targetVersionId);
    if (!version) throw new Error(`Version ${targetVersionId} not found`);

    // Clear target path
    await fs.rm(targetPath, { recursive: true, force: true });
    
    // Restore from snapshot
    await this.restoreSnapshot(version.snapshotPath, targetPath);

    // Create rollback commit
    await this.commit(appId, targetPath, {
      message: `Rollback to ${targetVersionId}`,
      author: "system",
      branch: version.branch,
      parentVersionId: targetVersionId
    });

    logger.info(`[Versioning] Rolled back app ${appId} to ${targetVersionId}`);

    await eventStream.publish(`version.rollback`, {
      appId,
      targetVersionId,
      timestamp: Date.now()
    });
  }

  /**
   * Diff two snapshot directories
   */
  async diffVersions(oldPath: string, newPath: string): Promise<DiffResult> {
    const oldFiles = await this.getFileMap(oldPath);
    const newFiles = await this.getFileMap(newPath);

    const changes: FileChange[] = [];
    let added = 0, removed = 0, modified = 0;

    for (const [relativePath, newContent] of newFiles) {
      if (!oldFiles.has(relativePath)) {
        const lines = newContent.split("\n").length;
        changes.push({
          path: relativePath,
          status: "added",
          additions: lines,
          deletions: 0
        });
        added++;
      } else {
        const oldContent = oldFiles.get(relativePath)!;
        if (oldContent !== newContent) {
          const diff = this.computeDiff(oldContent, newContent);
          changes.push({
            path: relativePath,
            status: "modified",
            additions: diff.added,
            deletions: diff.removed,
            diff: diff.patch
          });
          modified++;
        }
      }
    }

    for (const [relativePath] of oldFiles) {
      if (!newFiles.has(relativePath)) {
        const lines = oldFiles.get(relativePath)!.split("\n").length;
        changes.push({
          path: relativePath,
          status: "removed",
          additions: 0,
          deletions: lines
        });
        removed++;
      }
    }

    return {
      filesChanged: changes,
      stats: { added, removed, modified }
    };
  }

  /**
   * High-level diff between two version IDs
   */
  async diff(fromVersionId: string, toVersionId: string): Promise<DiffResult> {
    const fromVersion = await this.getVersion(fromVersionId);
    const toVersion = await this.getVersion(toVersionId);
    if (!fromVersion || !toVersion) throw new Error("Version not found");
    return this.diffVersions(fromVersion.snapshotPath, toVersion.snapshotPath);
  }

  /**
   * High-level diff between a version ID and a working directory path
   */
  async diffWorkingDir(fromVersionId: string, currentPath: string): Promise<DiffResult> {
    const fromVersion = await this.getVersion(fromVersionId);
    if (!fromVersion) throw new Error("Version not found");
    return this.diffVersions(fromVersion.snapshotPath, currentPath);
  }

  /**
   * Tag a version
   */
  async tagVersion(versionId: string, tag: string): Promise<void> {
    const version = await this.getVersion(versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const tags = [...version.tags, tag];
    
    await db
      .update(appVersions)
      .set({ tags })
      .where(eq(appVersions.id, versionId));

    logger.info(`[Versioning] Tagged ${versionId} with ${tag}`);
  }

  /**
   * Create a branch
   */
  async createBranch(
    appId: number,
    fromVersionId: string,
    branchName: string
  ): Promise<void> {
    const fromVersion = await this.getVersion(fromVersionId);
    if (!fromVersion) throw new Error(`Version ${fromVersionId} not found`);

    await this.tagVersion(fromVersionId, `branch:${branchName}`);

    logger.info(`[Versioning] Created branch ${branchName} from ${fromVersionId}`);

    await eventStream.publish(`version.branch`, {
      appId,
      fromVersionId,
      branchName,
      timestamp: Date.now()
    });
  }

  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    async function walk(currentDir: string) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          files.push(fullPath);
        }
      }
    }

    await walk(dir);
    return files;
  }

  private async countLines(files: string[]): Promise<number> {
    let total = 0;
    for (const file of files) {
      try {
        const content = await fs.readFile(file, "utf-8");
        total += content.split("\n").length;
      } catch {
        // Skip binary files
      }
    }
    return total;
  }

  private async getFileMap(dir: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const files = await this.getAllFiles(dir);

    for (const file of files) {
      const relativePath = path.relative(dir, file);
      try {
        const content = await fs.readFile(file, "utf-8");
        map.set(relativePath, content);
      } catch {
        // Skip binary/unreadable files
      }
    }

    return map;
  }

  private async createSnapshot(source: string, target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });

    async function copyRecursive(src: string, dest: string) {
      const entries = await fs.readdir(src, { withFileTypes: true });
      
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await fs.mkdir(destPath, { recursive: true });
          await copyRecursive(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }

    await copyRecursive(source, target);
  }

  private async restoreSnapshot(source: string, target: string): Promise<void> {
    await this.createSnapshot(source, target);
  }

  private computeDiff(oldContent: string, newContent: string): { added: number; removed: number; patch: string } {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    let added = 0;
    let removed = 0;
    const patch: string[] = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        patch.push(` ${oldLine}`);
      } else if (oldLine === undefined) {
        patch.push(`+${newLine}`);
        added++;
      } else if (newLine === undefined) {
        patch.push(`-${oldLine}`);
        removed++;
      } else {
        patch.push(`-${oldLine}`);
        patch.push(`+${newLine}`);
        removed++;
        added++;
      }
    }

    return { added, removed, patch: patch.join("\n") };
  }

  /**
   * Resolve appId from numeric ID or appSlug
   */
  async resolveAppId(appId?: number | null, appSlug?: string | null): Promise<number | null> {
    if (appId) return appId;
    if (!appSlug) return null;
    const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, appSlug)).limit(1);
    return app ? app.id : null;
  }
}

export const appVersioningService = new AppVersioningService();
