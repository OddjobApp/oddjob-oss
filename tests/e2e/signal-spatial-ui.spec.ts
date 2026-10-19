import { test, expect } from "@playwright/test";
import {
  closeSignalPool,

  createSignalFixtures,
  cycleStatus,
  signalPool,
  type SignalFixtures,
} from "./helpers/signal-fixtures.js";
import { baseSignal, injectSignal } from "./helpers/signal-inject.js";
import { appliedEffect, worldState } from "./helpers/signal-assert.js";
import { normalizeOperator } from "../../shared/contracts/spatial-predicates.js";

/**
 * Scenario 15: the human-facing contract.
 *
 * Everything else in this suite drives the engine through its API. This spec
 * asks the question none of that can: does what an operator builds in the
 * browser equal what the engine executes?
 *
 * The assertions deliberately end in the database rather than on screen. A rule
 * that renders correctly and serialises to an operator the engine cannot
 * interpret still looks perfect in the UI — that is precisely the failure mode
 * this scenario exists to catch.
 */

/**
 * Opens the Subscriptions view.
 *
 * Navigation is by URL, not by clicking a tab: `SignalDashboard` imports
 * `ViewSwitcher` but never renders it — the tab bar the component provides is
 * dead code, and `activeView` is seeded from `?view=` on the query string and
 * synced back to it. So a deep link is the only way in, and it is also what the
 * component itself is built around.
 *
 * The onboarding overlay is dismissed through its own localStorage flag before
 * the page loads. It is a modal that covers the whole surface on first visit,
 * and stepping through four slides on every test would be testing the
 * onboarding rather than the thing under test.
 */
async function openSubscriptions(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("oddjob:spatial:onboarding-complete", "true");
  });
  await page.goto("/workspace/spatial?view=subscriptions");
}

let fx: SignalFixtures;

test.beforeAll(async () => {
  fx = await createSignalFixtures();
});

test.afterAll(async () => {
  await closeSignalPool();
});

test.describe("Scenario 15 — authoring in the browser", () => {
  test.beforeEach(async ({ page }) => {
    await openSubscriptions(page);
    await expect(page.getByTestId("subscriptions-view-page")).toBeVisible({ timeout: 30_000 });
  });

  test("the delivery-mode control offers exactly the modes the platform has", async ({ page }) => {
    const options = await page
      .getByTestId("subscription-delivery-mode")
      .locator("option")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));

    // These five are enforced in three places that have to agree: the route's
    // allowlist, the CHECK constraint on the column, and the switch in
    // applyDeliveryMode. The control previously offered `trigger_step` and
    // `state_update`, which exist in none of them, while omitting every mode
    // that actually disturbs a cycle.
    expect(options.sort()).toEqual(
      ["context_only", "gate", "notify", "replan", "trigger"].sort(),
    );
  });

  test("a mode chosen in the UI is accepted by the API and reaches the database", async ({
    page,
  }) => {
    const cycleSelect = page.getByTestId("subscription-cycle-select");
    await expect(cycleSelect).toBeVisible();
    await cycleSelect.selectOption(String(fx.cycleIds.CYC_GATE));
    await page.getByTestId("subscription-delivery-mode").selectOption("gate");

    const created = page.waitForResponse(
      (r) =>
        r.url().includes("/api/cycle-signal-subscriptions") &&
        r.request().method() === "POST",
    );
    await page.getByTestId("subscription-create").click();
    const response = await created;

    expect(
      response.status(),
      "a mode offered by the control must not be rejected by the route",
    ).toBe(201);

    const body = await response.json();
    const { rows } = await signalPool().query(
      `SELECT delivery_mode, cycle_id FROM cycle_signal_subscriptions WHERE id = $1`,
      [body.id],
    );
    expect(rows[0].delivery_mode).toBe("gate");
    expect(rows[0].cycle_id).toBe(fx.cycleIds.CYC_GATE);

    await expect(
      page.locator('[data-testid="subscription-row"][data-delivery-mode="gate"]'),
    ).toHaveCount(1);
  });

  /**
   * The end-to-end claim: a subscription an operator created in the browser
   * changes a real cycle when a real signal arrives.
   */
  test("a subscription built in the UI actually gates the cycle", async ({ page, request }) => {
    // A cycle no other test in this file has subscribed. The earlier test left
    // a gate subscription on CYC_GATE, and the FIRST matching subscription is
    // the one that pauses — a second correctly reports `noop:cycle_paused`. So
    // asserting `gated:paused` on a shared cycle is really an assertion about
    // test order, not about gating.
    const cycleId = fx.cycleIds.CYC_REPLAN;

    const select = page.getByTestId("subscription-cycle-select");
    await select.selectOption(String(cycleId));
    await page.getByTestId("subscription-delivery-mode").selectOption("gate");

    const created = page.waitForResponse(
      (r) =>
        r.url().includes("/api/cycle-signal-subscriptions") && r.request().method() === "POST",
    );
    await page.getByTestId("subscription-create").click();
    const subscriptionId = (await (await created).json()).id as number;

    expect(await cycleStatus(cycleId)).toBe("active");

    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "S15 UI Gate Probe", severity: "Critical" }),
    );

    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("gated:paused");
    expect(
      await cycleStatus(cycleId),
      "the cycle an operator subscribed from the browser must actually pause",
    ).toBe("paused");

    const state = await worldState(cycleId);
    expect(state!.lastEventPrimitiveId).toBe(injected.event.id);
  });
});


/**
 * Scenario 15b — the guided rule wizard.
 *
 * This is the surface the "Distill & Build New Rule" button actually opens.
 * (The RuleBuilder tree canvas exists but is not reachable from here, so
 * driving it would be testing a screen no operator arrives at this way.)
 *
 * Its publish path could not work before the change made alongside this suite:
 * it POSTed a single subscription carrying `deliveryMode: 'override_and_execute'`
 * — rejected by the route's allowlist and by the CHECK constraint on the column
 * — with the rule conditions nested under a `ruleSpecification` key the route
 * ignores. So every publish 400'd, and had it not, the conditions would have
 * been dropped while the toast reported the rule "registered to GRIE engine".
 */
test.describe("Scenario 15b — the guided rule wizard publishes a real rule", () => {
  const WIZARD_SUITE_ID = "guided-rule-distillation";

  test.beforeEach(async ({ page }) => {
    // A rule left by an earlier run would make the save an update and hide a
    // broken create path.
    await signalPool().query(
      `DELETE FROM rule_specifications WHERE suite_db_id IN
         (SELECT id FROM rule_suites WHERE suite_id = $1)`,
      [WIZARD_SUITE_ID],
    );
    await openSubscriptions(page);
    await expect(page.getByTestId("subscriptions-view-page")).toBeVisible({ timeout: 30_000 });
  });

  test("publishes a rule the engine can read, and a subscription the route accepts", async ({
    page,
    request,
  }) => {
    // The wizard binds to whichever cycle the form has selected, falling back to
    // a hardcoded id 42 that does not exist in a fresh database.
    await page.getByTestId("subscription-cycle-select").selectOption(String(fx.cycleIds.CYC_CTX));
    await page.getByTestId("open-rule-builder").click();

    for (let step = 1; step < 5; step++) {
      await page.getByTestId("wizard-next").click();
    }

    const rulePut = page.waitForResponse(
      (r) => r.url().includes("/api/rule-suites/") && r.request().method() === "PUT",
    );
    const subscriptionPost = page.waitForResponse(
      (r) =>
        r.url().includes("/api/cycle-signal-subscriptions") && r.request().method() === "POST",
    );

    await page.getByTestId("wizard-publish").click();

    const ruleResponse = await rulePut;
    expect(
      [200, 201],
      "the wizard must persist a rule specification, not only a subscription",
    ).toContain(ruleResponse.status());

    const subscriptionResponse = await subscriptionPost;
    expect(
      subscriptionResponse.status(),
      "the delivery mode the wizard sends must be one the route accepts",
    ).toBe(201);

    // --- the rule actually reached the engine's table ---
    const { rows } = await signalPool().query(
      `SELECT r.rule_id, r.enabled, r.specification
       FROM rule_specifications r
       JOIN rule_suites s ON s.id = r.suite_db_id
       WHERE s.suite_id = $1`,
      [WIZARD_SUITE_ID],
    );
    expect(rows, "the toast claims registration with the GRIE engine; this is that claim").toHaveLength(1);

    const spec = rows[0].specification;
    const conditions = spec.ifBranch.conditions as Array<Record<string, any>>;

    // Every crisp operator the wizard emits must be interpretable. An operator
    // `normalizeOperator` returns null for makes its condition fail closed
    // forever, with nothing in the UI to say so.
    for (const cond of conditions.filter((c) => !c.type || c.type === "crisp")) {
      expect(
        normalizeOperator(cond.operator),
        `wizard emitted operator "${cond.operator}" on field "${cond.field}"`,
      ).not.toBeNull();
    }

    // The wizard advertises a fuzzy, a graph and a temporal condition on its
    // review step; all three should be in what it saved.
    const kinds = conditions.map((c) => c.type ?? "crisp");
    expect(kinds).toContain("fuzzy_ai_eval");
    expect(kinds).toContain("semantic_graph");
    expect(kinds).toContain("temporal_velocity");

    // --- and the engine agrees with what the operator configured ---
    const dryRun = await request.post(
      `/api/rule-suites/${WIZARD_SUITE_ID}/rules/${rows[0].rule_id}/evaluate`,
      {
        data: {
          sampleEvent: {
            severity: "Critical",
            targetSector: "Logistics",
            jurisdiction: "NL",
            confidenceScore: 0.95,
          },
        },
      },
    );
    expect(dryRun.ok()).toBeTruthy();
    const result = await dryRun.json();
    expect(result.spatialTrace ?? result.fuzzyScores).toBeDefined();

    // A signal in the wrong sector must not match the crisp filter the wizard
    // wrote, whatever the model says about the fuzzy one.
    const wrongSector = await request.post(
      `/api/rule-suites/${WIZARD_SUITE_ID}/rules/${rows[0].rule_id}/evaluate`,
      {
        data: {
          sampleEvent: {
            severity: "Critical",
            targetSector: "Energy",
            jurisdiction: "NL",
            confidenceScore: 0.95,
          },
        },
      },
    );
    expect((await wrongSector.json()).matched).toBe(false);
  });
});
