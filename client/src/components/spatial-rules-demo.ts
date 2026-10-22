import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

export const SERVICE_CENTER = latLngToCell(34.0522, -118.2437, 8);
export const SERVICE_CELLS = gridDisk(SERVICE_CENTER, 2);
export const RESTRICTED_CELL = gridDisk(SERVICE_CENTER, 1).find(cell => cell !== SERVICE_CENTER)!;
export const DEMO_REQUESTS = [
  { id: "REQ-101", label: "Inside service area", cell: SERVICE_CENTER },
  { id: "REQ-102", label: "Inside restricted zone", cell: RESTRICTED_CELL },
  { id: "REQ-103", label: "Outside coverage", cell: gridDisk(SERVICE_CENTER, 4).find(cell => !gridDisk(SERVICE_CENTER, 3).includes(cell))! },
].map(request => ({ ...request, coordinates: cellToLatLng(request.cell) }));

/** A client-only sample policy, not a production dispatch decision. Deny wins. */
export function evaluateDemoLocation(cell: string) {
  const inServiceArea = SERVICE_CELLS.includes(cell);
  const inRestrictedZone = cell === RESTRICTED_CELL;
  return { inServiceArea, inRestrictedZone, eligible: inServiceArea && !inRestrictedZone };
}
