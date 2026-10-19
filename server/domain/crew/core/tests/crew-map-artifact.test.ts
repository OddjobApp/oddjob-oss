import { describe, expect, it, vi } from "vitest";
import { routingService } from "../../../rescue/core/routing-service.js";
import { RENDER_TOOLS } from "@domain/tools/v1/capabilities/render-tools.js";
import {
  detectArtifact,
  UNIVERSAL_PRESENTATION_TOOLS,
  ARTIFACT_TOOLS,
  RICH_PAYLOAD_TYPES,
} from "@domain/crew/core/crew-tools.service.js";

vi.mock("../../../rescue/core/routing-service.js", () => ({
  routingService: {
    calculateRoute: vi.fn(async () => null),
    calculateWaypointRoute: vi.fn(async () => ({
      distanceKm: 12.4,
      durationMin: 18,
      points: [
        [-118.2437, 34.0522],
        [-118.3, 34.07],
        [-118.4, 34.1],
      ],
    })),
  },
}));

describe("render_map capability", () => {
  it("executes and emits an assistant_map artifact payload", async () => {
    const markers = [
      { lat: 34.0522, lng: -118.2437, label: "Site Alpha", description: "Primary depot" },
      { lat: 34.0736, lng: -118.4004, label: "Site Beta", description: "Secondary outpost" },
    ];
    const rawResult = await RENDER_TOOLS.render_map.execute({
      title: "Closest Emergency Response Sites",
      description: "Two nearest support locations",
      markers,
      zoom: 12,
      mapStyle: "dark",
    }, {} as any);

    const payload = JSON.parse(rawResult);
    expect(payload.type).toBe("assistant_map");
    expect(payload.title).toBe("Closest Emergency Response Sites");
    expect(payload.description).toBe("Two nearest support locations");
    expect(payload.markers).toHaveLength(2);
    expect(payload.markers[0].label).toBe("Site Alpha");
    expect(payload.center).toBeDefined();
    expect(payload.center.lat).toBeCloseTo(34.0629, 2);
    expect(payload.center.lng).toBeCloseTo(-118.322, 2);
    expect(payload.zoom).toBe(12);
  });

  it("is recognized as a rich artifact by detectArtifact", async () => {
    const rawResult = await RENDER_TOOLS.render_map.execute({
      title: "Active Outposts",
      markers: [{ lat: 40.7128, lng: -74.006, label: "NYC Hub" }],
    }, {} as any);

    const artifact = detectArtifact("render_map", rawResult);
    expect(artifact).not.toBeNull();
    expect(artifact?.payload.type).toBe("assistant_map");
    expect(artifact?.payload.title).toBe("Active Outposts");
  });

  it("emits a road-snapped route payload when waypoints are provided", async () => {
    const rawResult = await RENDER_TOOLS.render_map.execute({
      title: "Delivery Route",
      markers: [{ lat: 34.0522, lng: -118.2437, label: "Depot" }],
      route: {
        waypoints: [
          { lat: 34.0522, lng: -118.2437, label: "Depot" },
          { lat: 34.0629, lng: -118.322, label: "Mid Stop" },
          { lat: 34.1, lng: -118.4, label: "Destination" },
        ],
        profile: "driving",
      },
    }, {} as any);

    const payload = JSON.parse(rawResult);
    expect(payload.type).toBe("assistant_map");
    expect(payload.route).toBeDefined();
    expect(payload.route.waypoints).toHaveLength(3);
    expect(payload.route.waypoints[1].label).toBe("Mid Stop");
    expect(payload.route.points).toEqual([
      [-118.2437, 34.0522],
      [-118.3, 34.07],
      [-118.4, 34.1],
    ]);
    expect(payload.route.snapped).toBe(true);
    expect(payload.route.distanceKm).toBe(12.4);
    expect(payload.route.durationMin).toBe(18);
    expect(payload.route.profile).toBe("driving");

    expect(routingService.calculateWaypointRoute).toHaveBeenCalledWith(
      [
        { lat: 34.0522, lng: -118.2437, label: "Depot", description: undefined },
        { lat: 34.0629, lng: -118.322, label: "Mid Stop", description: undefined },
        { lat: 34.1, lng: -118.4, label: "Destination", description: undefined },
      ],
      "driving"
    );
  });

  it("falls back to a straight-line route when no routing provider responds", async () => {
    vi.mocked(routingService.calculateWaypointRoute).mockResolvedValueOnce(null);

    const rawResult = await RENDER_TOOLS.render_map.execute({
      title: "Off-grid Route",
      markers: [{ lat: 10, lng: 20, label: "Start" }],
      route: {
        waypoints: [
          { lat: 10, lng: 20, label: "Start" },
          { lat: 11, lng: 21, label: "End" },
        ],
      },
    }, {} as any);

    const payload = JSON.parse(rawResult);
    expect(payload.route.snapped).toBe(false);
    expect(payload.route.points).toEqual([
      [20, 10],
      [21, 11],
    ]);
    expect(payload.route.distanceKm).toBeUndefined();
  });

  it("omits the route payload when fewer than two valid waypoints are given", async () => {
    const rawResult = await RENDER_TOOLS.render_map.execute({
      title: "Single Point",
      markers: [{ lat: 10, lng: 20, label: "Start" }],
      route: { waypoints: [{ lat: 10, lng: 20, label: "Start" }, { lat: NaN, lng: NaN }] },
    }, {} as any);

    const payload = JSON.parse(rawResult);
    expect(payload.route).toBeUndefined();
  });

  it("accepts the empty-marker call the geographic map directive prescribes", () => {
    // The directive tells the model to call render_map({ ..., markers: [] }) when
    // no location is known; with .min(1) that call failed validation every time.
    const schema = RENDER_TOOLS.render_map.parameters as any;
    expect(schema.safeParse({ title: "Live Map", markers: [] }).success).toBe(true);
    expect(schema.safeParse({ title: "Live Map" }).success).toBe(true);
  });

  it("recognizes type: 'map' payloads as rich artifacts", () => {
    const output = JSON.stringify({
      type: "map",
      title: "Direct Map Output",
      markers: [{ lat: 37.7749, lng: -122.4194, label: "SF Facility" }],
    });
    const artifact = detectArtifact("render_map", output);
    expect(artifact).not.toBeNull();
    expect(artifact?.payload.type).toBe("map");
  });
});

describe("CREW Core Tool Registration for Map & Geospatial Operations", () => {
  it("exposes render_map in universal presentation tools and artifact tools", () => {
    expect(UNIVERSAL_PRESENTATION_TOOLS).toContain("render_map");
    expect(ARTIFACT_TOOLS.has("render_map")).toBe(true);
  });

  it("exposes geocoding and geo_discovery in universal presentation tools and artifact tools", () => {
    expect(UNIVERSAL_PRESENTATION_TOOLS).toContain("geocoding");
    expect(UNIVERSAL_PRESENTATION_TOOLS).toContain("geo_discovery");
    expect(ARTIFACT_TOOLS.has("geocoding")).toBe(true);
    expect(ARTIFACT_TOOLS.has("geo_discovery")).toBe(true);
  });

  it("includes assistant_map and map in RICH_PAYLOAD_TYPES", () => {
    expect(RICH_PAYLOAD_TYPES.has("assistant_map")).toBe(true);
    expect(RICH_PAYLOAD_TYPES.has("map")).toBe(true);
  });
});
