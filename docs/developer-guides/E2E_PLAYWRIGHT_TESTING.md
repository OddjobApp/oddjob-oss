# E2E Playwright & Synthetic Verification Guide

This guide establishes conventions for authoring robust, deterministic end-to-end tests using [Playwright](https://playwright.dev) across Oddjob's autonomous missions, Human-in-the-Loop (HIL) forms, and interactive cockpits.

---

## 1. Core Principles: Flake-Free Determinism

E2E tests in Oddjob run against both live backends and synthetic test databases (`scripts/setup-test-db.ts`). To prevent timing flakes and brittle selectors:

1. **Locate by Role or `data-testid`**:
   - ❌ Never use fragile tag chains or auto-generated CSS classes: `page.locator("div.space-y-4 > div > button.bg-indigo-600")`.
   - ✅ Use explicit test IDs or semantic roles:
     ```typescript
     await page.getByTestId("add-parameter-btn").click();
     await page.getByRole("button", { name: "Save draft" }).click();
     ```
2. **Never Use Arbitrary `page.waitForTimeout()`**:
   - ❌ `await page.waitForTimeout(5000);` slows tests and causes intermittent CI timeouts.
   - ✅ Wait for explicit DOM assertions or network responses:
     ```typescript
     await expect(page.getByTestId("agent-upskilling-pod")).toBeVisible();
     await page.waitForResponse(resp => resp.url().includes("/api/missions") && resp.status() === 200);
     ```

---

## 2. Testing Human-in-the-Loop (HIL) Forms

Human-in-the-loop forms require an agent action to pause and await user ratification. 

A canonical pattern for testing HIL cycles (e.g. [`tests/e2e/operations-cycle-312.spec.ts`](../../tests/e2e/operations-cycle-312.spec.ts)):

```typescript
test("Operations Cycle 312: Autonomy HIL Ratification Flow", async ({ page }) => {
  // 1. Navigate to target workbench
  await page.goto("/operations/cycles/312");

  // 2. Verify agent state reaches HIL Pause
  await expect(page.getByTestId("cycle-status-badge")).toHaveText("Awaiting Human Review");

  // 3. User modifies parameters in cockpit
  await page.getByTestId("weight-input-efficiency").fill("2.5");

  // 4. User ratifies decision
  await page.getByRole("button", { name: /Ratify/i }).click();

  // 5. Verify cycle transitions to Committed
  await expect(page.getByTestId("cycle-status-badge")).toHaveText("Committed");
});
```

---

## 3. Running & Recording Demos

Playwright is also used to generate video recordings of golden path demonstrations:

```bash
# Run headless unit/regression E2E tests
npx playwright test

# Run interactive headed browser execution
npm run test:demos

# Run spatial signal intelligence E2E tests
npm run test:e2e:signals

# Run clean headed Chrome verification
npx tsx scripts/demo-clean-headed-chrome.ts
```
