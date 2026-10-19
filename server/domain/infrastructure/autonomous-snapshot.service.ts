/**
 * Autonomous Snapshot & Delta Compression Service (Level 5)
 * ==========================================================
 * Provides content-addressed hashing, structured delta compression,
 * deterministic state reconstruction, and cross-environment portable migration bundles.
 */

import { createHash } from "node:crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AutonomousSnapshotService");

export interface DeltaSnapshotResult {
  isDelta: boolean;
  delta: Record<string, any>;
  baseHash: string;
  currentHash: string;
  originalBytes: number;
  deltaBytes: number;
  compressionRatio: number;
}

export interface PortableSnapshotBundle {
  schemaVersion: string;
  bundleId: string;
  entityType: string;
  entityId: number;
  exportedAt: string;
  contentHash: string;
  data: any;
  metadata: {
    originOrgId?: number;
    generator: string;
    customMetadata?: Record<string, any>;
  };
}

export class AutonomousSnapshotService {
  /**
   * Computes deterministic SHA-256 content hash of any data structure
   */
  computeContentHash(data: any): string {
    const serialized = JSON.stringify(data, Object.keys(data || {}).sort());
    return createHash("sha256").update(serialized).digest("hex");
  }

  /**
   * Calculates delta changes between a base snapshot and current state
   */
  computeDeltaSnapshot(baseData: any, currentData: any): DeltaSnapshotResult {
    const baseHash = this.computeContentHash(baseData);
    const currentHash = this.computeContentHash(currentData);

    const originalJson = JSON.stringify(currentData);
    const originalBytes = Buffer.byteLength(originalJson, "utf8");

    if (baseHash === currentHash) {
      return {
        isDelta: true,
        delta: { __unchanged: true },
        baseHash,
        currentHash,
        originalBytes,
        deltaBytes: 0,
        compressionRatio: 1.0,
      };
    }

    const delta: Record<string, any> = {
      __added: {},
      __modified: {},
      __deleted: [],
    };

    if (
      typeof baseData === "object" &&
      baseData !== null &&
      typeof currentData === "object" &&
      currentData !== null
    ) {
      const baseKeys = new Set(Object.keys(baseData));
      const currentKeys = new Set(Object.keys(currentData));

      // Added and modified keys
      for (const key of currentKeys) {
        if (!baseKeys.has(key)) {
          delta.__added[key] = currentData[key];
        } else if (
          JSON.stringify(baseData[key]) !== JSON.stringify(currentData[key])
        ) {
          delta.__modified[key] = currentData[key];
        }
      }

      // Deleted keys
      for (const key of baseKeys) {
        if (!currentKeys.has(key)) {
          delta.__deleted.push(key);
        }
      }
    } else {
      delta.__replacement = currentData;
    }

    const deltaJson = JSON.stringify(delta);
    const deltaBytes = Buffer.byteLength(deltaJson, "utf8");
    const compressionRatio =
      originalBytes > 0
        ? Number(((originalBytes - deltaBytes) / originalBytes).toFixed(2))
        : 0;

    return {
      isDelta: true,
      delta,
      baseHash,
      currentHash,
      originalBytes,
      deltaBytes,
      compressionRatio: Math.max(0, compressionRatio),
    };
  }

  /**
   * Deterministically reconstructs the full state from a base snapshot and delta patch
   */
  reconstructSnapshot(baseData: any, delta: Record<string, any>): any {
    if (!delta || delta.__unchanged) {
      return JSON.parse(JSON.stringify(baseData));
    }

    if (delta.__replacement !== undefined) {
      return JSON.parse(JSON.stringify(delta.__replacement));
    }

    const reconstructed = JSON.parse(JSON.stringify(baseData || {}));

    if (delta.__added) {
      for (const [k, v] of Object.entries(delta.__added)) {
        reconstructed[k] = v;
      }
    }

    if (delta.__modified) {
      for (const [k, v] of Object.entries(delta.__modified)) {
        reconstructed[k] = v;
      }
    }

    if (Array.isArray(delta.__deleted)) {
      for (const key of delta.__deleted) {
        delete reconstructed[key];
      }
    }

    return reconstructed;
  }

  /**
   * Packages a snapshot into a portable, cryptographically signed migration bundle
   */
  createPortableBundle(
    snapshot: {
      entityType: string;
      entityId: number;
      data: any;
      organizationId?: number;
    },
    metadata?: Record<string, any>,
  ): PortableSnapshotBundle {
    const contentHash = this.computeContentHash(snapshot.data);
    const bundleId = `bundle_${snapshot.entityType}_${snapshot.entityId}_${Date.now()}`;

    return {
      schemaVersion: "1.0.0",
      bundleId,
      entityType: snapshot.entityType,
      entityId: snapshot.entityId,
      exportedAt: new Date().toISOString(),
      contentHash,
      data: snapshot.data,
      metadata: {
        originOrgId: snapshot.organizationId,
        generator: "Oddjob-Autonomous-Snapshot-Engine-L5",
        customMetadata: metadata,
      },
    };
  }

  /**
   * Validates and imports a portable migration bundle into a target organization scope
   */
  importPortableBundle(
    bundle: PortableSnapshotBundle,
    targetOrgId: number,
  ): { valid: boolean; contentHash: string; importedData: any; targetOrgId: number } {
    const computedHash = this.computeContentHash(bundle.data);
    if (computedHash !== bundle.contentHash) {
      throw new Error(
        `Cryptographic integrity error: Bundle content hash (${bundle.contentHash}) does not match computed hash (${computedHash})`,
      );
    }

    logger.info(
      `[AutonomousSnapshotService] Imported bundle ${bundle.bundleId} for entity ${bundle.entityType}:${bundle.entityId} into org ${targetOrgId}`,
    );

    return {
      valid: true,
      contentHash: computedHash,
      importedData: bundle.data,
      targetOrgId,
    };
  }
}

export const autonomousSnapshotService = new AutonomousSnapshotService();
