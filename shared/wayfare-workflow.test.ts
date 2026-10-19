import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  tripPlanSchema,
  pacing,
  tripGpx,
  fuelForecast,
  evForecast,
  mapboxTruckParameters,
} from "./wayfare-workflow";
const plan = () =>
  tripPlanSchema.parse({
    name: "Test & trip",
    origin: "A",
    destination: "B",
    maxDriveHours: 6,
    corridorMiles: 25,
    stops: [
      {
        id: randomUUID(),
        name: "A < B",
        notes: "test",
        latitude: 0,
        longitude: 0,
        driveMinutes: 400,
      },
    ],
  });
describe("Wayfare plan contract", () => {
  it("validates coordinate pairs, ranges and unique stops", () => {
    const p = plan();
    expect(tripPlanSchema.safeParse(p).success).toBe(true);
    expect(
      tripPlanSchema.safeParse({
        ...p,
        stops: [{ ...p.stops[0], longitude: null }],
      }).success,
    ).toBe(false);
    expect(
      tripPlanSchema.safeParse({ ...p, stops: [p.stops[0], p.stops[0]] })
        .success,
    ).toBe(false);
    expect(tripPlanSchema.safeParse({ ...p, maxDriveHours: 0 }).success).toBe(
      false,
    );
  });
  it("calculates lower bounds without inventing missing driving legs", () => {
    const p = plan();
    p.stops.push({ ...p.stops[0], id: randomUUID(), driveMinutes: null });
    expect(pacing(p)).toEqual({
      knownMinutes: 400,
      missingLegs: 1,
      minimumDays: 2,
    });
  });
  it("exports escaped actual coordinates including zero, never a fake track", () => {
    const gpx = tripGpx(plan());
    expect(gpx).toContain('lat="0" lon="0"');
    expect(gpx).toContain("A &lt; B");
    expect(gpx).toContain("Test &amp; trip");
    expect(gpx).not.toContain("<trk");
    expect(() => tripGpx({ ...plan(), stops: [] })).toThrow("coordinates");
  });
  it("keeps the vendored blueprint contract identical", () => {
    expect(
      readFileSync("server/blueprints/apps/wayfare/lib/workflow.ts", "utf8"),
    ).toBe(readFileSync("shared/wayfare-workflow.ts", "utf8"));
  });
});

// Commercial long-haul calculations use actual route legs and measured intervals.
describe("commercial fuel forecasts", () => {
  const truck = {
    name: "Test tractor",
    fuelType: "diesel" as const,
    tankGallons: 200,
    departureGallons: 100,
    reserveGallons: 20,
    baselineMpg: 5,
    deratingPercent: 0,
    heightFeet: 13.5,
    widthFeet: 8.5,
    weightPounds: 80000,
    lengthFeet: 70,
    hazmat: false,
  };
  const leg = (miles: number) => ({
    distanceMeters: miles * 1609.344,
    durationSeconds: 3600,
    coordinates: [
      [0, 0],
      [1, 1],
    ],
    warnings: [],
  });
  it("uses weighted consumption, not an average of MPG ratios", () => {
    const p = tripPlanSchema.parse({
      ...plan(),
      truck,
      fuelUsage: [
        {
          id: randomUUID(),
          date: "2026-10-15",
          miles: 100,
          gallons: 10,
          notes: "",
        },
        {
          id: randomUUID(),
          date: "2026-10-15",
          miles: 100,
          gallons: 20,
          notes: "",
        },
      ],
    });
    const result = fuelForecast(p, [leg(100)])!;
    expect(result.observedMpg).toBeCloseTo(200 / 30);
    expect(result.legs[0].usedGallons).toBeCloseTo(15);
    expect(result.usableRangeMiles).toBeCloseTo((80 * 200) / 30);
  });
  it("forecasts arrival before refuelling and flags impossible legs", () => {
    const p = tripPlanSchema.parse({
      ...plan(),
      truck: { ...truck, departureGallons: 30 },
      stops: [{ ...plan().stops[0], refuelGallons: 100 }],
    });
    const result = fuelForecast(p, [leg(200), leg(100)])!;
    expect(result.legs[0].arrivalGallons).toBeCloseTo(-10);
    expect(result.legs[0].unreachable).toBe(true);
    expect(result.feasible).toBe(false);
  });
  it("applies reserve, conservative reduction and tank capacity", () => {
    const p = tripPlanSchema.parse({
      ...plan(),
      truck: { ...truck, deratingPercent: 20 },
      stops: [{ ...plan().stops[0], refuelGallons: 200 }],
    });
    const result = fuelForecast(p, [leg(100)])!;
    expect(result.mpg).toBe(4);
    expect(result.legs[0].overfill).toBe(true);
    expect(result.legs[0].departureGallons).toBe(200);
    expect(result.feasible).toBe(false);
  });
  it("converts imperial truck dimensions to Mapbox SI values", () => {
    const result = mapboxTruckParameters(
      tripPlanSchema.parse({ ...plan(), truck }),
    );
    expect(Number(result.max_height)).toBeCloseTo(4.1148);
    expect(Number(result.max_width)).toBeCloseTo(2.5908);
    expect(Number(result.max_weight)).toBeCloseTo(36.2873896);
  });
  it("rejects invalid capacity, dates and duplicate measured intervals", () => {
    const sample = {
      id: randomUUID(),
      date: "2026-10-15",
      miles: 100,
      gallons: 10,
      notes: "",
    };
    expect(
      tripPlanSchema.safeParse({
        ...plan(),
        truck: { ...truck, departureGallons: 201 },
      }).success,
    ).toBe(false);
    expect(
      tripPlanSchema.safeParse({ ...plan(), fuelUsage: [sample, sample] })
        .success,
    ).toBe(false);
    expect(
      tripPlanSchema.safeParse({
        ...plan(),
        fuelUsage: [{ ...sample, date: "2026-99-99" }],
      }).success,
    ).toBe(false);
  });
});

describe("cross-country EV forecasts", () => {
  const ev = {
    name: "Test EV",
    vehicleClass: "passenger" as const,
    usableBatteryKwh: 100,
    departurePercent: 80,
    reservePercent: 10,
    baselineWhPerMile: 250,
    consumptionIncreasePercent: 0,
    maxChargeKw: 150,
    chargePowerFactor: 0.8,
    chargingEfficiency: 0.9,
    connector: "SAE_J3400" as const,
  };
  const leg = (miles: number) => ({
    distanceMeters: miles * 1609.344,
    durationSeconds: 3600,
    coordinates: [
      [0, 0],
      [1, 1],
    ],
    warnings: [],
  });
  it("forecasts per-leg SOC, compatible charging and bounded charging power", () => {
    const p = tripPlanSchema.parse({
      ...plan(),
      ev,
      stops: [
        {
          ...plan().stops[0],
          chargeKwh: 20,
          chargerKw: 350,
          connector: "SAE_J3400",
          chargingConfirmed: true,
        },
      ],
    });
    const result = evForecast(p, [leg(200), leg(100)])!;
    expect(result.usableRangeMiles).toBeCloseTo(280);
    expect(result.legs[0].arrivalPercent).toBeCloseTo(30);
    expect(result.legs[0].departurePercent).toBeCloseTo(50);
    expect(result.legs[0].chargeMinutes).toBeCloseTo(
      (20 / (150 * 0.8 * 0.9)) * 60,
    );
    expect(result.legs[1].arrivalPercent).toBeCloseTo(25);
    expect(result.energyFeasible).toBe(true);
    expect(result.chargingVerified).toBe(true);
    expect(fuelForecast(p, [leg(100)])).toBeNull();
  });
  it("uses weighted measured energy and an explicit conservative increase", () => {
    const p = tripPlanSchema.parse({
      ...plan(),
      ev: { ...ev, consumptionIncreasePercent: 20 },
      energyUsage: [
        {
          id: randomUUID(),
          date: "2026-10-15",
          miles: 100,
          kwh: 20,
          notes: "",
        },
        {
          id: randomUUID(),
          date: "2026-10-15",
          miles: 300,
          kwh: 100,
          notes: "",
        },
      ],
    });
    const result = evForecast(p, [leg(100)])!;
    expect(result.observedWhPerMile).toBeCloseTo(300);
    expect(result.whPerMile).toBeCloseTo(360);
    expect(result.totalKwh).toBeCloseTo(36);
  });
  it("flags unreachable legs, below-reserve arrivals, overcharge and unverified connectors", () => {
    const p = tripPlanSchema.parse({
      ...plan(),
      ev,
      stops: [
        {
          ...plan().stops[0],
          chargeKwh: 100,
          chargerKw: 50,
          connector: "CHADEMO",
          chargingConfirmed: true,
        },
      ],
    });
    const result = evForecast(p, [leg(300), leg(100)])!;
    expect(result.legs[0].belowReserve).toBe(true);
    expect(result.legs[0].overfill).toBe(true);
    expect(result.chargingVerified).toBe(false);
    expect(result.energyFeasible).toBe(false);
    expect(evForecast(p, [leg(400)])!.legs[0].unreachable).toBe(true);
  });
  it("does not apply truck restrictions to passenger EVs", () => {
    const p = tripPlanSchema.parse({ ...plan(), ev });
    expect(mapboxTruckParameters(p)).toEqual({});
    expect(
      tripPlanSchema.safeParse({
        ...p,
        ev: { ...ev, vehicleClass: "commercial_truck" },
      }).success,
    ).toBe(false);
  });
});
