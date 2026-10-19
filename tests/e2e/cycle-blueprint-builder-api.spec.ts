import { test, expect, type APIRequestContext } from "@playwright/test";
import { quarterlyAccessReviewDraft } from "../../shared/schema/cycle-builder-draft.fixtures";

const endpoint = "/api/cycle-builder/drafts";

function definition(suffix: string) {
  return {
    ...structuredClone(quarterlyAccessReviewDraft),
    id: `e2e-${suffix}`,
    cycle: {
      ...quarterlyAccessReviewDraft.cycle,
      name: `E2E Cycle Builder ${suffix}`,
    },
    readiness: { validation: "valid" as const, test: "not_run" as const },
  };
}

async function json(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

test.describe("Cycle Builder API lifecycle", () => {
  test("persists drafts and rejects stale optimistic revisions", async ({ request }) => {
    const value = definition(`crud-${Date.now()}`);
    const createdResponse = await request.post(endpoint, { data: { definition: value } });
    expect(createdResponse.status()).toBe(201);
    const created = (await json(createdResponse)).draft;

    try {
      const loadedResponse = await request.get(`${endpoint}/${created.id}`);
      expect(loadedResponse.ok()).toBeTruthy();
      expect((await json(loadedResponse)).draft.definition.cycle.name).toBe(value.cycle.name);

      const simulationResponse = await request.post("/api/cycle-builder/simulate", { data: { definition: value } });
      expect(simulationResponse.ok()).toBeTruthy();
      const simulation = (await json(simulationResponse)).simulation;
      expect(simulation.missionCount).toBeGreaterThan(0);
      expect(simulation.estimatedTokens).toBeGreaterThan(0);
      expect(simulation.estimatedCostUsd).toBeGreaterThanOrEqual(0);

      const changed = {
        ...value,
        cycle: { ...value.cycle, description: "Updated by the API lifecycle contract." },
      };
      const updatedResponse = await request.patch(`${endpoint}/${created.id}`, {
        data: { version: created.version, definition: changed },
      });
      expect(updatedResponse.ok()).toBeTruthy();
      const updated = (await json(updatedResponse)).draft;
      expect(updated.version).toBe(created.version + 1);

      const staleResponse = await request.patch(`${endpoint}/${created.id}`, {
        data: { version: created.version, definition: value },
      });
      expect(staleResponse.status()).toBe(409);
      expect((await json(staleResponse)).error).toBe("Draft has changed");
    } finally {
      expect((await request.delete(`${endpoint}/${created.id}`)).status()).toBe(204);
    }
  });

  test("enforces readiness, creates one Cycle, and rejects duplicate creation", async ({ request }) => {
    const value = definition(`create-${Date.now()}`);
    const createdResponse = await request.post(endpoint, { data: { definition: value } });
    expect(createdResponse.status()).toBe(201);
    let draft = (await json(createdResponse)).draft;
    let cycleId: number | undefined;

    try {
      const premature = await request.post(`${endpoint}/${draft.id}/create-cycle`, {
        data: { version: draft.version },
      });
      expect(premature.status()).toBe(422);

      const readiness = await request.post(`${endpoint}/${draft.id}/readiness`, {
        data: { version: draft.version, definition: value },
      });
      expect(readiness.status()).toBe(200);
      const readinessBody = await json(readiness);
      expect(readinessBody.ready).toBe(true);
      expect(readinessBody.definition.readiness.test).toBe("passed");
      draft = readinessBody.draft;

      const createCycle = await request.post(`${endpoint}/${draft.id}/create-cycle`, {
        data: { version: draft.version },
      });
      expect(createCycle.status()).toBe(201);
      const cycle = (await json(createCycle)).cycle;
      cycleId = cycle.id;
      expect(cycle.status).toBe("planning");
      expect(cycle.blueprintCount).toBe(value.phases.length);

      const appName = value.phases[0].name;
      const completionOutput = { approved: true, evidenceId: "e2e-evidence-42" };
      const complete = await request.post(
        `/api/cycles/${cycleId}/apps/${encodeURIComponent(appName)}/complete`,
        { data: { output: completionOutput } },
      );
      expect(complete.ok()).toBeTruthy();
      expect((await json(complete)).status).toBe("completed");

      const appsResponse = await request.get(`/api/cycles/${cycleId}/apps`);
      expect(appsResponse.ok()).toBeTruthy();
      const apps = (await json(appsResponse)).apps;
      expect(apps.find((app: any) => app.name === appName)?.status).toBe("completed");

      const duplicate = await request.post(`${endpoint}/${draft.id}/create-cycle`, {
        data: { version: draft.version },
      });
      expect(duplicate.status()).toBe(409);
      expect((await json(duplicate)).cycleId).toBe(cycleId);
    } finally {
      if (cycleId) expect((await request.delete(`/api/cycles/${cycleId}`)).ok()).toBeTruthy();
      expect((await request.delete(`${endpoint}/${draft.id}`)).status()).toBe(204);
    }
  });

  test("rejects a Workbench deployment that is not available to the organization", async ({ request }) => {
    const value = definition(`governance-${Date.now()}`);
    value.phases[0] = {
      ...value.phases[0],
      appStep: {
        appId: 2_147_000_000,
        appName: "Unavailable governed app",
        deploymentId: 2_147_000_000,
        releaseRef: "missing-release",
        isPublished: true,
        launchHref: "/apps/missing",
        mode: "open_and_wait",
        outputPortKey: "inventory",
      },
    };
    const createdResponse = await request.post(endpoint, { data: { definition: value } });
    expect(createdResponse.status()).toBe(201);
    const draft = (await json(createdResponse)).draft;

    try {
      const readiness = await request.post(`${endpoint}/${draft.id}/readiness`, {
        data: { version: draft.version, definition: value },
      });
      expect(readiness.status()).toBe(422);
      const body = await json(readiness);
      expect(body.ready).toBe(false);
      expect(body.errors.join(" ")).toContain("is unavailable");
    } finally {
      expect((await request.delete(`${endpoint}/${draft.id}`)).status()).toBe(204);
    }
  });

  test("opens a planning Cycle as a revision draft and publishes settings in place", async ({ request }) => {
    const value = definition(`revision-${Date.now()}`);
    const createdResponse = await request.post(endpoint, { data: { definition: value } });
    expect(createdResponse.status()).toBe(201);
    let sourceDraft = (await json(createdResponse)).draft;
    let editDraft: any;
    let cycleId: number | undefined;

    try {
      const readiness = await request.post(`${endpoint}/${sourceDraft.id}/readiness`, {
        data: { version: sourceDraft.version, definition: value },
      });
      expect(readiness.ok()).toBeTruthy();
      sourceDraft = (await json(readiness)).draft;

      const createdCycle = await request.post(`${endpoint}/${sourceDraft.id}/create-cycle`, {
        data: { version: sourceDraft.version },
      });
      expect(createdCycle.status()).toBe(201);
      cycleId = (await json(createdCycle)).cycle.id;

      const opened = await request.post(`/api/cycle-builder/cycles/${cycleId}/edit-draft`);
      expect(opened.status()).toBe(201);
      editDraft = (await json(opened)).draft;
      expect(editDraft.definition.source).toEqual({ type: "edit", sourceId: String(cycleId) });

      const revisedDefinition = {
        ...editDraft.definition,
        cycle: {
          ...editDraft.definition.cycle,
          name: `${value.cycle.name} revised`,
          tokenLimit: 750000,
          requiresApproval: true,
          changeReason: "Exercise the canonical edit lifecycle.",
        },
        readiness: { validation: "valid", test: "not_run" },
      };
      const revisedReadiness = await request.post(`${endpoint}/${editDraft.id}/readiness`, {
        data: { version: editDraft.version, definition: revisedDefinition },
      });
      expect(revisedReadiness.ok()).toBeTruthy();
      editDraft = (await json(revisedReadiness)).draft;

      const published = await request.post(`${endpoint}/${editDraft.id}/publish-revision`, {
        data: { version: editDraft.version },
      });
      expect(published.ok()).toBeTruthy();
      const body = await json(published);
      expect(body.mode).toBe("in_place");
      expect(body.cycle.id).toBe(cycleId);
      expect(body.cycle.name).toBe(revisedDefinition.cycle.name);
      expect(body.cycle.tokenLimit).toBe(750000);
      expect(body.cycle.requiresApproval).toBe(1);
      expect(body.cycle.metadata.changeReason).toBe(revisedDefinition.cycle.changeReason);
    } finally {
      if (cycleId) await request.delete(`/api/cycles/${cycleId}`);
      if (editDraft?.id) await request.delete(`${endpoint}/${editDraft.id}`);
      if (sourceDraft?.id) await request.delete(`${endpoint}/${sourceDraft.id}`);
    }
  });

  test("rejects publication when the source Cycle changed after the revision opened", async ({ request }) => {
    const value = definition(`source-conflict-${Date.now()}`);
    const createdResponse = await request.post(endpoint, { data: { definition: value } });
    let sourceDraft = (await json(createdResponse)).draft;
    let editDraft: any;
    let cycleId: number | undefined;
    try {
      const readiness = await request.post(`${endpoint}/${sourceDraft.id}/readiness`, { data: { version: sourceDraft.version, definition: value } });
      sourceDraft = (await json(readiness)).draft;
      const createdCycle = await request.post(`${endpoint}/${sourceDraft.id}/create-cycle`, { data: { version: sourceDraft.version } });
      cycleId = (await json(createdCycle)).cycle.id;
      const opened = await request.post(`/api/cycle-builder/cycles/${cycleId}/edit-draft`);
      editDraft = (await json(opened)).draft;
      const readyDefinition = { ...editDraft.definition, readiness: { validation: "valid", test: "not_run" } };
      const editReadiness = await request.post(`${endpoint}/${editDraft.id}/readiness`, { data: { version: editDraft.version, definition: readyDefinition } });
      editDraft = (await json(editReadiness)).draft;

      const externalChange = await request.patch(`/api/cycles/${cycleId}`, { data: { priority: 9 } });
      expect(externalChange.ok()).toBeTruthy();
      const publish = await request.post(`${endpoint}/${editDraft.id}/publish-revision`, { data: { version: editDraft.version } });
      expect(publish.status()).toBe(409);
      expect((await json(publish)).code).toBe("SOURCE_CYCLE_CHANGED");
    } finally {
      if (cycleId) await request.delete(`/api/cycles/${cycleId}`);
      if (editDraft?.id) await request.delete(`${endpoint}/${editDraft.id}`);
      if (sourceDraft?.id) await request.delete(`${endpoint}/${sourceDraft.id}`);
    }
  });
});
