import type { CrewInputField } from "./crew-sdk";
import type { TripPlan } from "./workflow";

/**
 * Trip intake requirements — the vendored copy of `forms.trip_intake_form` in
 * server/cycles/wayfare.cycle.yaml, which `provisionDynamicForms` installs as
 * the organization's "Create Wayfare Road Trip" hil_forms template.
 *
 * Keep field keys, labels and options identical to the manifest entry: the
 * same declaration drives the provisioned form that room agents discover via
 * list_hil_forms and the crew-surface-request card this app raises through
 * requestCrewInput. The answers map onto TripPlan via tripIntakeToPlanPatch.
 */
export const TRIP_INTAKE_FORM_ID = "trip_intake_form";
export const TRIP_INTAKE_TITLE = "Create Wayfare Road Trip";

export const TRIP_INTAKE_FIELDS: CrewInputField[] = [
    { key: "trip_name", label: "Trip Name", type: "text", required: true },
    { key: "origin", label: "Starting City/Point", type: "text", required: true },
    { key: "destination", label: "Destination City/Point", type: "text", required: true },
    {
        key: "corridor_width",
        label: "Discovery Corridor Width (Miles)",
        type: "select",
        required: true,
        options: ["5 miles", "10 miles", "25 miles", "50 miles"],
    },
    {
        key: "max_drive_hours",
        label: "Max Daily Driving Hours",
        type: "select",
        required: true,
        options: ["4 hours", "6 hours", "8 hours", "10 hours"],
    },
];

function text(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** Select answers arrive as their option label ("25 miles") — take the number. */
function leadingNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
}

/**
 * Map crew-surface-request answers onto the TripPlan fields the intake form
 * owns. Unknown or malformed answers are dropped rather than guessed — the
 * trip schema validates the merged plan again before save.
 */
export function tripIntakeToPlanPatch(data: Record<string, unknown>): Partial<TripPlan> {
    const patch: Partial<TripPlan> = {};
    const name = text(data.trip_name, 160);
    if (name) patch.name = name;
    const origin = text(data.origin, 300);
    if (origin) patch.origin = origin;
    const destination = text(data.destination, 300);
    if (destination) patch.destination = destination;
    const corridorMiles = leadingNumber(data.corridor_width);
    if (corridorMiles !== null && corridorMiles >= 1 && corridorMiles <= 100) patch.corridorMiles = corridorMiles;
    const maxDriveHours = leadingNumber(data.max_drive_hours);
    if (maxDriveHours !== null && maxDriveHours >= 1 && maxDriveHours <= 12) patch.maxDriveHours = maxDriveHours;
    return patch;
}
