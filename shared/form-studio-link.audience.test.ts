/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { effectiveLinkAudience, linkAudienceOf } from "./form-studio-link";

describe("who a form's link is for", () => {
  it("reads the author's choice, and nothing else, from the link settings", () => {
    expect(linkAudienceOf({ requireOtp: true, linkAudience: "anyone" })).toBe("anyone");
    expect(linkAudienceOf({ linkAudience: "project_members" })).toBe("project_members");
    expect(linkAudienceOf({ linkAudience: "everyone" })).toBeNull();
    expect(linkAudienceOf(null)).toBeNull();
  });

  it("is members only in a private project unless the author opened it to anyone", () => {
    expect(effectiveLinkAudience(null, true)).toBe("project_members");
    expect(effectiveLinkAudience("project_members", true)).toBe("project_members");
    expect(effectiveLinkAudience("anyone", true)).toBe("anyone");
  });

  it("is for anyone outside a private project, whatever was chosen there before", () => {
    expect(effectiveLinkAudience(null, false)).toBe("anyone");
    expect(effectiveLinkAudience("project_members", false)).toBe("anyone");
  });
});
