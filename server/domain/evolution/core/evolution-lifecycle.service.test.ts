import { describe, expect, it } from "vitest";
import { EvolutionLifecycleService, type LifecycleStore } from "./evolution-lifecycle.service.js";
import type { PhenotypeStage, StageEvidence, StageTransition } from "@shared/evo-devo/index.js";

class MemoryLifecycleStore implements LifecycleStore {
  stage?: PhenotypeStage; exists = true; events: Array<{ actor: string; transition: any }> = [];
  async phenotypeExists() { return this.exists; }
  async currentStage() { return this.stage; }
  async initializeAtomic(_org: number, _phenotype: string, actor: string) { if (!this.exists) throw Object.assign(new Error("Phenotype not found"), { status: 404 }); if (this.stage) return { stage: this.stage, initialized: false }; this.stage = "embryonic"; this.events.push({ actor, transition: { to: this.stage } }); return { stage: this.stage, initialized: true }; }
  async transitionAtomic(_org: number, _phenotype: string, action: StageTransition["action"], evidence: StageEvidence, actor: string) { if (!this.exists) throw Object.assign(new Error("Phenotype not found"), { status: 404 }); const transition = (await import("@shared/evo-devo/index.js")).transitionPhenotype(this.stage ?? "embryonic", action, evidence); this.stage = transition.to; this.events.push({ actor, transition }); return { eventId: `event-${this.events.length}`, transition }; }
}

describe("EvolutionLifecycleService", () => {
  it("initializes once and durably advances", async () => {
    const store = new MemoryLifecycleStore(); const service = new EvolutionLifecycleService(store);
    expect(await service.initialize(1, "p1", "system")).toEqual({ stage: "embryonic", initialized: true });
    const result = await service.transition(1, "p1", { action: "promote", evidence: { reason: "valid" } }, "operator");
    expect(result).toMatchObject({ from: "embryonic", to: "validation", eventId: "event-2" });
    expect(await service.initialize(1, "p1", "system")).toEqual({ stage: "validation", initialized: false });
  });
  it("preserves tenant isolation through existence checks", async () => {
    const store = new MemoryLifecycleStore(); store.exists = false;
    await expect(new EvolutionLifecycleService(store).getCurrentStage(2, "foreign")).rejects.toMatchObject({ status: 404 });
  });
});
