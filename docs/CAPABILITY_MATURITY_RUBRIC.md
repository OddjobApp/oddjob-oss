# Capability Maturity — Rubric

> **Status:** active. `maturity` is computed from this rubric by `deriveCapabilityMaturity` in
> [`capability-facts.ts`](../server/domain/admin/infrastructure/capability-facts.ts), and surfaced on
> `/platform-maintenance/documentation?tab=capability`.

## Why this exists

`maturity` used to be a hand-typed literal in `shared/product/oddjob-capability-manifest.ts`. Nothing computed it, nothing consumed it beyond a coloured badge, and no document defined what the levels meant. "Advanced" was therefore an assertion the evidence could not contradict — a capability could be labelled advanced while two of its four output formats did not exist, which is exactly what `presentation-crew-layout` was on 13 Aug 2026.

The level is now a **readout of artifacts that exist**, on the same principle as the `verificationLevel` badge beside it: *evidence, not marketing*. Generating it must never execute anything — it reads what is declared and what is present, not what passes.

## The signals

Each is a fact about the repository, checkable without running the platform.

| Signal | Source | Means |
| :----- | :----- | :---- |
| `hasExecutableContract` | `PRODUCT_TO_EXECUTABLE_CAPABILITY_ID` maps the capability to a manifest in `ODDJOB_EXECUTABLE_CAPABILITY_MANIFESTS` | There is a typed, executable contract behind the product claim — not just a name |
| `demoCount` | `ODDJOB_CANONICAL_DEMOS` entries listing the capability in `capabilityIds` | Someone can be walked through it end to end |
| `executableReadinessChecks` | `ODDJOB_READINESS_CHECKS` for the capability's pillar that carry a `command` | There is a command that tells you whether the pillar is currently sound |

## The ladder

Evaluated top-down; the first row whose requirements are met wins.

| Level | Requires |
| :---- | :------- |
| `advanced` | executable contract **and** ≥1 canonical demo **and** ≥1 executable readiness check on its pillar |
| `maturing` | executable contract **and** ≥1 canonical demo |
| `foundation` | executable contract only |
| `experimental` | no executable contract |

### The declared value is a ceiling, never a floor

`maturity` in the manifest is still authored, but it can only ever **lower** the computed result. Declaring something `experimental` while it hardens is legitimate and is respected. Declaring something `advanced` does nothing — the evidence has to be there.

This inverts the previous design, where the label was an assertion no evidence could contradict.

## How to raise a capability

Each level names the artifact it is missing, so the work is explicit rather than a matter of opinion:

1. **`experimental` → `foundation`** — map the capability to an executable manifest in `PRODUCT_TO_EXECUTABLE_CAPABILITY_ID`. If no manifest fits, the product claim has no implementation contract behind it, and that is the finding.
2. **`foundation` → `maturing`** — add a canonical demo to `ODDJOB_CANONICAL_DEMOS` listing it in `capabilityIds`, with real `successCriteria`. As of writing, two capabilities have no demo at all: `prediction-intelligence` and `crew-mobile`, both held at `experimental` by their declared ceilings on purpose (prediction is advisory-only; the Android client awaits a signed release — phone push went live on 8 Oct 2026). `spatial-signals`, `crew-collaboration`, `formal-layout-and-governance-verification`, `presentation-crew-layout`, and `scribe-studio` gained demos on 10 Oct 2026.
3. **`maturing` → `advanced`** — add a readiness check to `ODDJOB_READINESS_CHECKS` for the pillar with a runnable `command` and a concrete `expected`. Every pillar now has at least one executable check; `forge` was the last gap, closed 10 Oct 2026 by `forge-readiness-gate-valid` and `forge-gallery-conformance-valid` (the publish-readiness and visual-QA gates the `app-forge-readiness-pack` roadmap item calls for), which let `app-forge` reach advanced. `knowledge` gained `knowledge-graph-rag-valid` the same day, which let `knowledge-grounding` reach advanced.

"Get everything to advanced" is therefore a real backlog — demos for four capabilities and readiness checks for two pillars — rather than a find-and-replace across eleven string literals.

## Deliberate limitations

- **Presence, not passing.** A readiness check that exists but fails still counts, because generating the capability spec must not execute anything (it is a fingerprinted singleton spec; running commands during generation would make the fingerprint depend on the state of the world). Whether checks *pass* belongs on the readiness surface, not here.
- **Pillar-level, not capability-level, readiness.** Readiness checks are declared per pillar, so all capabilities in a pillar share that signal. Tightening this needs per-capability checks in the manifest.
- **No usage or reliability input.** Production telemetry is deliberately excluded for now: it would make the spec non-deterministic. Adding it means introducing a separate, non-fingerprinted overlay, in the way org availability is already handled.
