import { describe, expect, it } from "vitest";
import {
  TRIP_INTAKE_FIELDS,
  TRIP_INTAKE_FORM_ID,
  TRIP_INTAKE_TITLE,
  tripIntakeToPlanPatch,
} from "../../server/blueprints/apps/wayfare/lib/trip-intake";

describe("Wayfare trip intake manifest", () => {
  it("mirrors forms.trip_intake_form from the cycle YAML", () => {
    expect(TRIP_INTAKE_FORM_ID).toBe("trip_intake_form");
    expect(TRIP_INTAKE_TITLE).toBe("Create Wayfare Road Trip");
    expect(TRIP_INTAKE_FIELDS.map((f) => f.key)).toEqual([
      "trip_name",
      "origin",
      "destination",
      "corridor_width",
      "max_drive_hours",
    ]);
    expect(TRIP_INTAKE_FIELDS.every((f) => f.required)).toBe(true);
  });

  it("maps a full crew-surface-request answer set onto the trip plan", () => {
    expect(
      tripIntakeToPlanPatch({
        trip_name: "  Denver to Boise  ",
        origin: "Denver, CO",
        destination: "Boise, ID",
        corridor_width: "25 miles",
        max_drive_hours: "8 hours",
      }),
    ).toEqual({
      name: "Denver to Boise",
      origin: "Denver, CO",
      destination: "Boise, ID",
      corridorMiles: 25,
      maxDriveHours: 8,
    });
  });

  it("accepts bare numbers for select-backed fields", () => {
    expect(
      tripIntakeToPlanPatch({ corridor_width: 10, max_drive_hours: 4 }),
    ).toEqual({ corridorMiles: 10, maxDriveHours: 4 });
  });

  it("drops empty, malformed and out-of-range answers instead of guessing", () => {
    expect(
      tripIntakeToPlanPatch({
        trip_name: "   ",
        origin: 42,
        destination: null,
        corridor_width: "500 miles",
        max_drive_hours: "0 hours",
        unexpected_key: "ignored",
      }),
    ).toEqual({});
  });
});
