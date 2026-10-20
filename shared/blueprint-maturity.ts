/**
 * Blueprint maturity, shared by the App Forge catalog (server), the Forge Launchpad
 * (client) and the list_blueprints tool agents use, so every surface shows the same
 * label. docs/guides/blueprint-maturity.md explains how a blueprint is promoted.
 */
export type BlueprintMaturity = "stable" | "beta" | "experimental";

/**
 * How far each catalog blueprint can be relied on, from evidence in this repository:
 *
 * - stable: used by a cycle, so the blueprint contract test gates it, and has its
 *   own tests (rescue-dispatch's suite, tests/sdlc-workbench for sdlc-workbench and
 *   wayfare).
 * - beta: used by a cycle, so the contract test gates it, without dedicated tests.
 * - experimental: in no cycle — starter templates, demos and stubs.
 *
 * Anything not listed is experimental. This replaces a formalVerification flag that
 * claimed "MaxSMT & WCAG AA PASSED" for every entry without anything having run.
 */
export const BLUEPRINT_MATURITY: Record<string, BlueprintMaturity> = {
    "rescue-dispatch": "stable",
    "sdlc-workbench": "stable",
    "wayfare": "stable",

    "agent-training-workbench": "beta",
    "ai-workforce-dashboard": "beta",
    "budgetmaster-advisor": "beta",
    "budgetmaster-workbench": "beta",
    "codegen-pipeline-workbench": "beta",
    "it-ticketing-portal": "beta",
    "location-search": "beta",
    "ops-workbench": "beta",
    "pm-workbench": "beta",
    "product-launch-workbench": "beta",
    "qa-workbench": "beta",
    "research-workbench": "beta",
    "sales-opportunity-workbench": "beta",
    "scrum-master-workbench": "beta",
    "stakeholder-workbench": "beta",
    "support-agent-dashboard": "beta",
};

/** A blueprint not listed in BLUEPRINT_MATURITY is experimental. */
export function blueprintMaturity(slug: string): BlueprintMaturity {
    return BLUEPRINT_MATURITY[slug] ?? "experimental";
}

/** What each label means, in words a person choosing a blueprint can act on. */
export const MATURITY_DESCRIPTION: Record<BlueprintMaturity, string> = {
    stable: "Used by a cycle, checked by the blueprint contract test, and covered by its own tests.",
    beta: "Used by a cycle and checked by the blueprint contract test, without dedicated tests yet.",
    experimental: "Not used by any cycle: a starter template, demo or early build. Expect gaps.",
};
