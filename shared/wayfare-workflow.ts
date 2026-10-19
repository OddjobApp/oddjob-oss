import { z } from "zod";

export interface TruckProfile {
  name: string;
  fuelType: "diesel" | "gasoline";
  tankGallons: number;
  departureGallons: number;
  reserveGallons: number;
  baselineMpg: number;
  deratingPercent: number;
  heightFeet: number;
  widthFeet: number;
  weightPounds: number;
  lengthFeet: number;
  hazmat: boolean;
}
export interface EVProfile {
  name: string;
  vehicleClass: "passenger" | "commercial_truck";
  usableBatteryKwh: number;
  departurePercent: number;
  reservePercent: number;
  baselineWhPerMile: number;
  consumptionIncreasePercent: number;
  maxChargeKw: number;
  chargePowerFactor: number;
  chargingEfficiency: number;
  connector:
    | "SAE_J3400"
    | "IEC_62196_T1_COMBO"
    | "IEC_62196_T2_COMBO"
    | "CHADEMO"
    | "MCS"
    | "TESLA_S";
}
export interface TripStop {
  id: string;
  name: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  driveMinutes: number | null;
  refuelGallons: number;
  chargeKwh: number;
  chargerKw: number;
  connector: string;
  chargingConfirmed: boolean;
}
export interface TripPlan {
  name: string;
  origin: string;
  destination: string;
  originPoint: { latitude: number; longitude: number } | null;
  destinationPoint: { latitude: number; longitude: number } | null;
  truck: TruckProfile | null;
  ev: EVProfile | null;
  fuelUsage: Array<{
    id: string;
    date: string;
    miles: number;
    gallons: number;
    notes: string;
  }>;
  energyUsage: Array<{
    id: string;
    date: string;
    miles: number;
    kwh: number;
    notes: string;
  }>;
  maxDriveHours: number;
  corridorMiles: number;
  stops: TripStop[];
}
export interface TripCommand {
  requestId: string;
  tripId: string;
  expectedVersion: number;
  plan: TripPlan;
}

export const WAYFARE_COLLECTION = "wayfare_trips";
export const WAYFARE_JOURNEY_COLLECTION = "wayfare_journey_receipts";
const text = (max: number) => z.string().trim().min(1).max(max);
const point = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();
export const evSchema = z
  .object({
    name: text(100),
    vehicleClass: z.enum(["passenger", "commercial_truck"]),
    usableBatteryKwh: z.number().positive().max(2000),
    departurePercent: z.number().min(0).max(100),
    reservePercent: z.number().min(0).max(99),
    baselineWhPerMile: z.number().positive().max(10000),
    consumptionIncreasePercent: z.number().min(0).max(100),
    maxChargeKw: z.number().positive().max(3000),
    chargePowerFactor: z.number().min(0.1).max(1),
    chargingEfficiency: z.number().min(0.5).max(1),
    connector: z.enum([
      "SAE_J3400",
      "IEC_62196_T1_COMBO",
      "IEC_62196_T2_COMBO",
      "CHADEMO",
      "MCS",
      "TESLA_S",
    ]),
  })
  .strict()
  .refine(
    (v) => v.departurePercent >= v.reservePercent,
    "Departure charge must be at least the reserve.",
  );
export const truckSchema = z
  .object({
    name: text(100),
    fuelType: z.enum(["diesel", "gasoline"]),
    tankGallons: z.number().min(0).max(1000),
    departureGallons: z.number().min(0).max(1000),
    reserveGallons: z.number().min(0).max(1000),
    baselineMpg: z.number().min(0).max(100),
    deratingPercent: z.number().min(0).max(75),
    heightFeet: z.number().positive().max(32.8),
    widthFeet: z.number().positive().max(32.8),
    weightPounds: z.number().positive().max(220462),
    lengthFeet: z.number().positive().max(150),
    hazmat: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.departureGallons <= v.tankGallons &&
      (v.reserveGallons < v.tankGallons ||
        (v.tankGallons === 0 && v.reserveGallons === 0)),
    "Departure fuel and reserve must fit within tank capacity.",
  );
export const tripPlanSchema: z.ZodType<TripPlan, z.ZodTypeDef, unknown> = z
  .object({
    name: text(160),
    origin: text(300),
    destination: text(300),
    originPoint: point.nullable().default(null),
    destinationPoint: point.nullable().default(null),
    truck: truckSchema.nullable().default(null),
    ev: evSchema.nullable().default(null),
    energyUsage: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            date: z.string().date(),
            miles: z.number().positive().max(100000),
            kwh: z.number().positive().max(100000),
            notes: z.string().max(500),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    fuelUsage: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            date: z.string().date(),
            miles: z.number().positive().max(100000),
            gallons: z.number().positive().max(10000),
            notes: z.string().max(500),
          })
          .strict()
          .refine(
            (r) => r.miles / r.gallons <= 100,
            "Measured economy exceeds 100 MPG; check miles and US gallons.",
          ),
      )
      .max(200)
      .default([]),
    maxDriveHours: z.number().min(1).max(12),
    corridorMiles: z.number().min(1).max(100),
    stops: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: text(200),
            notes: z.string().max(2000),
            latitude: z.number().min(-90).max(90).nullable(),
            longitude: z.number().min(-180).max(180).nullable(),
            driveMinutes: z.number().min(0).max(10080).nullable(),
            refuelGallons: z.number().min(0).max(1000).default(0),
            chargeKwh: z.number().min(0).max(2000).default(0),
            chargerKw: z.number().min(0).max(3000).default(0),
            connector: z.string().max(60).default(""),
            chargingConfirmed: z.boolean().default(false),
          })
          .strict()
          .refine(
            (s) => (s.latitude === null) === (s.longitude === null),
            "Provide both coordinates or neither.",
          ),
      )
      .max(100),
  })
  .strict()
  .refine(
    (p) => new Set(p.stops.map((s) => s.id)).size === p.stops.length,
    "Stop IDs must be unique.",
  )
  .refine(
    (p) => new Set(p.fuelUsage.map((s) => s.id)).size === p.fuelUsage.length,
    "Fuel-use record IDs must be unique.",
  )
  .refine(
    (p) =>
      new Set(p.energyUsage.map((s) => s.id)).size === p.energyUsage.length,
    "Energy-use record IDs must be unique.",
  )
  .refine(
    (p) => !p.ev || p.ev.vehicleClass !== "commercial_truck" || !!p.truck,
    "Electric trucks also require loaded truck dimensions.",
  )
  .refine(
    (p) =>
      !!p.ev ||
      !p.truck ||
      (p.truck.tankGallons > 0 && p.truck.baselineMpg > 0),
    "Combustion planning requires positive tank capacity and baseline MPG.",
  );
export const tripCommandSchema = z
  .object({
    requestId: z.string().uuid(),
    tripId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
    plan: tripPlanSchema,
  })
  .strict();

export interface WayfareTrip {
  id: string;
  roomKey: string;
  version: number;
  plan: TripPlan;
  updatedAt: string;
  receipts: Array<{ requestId: string; fingerprint: string }>;
}
export interface JourneyLeg {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: number[][];
  warnings: string[];
}
export interface Journey {
  receiptId?: string;
  legs: JourneyLeg[];
  calculatedAt: string;
  profile: "mapbox/driving";
  planVersion: number;
}
export function fuelForecast(plan: TripPlan, legs: JourneyLeg[]) {
  if (!plan.truck || plan.ev) return null;
  const truck = plan.truck,
    measuredMiles = plan.fuelUsage.reduce((s, r) => s + r.miles, 0),
    measuredGallons = plan.fuelUsage.reduce((s, r) => s + r.gallons, 0);
  const observedMpg =
    measuredGallons > 0 ? measuredMiles / measuredGallons : null;
  const mpg =
    (observedMpg ?? truck.baselineMpg) * (1 - truck.deratingPercent / 100);
  let remaining = truck.departureGallons;
  let feasible = true;
  const forecast = legs.map((leg, index) => {
    const miles = leg.distanceMeters / 1609.344,
      used = miles / mpg,
      arrival = remaining - used;
    const belowReserve = arrival < truck.reserveGallons,
      unreachable = arrival < 0;
    if (unreachable) feasible = false;
    const refuel = plan.stops[index]?.refuelGallons ?? 0,
      overfill = arrival + refuel > truck.tankGallons;
    if (overfill) feasible = false;
    remaining = Math.min(truck.tankGallons, arrival + refuel);
    return {
      index,
      miles,
      usedGallons: used,
      arrivalGallons: arrival,
      departureGallons: remaining,
      belowReserve,
      unreachable,
      overfill,
      refuelGallons: refuel,
    };
  });
  return {
    mpg,
    observedMpg,
    source: observedMpg === null ? "configured" : "measured",
    usableRangeMiles:
      Math.max(0, truck.departureGallons - truck.reserveGallons) * mpg,
    totalGallons: forecast.reduce((s, l) => s + l.usedGallons, 0),
    feasible,
    legs: forecast,
  };
}
export function mapboxTruckParameters(plan: TripPlan): Record<string, string> {
  if (plan.ev?.vehicleClass === "passenger") return {};
  if (!plan.truck) throw new Error("Truck profile required.");
  return {
    max_height: String(plan.truck.heightFeet * 0.3048),
    max_width: String(plan.truck.widthFeet * 0.3048),
    max_weight: String(plan.truck.weightPounds * 0.00045359237),
  };
}
export function evForecast(plan: TripPlan, legs: JourneyLeg[]) {
  if (!plan.ev) return null;
  const ev = plan.ev,
    totalMiles = plan.energyUsage.reduce((s, r) => s + r.miles, 0),
    totalKwh = plan.energyUsage.reduce((s, r) => s + r.kwh, 0);
  const observedWhPerMile =
    totalMiles > 0 ? (totalKwh * 1000) / totalMiles : null;
  const whPerMile =
      (observedWhPerMile ?? ev.baselineWhPerMile) *
      (1 + ev.consumptionIncreasePercent / 100),
    reserveKwh = (ev.usableBatteryKwh * ev.reservePercent) / 100;
  let remaining = (ev.usableBatteryKwh * ev.departurePercent) / 100;
  const forecast = legs.map((leg, index) => {
    const usedKwh = ((leg.distanceMeters / 1609.344) * whPerMile) / 1000,
      arrivalKwh = remaining - usedKwh,
      stop = plan.stops[index],
      added = stop?.chargeKwh ?? 0,
      effectiveKw =
        Math.min(stop?.chargerKw ?? 0, ev.maxChargeKw) *
        ev.chargePowerFactor *
        ev.chargingEfficiency;
    const overfill = arrivalKwh + added > ev.usableBatteryKwh,
      compatible =
        added === 0 ||
        (!!stop?.chargingConfirmed &&
          stop.connector === ev.connector &&
          effectiveKw > 0);
    remaining = Math.min(ev.usableBatteryKwh, arrivalKwh + added);
    return {
      index,
      usedKwh,
      arrivalKwh,
      arrivalPercent: (arrivalKwh / ev.usableBatteryKwh) * 100,
      departurePercent: (remaining / ev.usableBatteryKwh) * 100,
      addedKwh: added,
      chargeMinutes:
        added === 0 ? 0 : effectiveKw > 0 ? (added / effectiveKw) * 60 : null,
      belowReserve: arrivalKwh < reserveKwh,
      unreachable: arrivalKwh < 0,
      overfill,
      compatible,
      extraEnergyBeforeLegKwh: Math.max(0, reserveKwh - arrivalKwh),
    };
  });
  return {
    whPerMile,
    observedWhPerMile,
    usableRangeMiles:
      (Math.max(
        0,
        (ev.usableBatteryKwh * ev.departurePercent) / 100 - reserveKwh,
      ) *
        1000) /
      whPerMile,
    totalKwh: forecast.reduce((s, l) => s + l.usedKwh, 0),
    chargeMinutes: forecast.some((l) => l.chargeMinutes === null)
      ? null
      : forecast.reduce((s, l) => s + (l.chargeMinutes ?? 0), 0),
    energyFeasible: forecast.every((l) => !l.unreachable && !l.overfill),
    chargingVerified: forecast.every((l) => l.compatible),
    legs: forecast,
  };
}
export function pacing(plan: TripPlan) {
  const known = plan.stops.reduce((sum, s) => sum + (s.driveMinutes ?? 0), 0);
  return {
    knownMinutes: known,
    missingLegs: plan.stops.filter((s) => s.driveMinutes === null).length,
    minimumDays:
      known > 0 ? Math.ceil(known / (plan.maxDriveHours * 60)) : null,
  };
}
const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function tripGpx(plan: TripPlan) {
  const points = [
    ...(plan.originPoint
      ? [{ ...plan.originPoint, name: plan.origin, notes: "Journey origin" }]
      : []),
    ...plan.stops.filter((s) => s.latitude !== null && s.longitude !== null),
    ...(plan.destinationPoint
      ? [
          {
            ...plan.destinationPoint,
            name: plan.destination,
            notes: "Journey destination",
          },
        ]
      : []),
  ];
  if (!points.length)
    throw new Error(
      "Add coordinates to at least one stop before exporting GPX.",
    );
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Wayfare" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(plan.name)}</name><desc>Ordered waypoints only; not a verified driving route.</desc></metadata>${points.map((s) => `<wpt lat="${s.latitude}" lon="${s.longitude}"><name>${xml(s.name)}</name><desc>${xml(s.notes)}</desc></wpt>`).join("")}</gpx>`;
}
