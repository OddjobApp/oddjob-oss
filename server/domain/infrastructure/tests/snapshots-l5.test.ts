/**
 * Unit Tests for Snapshots Level 5 (Delta Compression & Portable Bundles)
 */

import { describe, expect, it } from "vitest";
import {
  AutonomousSnapshotService,
  autonomousSnapshotService,
} from "../autonomous-snapshot.service.js";

describe("AutonomousSnapshotService (Level 5)", () => {
  describe("computeContentHash", () => {
    it("generates deterministic SHA-256 hash regardless of object key order", () => {
      const dataA = { name: "Oddjob", version: "1.0.0", active: true };
      const dataB = { active: true, version: "1.0.0", name: "Oddjob" };

      const hashA = autonomousSnapshotService.computeContentHash(dataA);
      const hashB = autonomousSnapshotService.computeContentHash(dataB);

      expect(hashA).toBe(hashB);
      expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("computeDeltaSnapshot and reconstructSnapshot", () => {
    it("computes structured deltas and reconstructs original state with high fidelity", () => {
      const baseState = {
        systemName: "Oddjob-Core",
        port: 5000,
        features: ["rag", "crew", "mcp"],
        settings: { timeout: 30000, debug: false },
        deprecatedField: "remove_me",
      };

      const newState = {
        systemName: "Oddjob-Core",
        port: 5000,
        features: ["rag", "crew", "mcp", "evolution"], // added evolution
        settings: { timeout: 45000, debug: true }, // modified
        newModule: "autonomous_snapshots", // added
        // deprecatedField deleted
      };

      const deltaResult = autonomousSnapshotService.computeDeltaSnapshot(baseState, newState);

      expect(deltaResult.isDelta).toBe(true);
      expect(deltaResult.delta.__added).toHaveProperty("newModule", "autonomous_snapshots");
      expect(deltaResult.delta.__deleted).toContain("deprecatedField");
      expect(deltaResult.delta.__modified).toHaveProperty("settings");

      // Reconstruct
      const reconstructed = autonomousSnapshotService.reconstructSnapshot(
        baseState,
        deltaResult.delta,
      );

      expect(reconstructed).toEqual(newState);
      expect(reconstructed).not.toHaveProperty("deprecatedField");
    });

    it("handles identical state efficiently", () => {
      const state = { key: "value", count: 42 };
      const deltaResult = autonomousSnapshotService.computeDeltaSnapshot(state, state);

      expect(deltaResult.delta.__unchanged).toBe(true);
      expect(deltaResult.compressionRatio).toBe(1.0);

      const reconstructed = autonomousSnapshotService.reconstructSnapshot(
        state,
        deltaResult.delta,
      );
      expect(reconstructed).toEqual(state);
    });
  });

  describe("createPortableBundle and importPortableBundle", () => {
    it("creates a cryptographically verifiable portable bundle and imports into target tenant", () => {
      const snapshot = {
        entityType: "pipeline",
        entityId: 101,
        organizationId: 1,
        data: {
          name: "E-commerce Ingestion Pipeline",
          nodes: [{ id: "n1", type: "fetch" }, { id: "n2", type: "transform" }],
        },
      };

      const bundle = autonomousSnapshotService.createPortableBundle(snapshot, {
        environment: "staging",
      });

      expect(bundle.schemaVersion).toBe("1.0.0");
      expect(bundle.entityType).toBe("pipeline");
      expect(bundle.contentHash).toMatch(/^[a-f0-9]{64}$/);

      // Import into target org
      const importResult = autonomousSnapshotService.importPortableBundle(bundle, 2);

      expect(importResult.valid).toBe(true);
      expect(importResult.targetOrgId).toBe(2);
      expect(importResult.importedData).toEqual(snapshot.data);
    });

    it("rejects corrupted bundles when content hash does not match", () => {
      const snapshot = {
        entityType: "mission",
        entityId: 42,
        organizationId: 1,
        data: { objective: "Security Audit" },
      };

      const bundle = autonomousSnapshotService.createPortableBundle(snapshot);

      // Tamper with data
      bundle.data.objective = "Hacked Payload";

      expect(() =>
        autonomousSnapshotService.importPortableBundle(bundle, 2),
      ).toThrow(/Cryptographic integrity error/i);
    });
  });
});
