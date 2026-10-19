import { ZodError, type ZodIssue } from "zod";

const LABELS: Record<string, string> = {
  name: "Trip name",
  origin: "Origin",
  destination: "Destination",
  originPoint: "Origin coordinates",
  destinationPoint: "Destination coordinates",
  maxDriveHours: "Daily driving limit",
  corridorMiles: "Discovery corridor",
  "ev.name": "EV name",
  "ev.usableBatteryKwh": "EV usable battery capacity",
  "ev.departurePercent": "EV departure charge",
  "ev.reservePercent": "EV minimum arrival reserve",
  "ev.baselineWhPerMile": "EV baseline consumption",
  "ev.consumptionIncreasePercent": "EV conservative consumption increase",
  "ev.maxChargeKw": "EV maximum charging power",
  "ev.chargePowerFactor": "EV average charging power factor",
  "ev.chargingEfficiency": "EV charging efficiency",
  "truck.name": "Truck / vehicle ID",
  "truck.tankGallons": "Truck tank capacity",
  "truck.departureGallons": "Truck fuel at departure",
  "truck.reserveGallons": "Truck fuel reserve",
  "truck.baselineMpg": "Truck baseline economy",
  "truck.deratingPercent": "Truck economy reduction",
  "truck.heightFeet": "Truck loaded height",
  "truck.widthFeet": "Truck loaded width",
  "truck.weightPounds": "Truck loaded gross weight",
  "truck.lengthFeet": "Truck overall length",
};

function label(path: Array<string | number>) {
  const fields = path[0] === "plan" ? path.slice(1) : path;
  const key = fields.join(".");
  if (LABELS[key]) return LABELS[key];
  if (fields[0] === "stops" && typeof fields[1] === "number")
    return `Stop ${fields[1] + 1}${fields[2] ? ` ${String(fields[2])}` : ""}`;
  return key || "Trip";
}

function message(issue: ZodIssue) {
  if (issue.code === "too_small" && issue.type === "string")
    return "is required";
  if (issue.code === "too_small" && issue.type === "number")
    return issue.minimum === 0 && !issue.inclusive
      ? "must be greater than 0"
      : `must be at least ${issue.minimum}`;
  if (issue.code === "too_big" && issue.type === "number")
    return `must be at most ${issue.maximum}`;
  if (issue.code === "invalid_type" && issue.expected === "number")
    return "must be a number";
  return issue.message.charAt(0).toLowerCase() + issue.message.slice(1);
}

/** One readable line per problem, naming the field as the form labels it. */
export function describeTripIssues(error: unknown): string[] {
  if (!(error instanceof ZodError))
    return [error instanceof Error ? error.message : "Trip validation failed."];
  const lines = error.issues.map((issue) =>
    issue.code === "custom"
      ? issue.message
      : `${label(issue.path)} ${message(issue)}.`,
  );
  return [...new Set(lines)];
}
