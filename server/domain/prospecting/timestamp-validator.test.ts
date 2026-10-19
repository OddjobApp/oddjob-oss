import { describe, it, expect } from "vitest";
import { parseAndValidateEventTimestamp, MAX_FUTURE_SKEW_MS, MIN_VALID_TIMESTAMP_MS } from "./timestamp-validator.js";

describe("parseAndValidateEventTimestamp", () => {
  const NOW = new Date("2026-08-13T12:00:00.000Z");

  it("returns fallback server time when input is missing or empty", () => {
    expect(parseAndValidateEventTimestamp(undefined, NOW)).toEqual(NOW);
    expect(parseAndValidateEventTimestamp(null, NOW)).toEqual(NOW);
    expect(parseAndValidateEventTimestamp("", NOW)).toEqual(NOW);
  });

  it("parses valid Date objects", () => {
    const past = new Date("2026-08-13T11:30:00.000Z");
    expect(parseAndValidateEventTimestamp(past, NOW)).toEqual(past);
  });

  it("parses valid ISO timestamp strings", () => {
    const isoString = "2026-08-13T11:45:00.000Z";
    expect(parseAndValidateEventTimestamp(isoString, NOW)).toEqual(new Date(isoString));
  });

  it("parses epoch milliseconds (number and numeric string)", () => {
    const epochMs = new Date("2026-08-13T11:00:00.000Z").getTime();
    expect(parseAndValidateEventTimestamp(epochMs, NOW)).toEqual(new Date(epochMs));
    expect(parseAndValidateEventTimestamp(String(epochMs), NOW)).toEqual(new Date(epochMs));
  });

  it("parses epoch seconds (number and numeric string)", () => {
    const epochSec = Math.floor(new Date("2026-08-13T11:00:00.000Z").getTime() / 1000);
    expect(parseAndValidateEventTimestamp(epochSec, NOW)).toEqual(new Date(epochSec * 1000));
    expect(parseAndValidateEventTimestamp(String(epochSec), NOW)).toEqual(new Date(epochSec * 1000));
  });

  it("falls back to server time for invalid date strings and non-finite numbers", () => {
    expect(parseAndValidateEventTimestamp("not-a-date", NOW)).toEqual(NOW);
    expect(parseAndValidateEventTimestamp(NaN, NOW)).toEqual(NOW);
    expect(parseAndValidateEventTimestamp(Infinity, NOW)).toEqual(NOW);
    expect(parseAndValidateEventTimestamp({}, NOW)).toEqual(NOW);
  });

  it("falls back to server time for negative or pre-2000 timestamps (Epoch 0)", () => {
    expect(parseAndValidateEventTimestamp(0, NOW)).toEqual(NOW);
    expect(parseAndValidateEventTimestamp(-1000, NOW)).toEqual(NOW);
    expect(parseAndValidateEventTimestamp(new Date("1999-12-31T23:59:59Z"), NOW)).toEqual(NOW);
  });

  it("clamps future timestamps within drift tolerance to server time", () => {
    const slightFuture = new Date(NOW.getTime() + 10_000); // +10s
    expect(parseAndValidateEventTimestamp(slightFuture, NOW)).toEqual(NOW);
  });

  it("falls back to server time for far-future timestamps exceeding tolerance", () => {
    const farFuture = new Date(NOW.getTime() + MAX_FUTURE_SKEW_MS + 60_000); // +2 minutes
    expect(parseAndValidateEventTimestamp(farFuture, NOW)).toEqual(NOW);
  });
});
