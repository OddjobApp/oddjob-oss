/** @vitest-environment node */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { tripPlanSchema } from "@shared/wayfare-workflow";
const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  list: vi.fn(),
  credential: vi.fn(),
  secret: vi.fn(),
  rows: vi.fn(),
}));
vi.mock("@server/database_service.js", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.rows }) }) },
}));
vi.mock("./wayfare-trips.service.js", () => ({
  requireWayfareRoom: mocks.scope,
  listWayfareTrips: mocks.list,
  recordWayfareJourney: vi.fn().mockResolvedValue("test-receipt"),
}));
vi.mock("../../auth/core/credentials-service.js", () => ({
  credentialsService: { getForExecution: mocks.credential },
}));
vi.mock("../../auth/core/credential-secret-store.js", () => ({
  resolveCredentialSecret: mocks.secret,
}));
import {
  calculateWayfareRoute,
  geocodeWayfare,
  mapboxBrowserToken,
} from "./wayfare-mapbox.service";
const actor = { appId: 1, orgId: 7, deploymentId: 2 };
const plan = () =>
  tripPlanSchema.parse({
    name: "Test",
    origin: "A",
    destination: "B",
    originPoint: { longitude: -118, latitude: 34 },
    destinationPoint: { longitude: -121, latitude: 38 },
    maxDriveHours: 8,
    corridorMiles: 25,
    stops: [],
    truck: {
      name: "Test",
      fuelType: "diesel",
      tankGallons: 200,
      departureGallons: 100,
      reserveGallons: 20,
      baselineMpg: 6,
      deratingPercent: 10,
      heightFeet: 13.5,
      widthFeet: 8.5,
      weightPounds: 80000,
      lengthFeet: 70,
      hazmat: false,
    },
  });
describe("Mapbox governed truck routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue("room");
    mocks.rows.mockResolvedValue([{ id: 307, name: "Mapbox" }]);
    mocks.credential.mockResolvedValue({ organizationId: 7 });
    mocks.secret.mockResolvedValue("pk.test-only");
    mocks.list.mockResolvedValue({
      items: [{ id: "trip", version: 1, plan: plan() }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              legs: [
                {
                  distance: 1000,
                  duration: 100,
                  steps: [
                    {
                      geometry: {
                        coordinates: [
                          [-118, 34],
                          [-121, 38],
                        ],
                      },
                    },
                  ],
                  notifications: [
                    { details: { message: "Test restriction warning" } },
                  ],
                },
              ],
            },
          ],
        }),
      }),
    );
  });
  it("requests real geometry and converts loaded truck restrictions to SI units", async () => {
    const result = await calculateWayfareRoute(actor, "room", {
      tripId: "trip",
      version: 1,
      credentialId: 307,
    });
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.pathname).toContain("-118,34;-121,38");
    expect(Number(url.searchParams.get("max_height"))).toBeCloseTo(4.1148);
    expect(Number(url.searchParams.get("max_weight"))).toBeCloseTo(36.2874, 3);
    expect(result.legs[0].warnings).toEqual(["Test restriction warning"]);
    expect(result.legs[0].coordinates).toHaveLength(2);
    expect(mocks.credential).toHaveBeenCalledWith(307, 7);
  });
  it("does not return secret tokens or credentials from another organization", async () => {
    mocks.secret.mockResolvedValue("sk.test-only");
    await expect(mapboxBrowserToken(actor, "room", 307)).rejects.toThrow(
      "public browser",
    );
    mocks.credential.mockResolvedValue({ organizationId: 8 });
    await expect(mapboxBrowserToken(actor, "room", 307)).rejects.toThrow(
      "unavailable",
    );
  });
  it("rejects stale revisions and missing coordinates before requesting directions", async () => {
    await expect(
      calculateWayfareRoute(actor, "room", {
        tripId: "trip",
        version: 2,
        credentialId: 307,
      }),
    ).rejects.toThrow("revision changed");
    mocks.list.mockResolvedValue({
      items: [
        { id: "trip", version: 1, plan: { ...plan(), originPoint: null } },
      ],
    });
    await expect(
      calculateWayfareRoute(actor, "room", {
        tripId: "trip",
        version: 1,
        credentialId: 307,
      }),
    ).rejects.toThrow("coordinates");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not invent a route on provider rejection or incomplete legs", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429 } as Response);
    await expect(
      calculateWayfareRoute(actor, "room", {
        tripId: "trip",
        version: 1,
        credentialId: 307,
      }),
    ).rejects.toThrow("429");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{ legs: [{ distance: 100, duration: 10, steps: [] }] }],
      }),
    } as Response);
    await expect(
      calculateWayfareRoute(actor, "room", {
        tripId: "trip",
        version: 1,
        credentialId: 307,
      }),
    ).rejects.toThrow("incomplete");
  });

  it("preserves all legs across cross-country waypoint batches", async () => {
    const p = plan();
    p.stops = Array.from({ length: 50 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Stop ${i}`,
      notes: "",
      latitude: 35 + i * 0.01,
      longitude: -118 + i * 0.01,
      driveMinutes: null,
      refuelGallons: 0,
      chargeKwh: 0,
      chargerKw: 0,
      connector: "",
      chargingConfirmed: false,
    }));
    mocks.list.mockResolvedValue({
      items: [{ id: "trip", version: 1, plan: p }],
    });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const count =
        new URL(String(input)).pathname.split("/").at(-1)!.split(";").length -
        1;
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              legs: Array.from({ length: count }, () => ({
                distance: 1000,
                duration: 100,
                steps: [
                  {
                    geometry: {
                      coordinates: [
                        [0, 0],
                        [1, 1],
                      ],
                    },
                  },
                ],
              })),
            },
          ],
        }),
      } as Response;
    });
    const result = await calculateWayfareRoute(actor, "room", {
      tripId: "trip",
      version: 1,
      credentialId: 307,
    });
    expect(result.legs).toHaveLength(51);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("Mapbox place search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue("room");
    mocks.rows.mockResolvedValue([{ id: 307, name: "Mapbox" }]);
    mocks.credential.mockResolvedValue({ organizationId: 7 });
    mocks.secret.mockResolvedValue("pk.test-only");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              geometry: { coordinates: [-118.24, 34.05] },
              properties: {
                full_address: "Los Angeles, California, United States",
                place_formatted: "California, United States",
              },
            },
          ],
        }),
      }),
    );
  });
  it("suggests with temporary geocoding biased toward the other endpoint", async () => {
    const result = await geocodeWayfare(actor, "room", {
      credentialId: 307,
      query: "Los Ang",
      mode: "suggest",
      proximity: { latitude: 40.7, longitude: -74 },
    });
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get("permanent")).toBe("false");
    expect(url.searchParams.get("autocomplete")).toBe("true");
    expect(url.searchParams.get("proximity")).toBe("-74,40.7");
    expect(result.permanent).toBe(false);
    expect(result.items[0]).toMatchObject({
      name: "Los Angeles, California, United States",
      context: "California, United States",
      latitude: 34.05,
      longitude: -118.24,
    });
  });
  it("resolves a chosen place with permanent geocoding", async () => {
    const result = await geocodeWayfare(actor, "room", {
      credentialId: 307,
      query: "Los Angeles, California, United States",
    });
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get("permanent")).toBe("true");
    expect(url.searchParams.get("autocomplete")).toBe("false");
    expect(url.searchParams.has("proximity")).toBe(false);
    expect(result.permanent).toBe(true);
  });
});
