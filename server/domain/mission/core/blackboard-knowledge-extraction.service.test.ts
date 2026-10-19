import { describe, expect, it } from "vitest";
import { extractBlackboardCandidates, redactBlackboardValue } from "./blackboard-knowledge-extraction.service.js";

describe("blackboard knowledge extraction", () => {
  it("redacts sensitive nested values before extraction", () => {
    expect(redactBlackboardValue({ apiKey: "secret", nested: { password: "hidden", status: "ready" } })).toEqual({
      apiKey: "[redacted]",
      nested: { password: "[redacted]", status: "ready" },
    });
  });

  it("extracts meaningful structured state and ignores tiny values", () => {
    const candidates = extractBlackboardCandidates({ status: "ok", finding: "Payment retries fail after the third attempt." });
    expect(candidates.map((item) => item.key)).toEqual(["finding"]);
  });
});
