import { describe, it, expect } from "vitest";
import { missionPlanResponseSchema } from "./index";
describe("generated mission plan response", () => {
  it("rejects absent or blank brief fields before they can overwrite user input", () => {
    for (const value of [{}, { name: "Review" }, { name: "Review", objective: "   " }, { objective: "Review requests", name: null }]) {
      expect(missionPlanResponseSchema.safeParse(value).success).toBe(false);
    }
  });
  it("accepts a complete brief while preserving the generated workstream data", () => {
    const plan = { name: "Weekly review", objective: "Review the sample requests", members: [{ role: "Analyst", entityType: "job", entityId: 3 }] };
    expect(missionPlanResponseSchema.parse(plan)).toEqual(plan);
  });
});
