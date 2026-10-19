import { test, expect, type Page } from "@playwright/test";

const cycleId = 95;
const cycleUrl = `/operations/cycles/${cycleId}`;

type WorkbenchLink = {
  name: string;
  publicPath?: string | null;
  externalPath?: string | null;
  status?: string | null;
  health?: string | null;
};

type CycleApp = {
  name: string;
  status?: string | null;
  workbenchApps?: WorkbenchLink[];
};

type CycleRun = {
  id?: number | null;
  name?: string | null;
  status?: string | null;
};

type MissionBindingItem = {
  missionId: number;
  missionName: string;
  bindings?: unknown[];
};

const ignoredConsoleErrors = [
  /^Warning: Function components cannot be given refs\./,
];

async function collectCycleWorkbenches(page: Page) {
  const appsResponse = await page.request.get(`/api/cycles/${cycleId}/apps`);
  expect(appsResponse.ok(), `GET /api/cycles/${cycleId}/apps`).toBeTruthy();

  const appsPayload = await appsResponse.json();
  const apps = (appsPayload.apps ?? appsPayload ?? []) as CycleApp[];
  expect(
    apps.length,
    "cycle app manager should expose build phases",
  ).toBeGreaterThan(0);

  const links = new Map<string, WorkbenchLink>();
  for (const app of apps) {
    expect(app.name, "each cycle app should have a name").toBeTruthy();
    expect(app.status, `${app.name} status`).not.toBe("failed");
    for (const workbench of app.workbenchApps ?? []) {
      const path = workbench.publicPath ?? workbench.externalPath;
      if (!path) continue;
      links.set(path, workbench);
      expect(workbench.health, `${workbench.name} health`).not.toBe(
        "unhealthy",
      );
      expect(workbench.status, `${workbench.name} status`).not.toBe("failed");
    }
  }

  return {
    phaseNames: [...new Set(apps.map((app) => app.name))],
    workbenches: [...links.values()],
  };
}

async function collectMissionBindings(page: Page) {
  const response = await page.request.get(
    `/api/cycles/${cycleId}/mission-bindings`,
  );
  expect(
    response.ok(),
    `GET /api/cycles/${cycleId}/mission-bindings`,
  ).toBeTruthy();

  const payload = await response.json();
  const items = (payload.items ?? []) as MissionBindingItem[];
  expect(
    items.length,
    "cycle should expose mission binding rows",
  ).toBeGreaterThan(0);
  return items;
}

test.describe("Operations Cycle 95 solution-build monitor", () => {
  const networkErrors: string[] = [];
  const browserErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    networkErrors.length = 0;
    browserErrors.length = 0;

    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        if (!ignoredConsoleErrors.some((pattern) => pattern.test(text))) {
          browserErrors.push(text);
        }
      }
    });

    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });

    page.on("response", (response) => {
      const status = response.status();
      if (status >= 500) {
        networkErrors.push(
          `${status} ${response.request().method()} ${response.url()}`,
        );
      }
    });
  });

  test("cycle 95 can load, expose workbenches, and report buildable pipeline health", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto(cycleUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText(
      "Autonomous Code Generation Pipeline",
    );
    await expect(page.getByText("Cycle Execution Explorer")).toBeVisible();
    await expect(page.getByText("Cycle App Manager")).toBeVisible();

    const cycleResponse = await page.request.get(`/api/cycles/${cycleId}`);
    expect(cycleResponse.ok(), `GET /api/cycles/${cycleId}`).toBeTruthy();
    const cyclePayload = await cycleResponse.json();
    const cycle = cyclePayload.cycle ?? cyclePayload;
    expect(cycle.status, "cycle should be runnable").toMatch(
      /active|running|paused|pending_approval/i,
    );

    const runs = (cyclePayload.runs ?? []) as CycleRun[];

    const { phaseNames, workbenches } = await collectCycleWorkbenches(page);
    expect(
      workbenches.length,
      "cycle should expose solution-build workbench routes",
    ).toBeGreaterThan(0);
    const missionBindings = await collectMissionBindings(page);

    for (const workbench of workbenches) {
      const path = workbench.publicPath ?? workbench.externalPath;
      expect(path, `${workbench.name} route`).toBeTruthy();

      await test.step(`open ${workbench.name}`, async () => {
        await page.goto(path!, { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).not.toContainText(
          /not found|cannot get|application error/i,
        );
        await expect(
          page.locator('h1, main, [role="main"]').first(),
        ).toBeVisible({ timeout: 30_000 });
      });
    }

    expect(
      networkErrors,
      "no backend 5xx responses while monitoring cycle 95",
    ).toEqual([]);
    expect(
      browserErrors,
      "no browser runtime errors while monitoring cycle 95",
    ).toEqual([]);

    const readinessFailures: string[] = [];
    const unboundMissions = missionBindings.filter(
      (item) => (item.bindings?.length ?? 0) === 0,
    );
    if (unboundMissions.length > 0) {
      readinessFailures.push(
        `missions without contextual app bindings: ${unboundMissions
          .map((item) => `${item.missionId}:${item.missionName}`)
          .join(", ")}`,
      );
    }

    const incompletePhaseRuns = phaseNames
      .map((phaseName) => ({
        phaseName,
        run: runs.find(
          (run) =>
            run.name === phaseName || run.name?.endsWith(`: ${phaseName}`),
        ),
      }))
      .filter(({ run }) => run?.status !== "completed")
      .map(
        ({ phaseName, run }) =>
          `${phaseName}=${run ? `${run.status ?? "unknown"} (#${run.id ?? "unknown"})` : "missing"}`,
      );
    if (incompletePhaseRuns.length > 0) {
      readinessFailures.push(
        `latest phase runs are not complete: ${incompletePhaseRuns.join(", ")}`,
      );
    }

    expect(
      readinessFailures.join("\n"),
      "cycle should have complete phase runs and bound mission workbenches before it is build-ready",
    ).toBe("");
  });
});
