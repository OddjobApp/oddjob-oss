import { afterEach, describe, expect, it } from "vitest";
import { IntegrationReliabilityService } from "./integration-reliability.service.js";

const keys = ["SLACK_BOT_TOKEN", "SLACK_CLIENT_ID", "SLACK_SIGNING_SECRET"];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("IntegrationReliabilityService", () => {
  it("does not expose credential values and marks missing integrations unavailable", () => {
    for (const key of keys) delete process.env[key];
    const slack = new IntegrationReliabilityService().getAssessments().find((item) => item.id === "slack");
    expect(slack?.health).toBe("unavailable");
    expect(JSON.stringify(slack)).not.toContain("token");
  });

  it("marks Slack healthy when credentials and signing verification are configured", () => {
    process.env.SLACK_BOT_TOKEN = "secret-value";
    process.env.SLACK_SIGNING_SECRET = "signing-value";
    const slack = new IntegrationReliabilityService().getAssessments().find((item) => item.id === "slack");
    expect(slack?.health).toBe("healthy");
    expect(slack?.security).toBe("verified");
    expect(JSON.stringify(slack)).not.toContain("secret-value");
  });
});
