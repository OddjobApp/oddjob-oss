// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isLinkExpired, linkExpiresAt, linkSecurityOf } from "./form-studio-link";

describe("form link security", () => {
  it("reads a form's link settings, treating anything unusable as open and non-expiring", () => {
    expect(linkSecurityOf({ requireOtp: true, tokenExpirationHours: 48 })).toEqual({ requireOtp: true, tokenExpirationHours: 48 });
    expect(linkSecurityOf(null)).toEqual({ requireOtp: false, tokenExpirationHours: null });
    expect(linkSecurityOf({ requireOtp: "yes", tokenExpirationHours: 0 })).toEqual({ requireOtp: false, tokenExpirationHours: null });
    expect(linkSecurityOf({ tokenExpirationHours: 2.5 })).toEqual({ requireOtp: false, tokenExpirationHours: null });
  });

  it("expires a link the given number of hours after publishing", () => {
    const security = { requireOtp: false, tokenExpirationHours: 24 };
    expect(linkExpiresAt("2026-09-12T00:00:00.000Z", security)?.toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(isLinkExpired("2026-09-12T00:00:00.000Z", security, new Date("2026-09-12T23:59:59Z"))).toBe(false);
    expect(isLinkExpired("2026-09-12T00:00:00.000Z", security, new Date("2026-09-13T00:00:00Z"))).toBe(true);
  });

  it("never expires a link without a lifetime, or without a publish time", () => {
    expect(isLinkExpired("2020-01-01T00:00:00Z", { requireOtp: false, tokenExpirationHours: null })).toBe(false);
    expect(isLinkExpired(null, { requireOtp: false, tokenExpirationHours: 1 })).toBe(false);
  });
});
