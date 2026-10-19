import { describe, expect, it } from "vitest";
import { assertReleaseTransition, hasSourceChanged, isSourceStale, snapshotHash } from "./knowledge-pack-lifecycle.service.js";

describe("knowledge pack acquisition lifecycle", () => {
  it("creates deterministic, tamper-evident source hashes", () => {
    expect(snapshotHash("regulatory snapshot")).toBe(snapshotHash("regulatory snapshot"));
    expect(snapshotHash("regulatory snapshot")).not.toBe(snapshotHash("changed snapshot"));
    expect(snapshotHash("regulatory snapshot")).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("permits only controlled forward release transitions", () => {
    expect(() => assertReleaseTransition("draft", "validated")).not.toThrow();
    expect(() => assertReleaseTransition("validated", "published")).not.toThrow();
    expect(() => assertReleaseTransition("draft", "published")).toThrow(/Invalid knowledge pack transition/);
    expect(() => assertReleaseTransition("published", "validated")).toThrow(/Invalid knowledge pack transition/);
  });

  it("detects source changes and expired evidence", () => {
    const baseline = snapshotHash("original authority text");
    expect(hasSourceChanged(baseline, "original authority text")).toBe(false);
    expect(hasSourceChanged(baseline, "amended authority text")).toBe(true);
    expect(isSourceStale(new Date("2026-01-01"), new Date("2026-01-02"))).toBe(true);
    expect(isSourceStale(new Date("2026-01-03"), new Date("2026-01-02"))).toBe(false);
    expect(isSourceStale(null)).toBe(true);
  });
});
