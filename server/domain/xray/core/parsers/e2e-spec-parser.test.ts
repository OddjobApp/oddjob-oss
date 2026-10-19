import { describe, expect, it } from "vitest";
import { parseXrayE2ESpec } from "./e2e-spec-parser.js";

describe("parseXrayE2ESpec", () => {
  it("creates traceable behavior evidence from an annotated Playwright test", () => {
    const parsed = parseXrayE2ESpec("tests/e2e/example.spec.ts", `
      /** @xray-scope example-app
       * @xray-alias installed-example
       * @xray-spec docs/specs/example.md
       */
      test("creates an item", async ({ page }) => {
        // @behavior example.item.create
        // @functional-description A user can create an item and see confirmation.
        // Open the item register.
        await page.goto("/items");
        await expect(page.getByText("Created")).toBeVisible();
      });
    `);

    expect(parsed?.scope).toBe("example-app");
    expect(parsed?.scopeAliases).toEqual(["installed-example"]);
    expect(parsed?.specificationPath).toBe("docs/specs/example.md");
    expect(parsed?.tests).toHaveLength(1);
    expect(parsed?.tests[0]).toMatchObject({
      behaviorId: "example.item.create",
      routes: ["/items"],
      startLine: 6,
      functionalDescription: "A user can create an item and see confirmation.",
      steps: ["Open the item register."],
    });
    expect(parsed?.tests[0].assertions[0]).toContain("toBeVisible");
  });

  it("ignores unannotated specifications and tests without behavior contracts", () => {
    expect(parseXrayE2ESpec("tests/e2e/example.spec.ts", `test("x", async () => {});`)).toBeNull();

    const parsed = parseXrayE2ESpec("tests/e2e/example.spec.ts", `
      /** @xray-scope example-app */
      test("x", async () => {});
    `);
    expect(parsed?.tests).toEqual([]);
  });
});
