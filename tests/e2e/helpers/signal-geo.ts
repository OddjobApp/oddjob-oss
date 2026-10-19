import {
  cellToLatLng,
  gridDisk,
  gridPathCells,
  greatCircleDistance,
  latLngToCell,
  UNITS,
} from "h3-js";

/**
 * Geography shared by the spatial-signal specs.
 *
 * Real places at a real resolution, so the cell sets are stable across runs and
 * a failure can be reasoned about on a map rather than in hex indices. Res 7 is
 * what the platform indexes observations at, and a zone declared at a different
 * resolution would be silently re-derived from its cells — see `resolveZone`,
 * which trusts the cells over the declared resolution.
 *
 * Scale matters for writing correct assertions here: a Res-7 cell has an edge
 * of roughly 1.22 km (about 5 km² of AREA — easy to misread as a 5 km radius).
 * So a k-ring of 3 reaches only ~5.5 km, and the engine's precision tolerance
 * for a zone is `edge * sqrt(cellCount) * 2` — about 14.8 km for a 37-cell
 * zone, not the tens of kilometres a "5 km cell" reading would suggest.
 */
export const H3_RES = 7;

/** Nominal Res-7 edge length in km; the engine uses the same table. */
export const RES7_EDGE_KM = 1.22;

export interface TestZone {
  name: string;
  centerLat: number;
  centerLng: number;
  /** Ring count used to build the disk. */
  k: number;
  cells: string[];
}

function disk(name: string, centerLat: number, centerLng: number, k: number): TestZone {
  const origin = latLngToCell(centerLat, centerLng, H3_RES);
  return { name, centerLat, centerLng, k, cells: gridDisk(origin, k) };
}

/** Port of Rotterdam. Small enough that a coarse fix must not satisfy it. */
export const ZONE_ROTTERDAM = disk("Port of Rotterdam", 51.9496, 4.1453, 2);

/** Strait of Hormuz. Larger extent, used for the precision-tolerance boundary. */
export const ZONE_HORMUZ = disk("Strait of Hormuz", 26.5667, 56.25, 3);

/**
 * A narrow approach lane into Rotterdam, as an explicit cell list rather than a
 * disk — this is the shape the map palette emits, and the one `intersects`
 * trajectory tests are meaningful against.
 */
export const CORRIDOR_NS: TestZone = (() => {
  const south = latLngToCell(51.75, 3.85, H3_RES);
  const north = latLngToCell(52.15, 4.45, H3_RES);
  const cells = gridPathCells(south, north);
  const [centerLat, centerLng] = cellToLatLng(cells[Math.floor(cells.length / 2)]);
  return { name: "North-South Approach Corridor", centerLat, centerLng, k: 0, cells };
})();

/**
 * A point `distanceKm` from an origin along a bearing.
 *
 * Scenario 9 needs positions at chosen distances from a geofence perimeter
 * (outside the approach buffer, inside it, inside the zone). Hand-picked
 * coordinates would drift out of correctness the moment a zone moved; deriving
 * them keeps the intent — "6 km out" — in the test.
 */
export function pointAtBearing(
  lat: number,
  lng: number,
  bearingDegrees: number,
  distanceKm: number,
): { latitude: number; longitude: number } {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const angular = distanceKm / R;
  const bearing = toRad(bearingDegrees);
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { latitude: toDeg(lat2), longitude: ((toDeg(lng2) + 540) % 360) - 180 };
}

/**
 * A position that is genuinely outside a zone's cell set, at least
 * `minDistanceKm` from its centre.
 *
 * Walks outward along a bearing until the containing cell is not in the zone.
 * Picking a "clearly outside" coordinate by eye is how a test ends up asserting
 * `not_there` against a point that is actually one cell in.
 */
export function pointOutside(zone: TestZone, bearingDegrees = 90, minDistanceKm = 30): {
  latitude: number;
  longitude: number;
} {
  const cells = new Set(zone.cells);
  for (let km = minDistanceKm; km <= minDistanceKm + 200; km += 5) {
    const p = pointAtBearing(zone.centerLat, zone.centerLng, bearingDegrees, km);
    if (!cells.has(latLngToCell(p.latitude, p.longitude, H3_RES))) return p;
  }
  throw new Error(`Could not find a point outside ${zone.name}`);
}

/** The centre of a zone, as a position inside it. */
export function pointInside(zone: TestZone): { latitude: number; longitude: number } {
  return { latitude: zone.centerLat, longitude: zone.centerLng };
}

/** Great-circle km between two positions — for asserting on reported distances. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  return greatCircleDistance([a.latitude, a.longitude], [b.latitude, b.longitude], UNITS.km);
}

/** The Res-7 cell a position falls in. */
export function cellFor(p: { latitude: number; longitude: number }): string {
  return latLngToCell(p.latitude, p.longitude, H3_RES);
}
