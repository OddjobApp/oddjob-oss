/**
 * Unit Tests for Causal-Spatial Decision Intelligence
 */

import { describe, expect, it } from "vitest";
import {
  CausalGraphService,
  type AssetMetadata,
} from "../../core/causal-graph.service.js";
import type { EventPrimitive } from "@shared/schema/index.js";

describe("Causal-Spatial Decision Intelligence", () => {
  const service = new CausalGraphService();

  const sampleEvent: EventPrimitive = {
    id: "evt-trade-sanction-01",
    organizationId: 1,
    sourceFeedId: 10,
    title: "Trade Restriction Enacted",
    summary: "Export embargo placed on critical semiconductor fab machinery.",
    targetSector: "Semiconductor",
    jurisdiction: "US",
    severity: "Critical",
    confidence: 0.95,
    eventTimestamp: new Date(),
    processedAt: new Date(),
    rawPayload: {},
    sourceUrl: "https://news.example.com",
    causalStatus: "unlinked",
  } as any;

  const assets: AssetMetadata[] = [
    {
      entityId: "mission-fab-expansion",
      entityType: "mission",
      organizationId: 1,
      sectorTags: ["Semiconductor", "Hardware"],
      operatingRegions: ["US", "TW"],
    },
    {
      entityId: "supplier-litho-corp",
      entityType: "supplier",
      organizationId: 1,
      sectorTags: ["Semiconductor"],
      operatingRegions: ["NL", "US"],
    },
    {
      entityId: "cycle-apparel-logistics",
      entityType: "cycle",
      organizationId: 1,
      sectorTags: ["Apparel"],
      operatingRegions: ["VN"],
    },
  ];

  it("calculates composite blast radius score and identifies affected assets", async () => {
    const result = await service.evaluateCausalSpatialImpact(
      sampleEvent,
      assets,
      ["872830828ffffff"], // H3 hex cell
    );

    expect(result.eventId).toBe(sampleEvent.id);
    expect(result.matchedAssets.length).toBe(2); // fab-expansion and litho-corp match semiconductor
    expect(result.totalBlastRadiusScore).toBeGreaterThan(0);
    expect(result.severityMultiplier).toBe(3.0); // Critical
    expect(result.recommendedActions).toContain("Trigger immediate human-in-the-loop escalation");
  });

  it("assigns appropriate impact horizons based on severity", async () => {
    const criticalHorizon = await service.computeImpactHorizon({ severity: "Critical" } as any);
    const lowHorizon = await service.computeImpactHorizon({ severity: "Low" } as any);

    expect(criticalHorizon).toEqual({ min: 1, max: 7 });
    expect(lowHorizon).toEqual({ min: 90, max: 365 });
  });
});
