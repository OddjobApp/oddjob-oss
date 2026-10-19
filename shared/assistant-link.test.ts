// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assistantLinkPath, readAssistantLink } from "./assistant-link";

describe("assistant links", () => {
  it("builds a dashboard link that names the view", () => {
    expect(assistantLinkPath("approvals")).toBe("/dashboard?assistant=approvals");
  });

  it("reads the view and keeps the rest of the query string", () => {
    expect(readAssistantLink("?orgId=473&assistant=approvals")).toEqual({ view: "approvals", search: "?orgId=473" });
    expect(readAssistantLink("?assistant=updates")).toEqual({ view: "updates", search: "" });
  });

  it("ignores a query string without a known view", () => {
    expect(readAssistantLink("?orgId=473")).toBeNull();
    expect(readAssistantLink("?assistant=settings")).toBeNull();
    expect(readAssistantLink("")).toBeNull();
  });
});
