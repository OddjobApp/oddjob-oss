# Design: App-wide component indexer (scoping)

**Status:** Draft / scoping · **Theme:** Component library, instant apps, App Forge synthesis

## Problem

The component index — which powers the Component Gallery and the copilot's instant
apps — currently holds **37** entries, and they are **not** the product of scanning
the app:

- `sync-component-index.ts` (the only scanner) points at exactly one directory,
  `packages/design-system/src/components`, which contains **1** file.
- The other ~36 got in via **hardcoded** lists in `harvest-blueprint-components.ts`
  and `seed-component-index.ts`.

Meanwhile Oddjob has on the order of **1,150 `.tsx` files** (≈215 client, ≈675
domain UI, ≈262 blueprint apps). So the "library" covers ~3% and is manually
curated, not scanned.

## The reframe: "index every screen" is the wrong goal

A feasibility scan over 735 client-facing UI `.tsx` files classified them:

| Bucket | Count | Indexable? |
|---|---|---|
| Pages (route-bound, `/pages/`) | 143 | No — need routing + data context |
| No component export (helpers, barrels, types) | 337 | No |
| Need route params (`useParams`/`useRoute`) | 4 | No |
| **Renderable candidates** (component export, not a page, no route-param hooks) | **251** | Maybe |
| — of which self-wiring (fetch own data) | ~121 | Best candidates |

But **251 is a loose upper bound.** The top candidate directories are
`jobs/…/components` (50), `pipeline/…/components` (27), `core/ui/components/shared`
(26), `admin/…/components` (13), and `client/src/components/ui` (shadcn primitives).
Most of these are **sub-components of larger screens** that require parent props/
context, or trivial primitives (`Button`, `Card`) — not standalone, meaningful
blocks. Rendering them in isolation would error or be useless.

**Conclusion:** the target isn't "every screen" (pages don't qualify) nor "every
component export" (too many need context). It's **self-contained, meaningful,
renderable blocks** — the packaged blocks (35) plus curated widget/block libraries
plus self-wiring domain blocks that pass a renderability gate. Realistic indexed
set: **~50–120**, not 37, and not 735/1,152.

## Renderability criteria (the gate)

A component is instant-app / gallery renderable when all hold:
1. **Has a component export** (default, or named matching the file).
2. **Self-satisfiable data**: either **no required props**, or it is **self-wiring**
   (fetches its own data via `useQuery`/`apiRequest`). Required non-serializable
   props (functions, complex objects) ⇒ exclude.
3. **No route dependency**: does not call `useParams`/`useRoute` (route context).
4. **Not a bare primitive**: exclude `components/ui/*` shadcn primitives.
5. **Approved**: `isApprovedForAssembly` — auto-true when 1–4 hold and props are all
   optional/self-wiring; otherwise flagged for review.

## Proposed architecture

Extend `sync-component-index.ts` from a single-dir scan into a **multi-root,
recursive AST indexer**:

1. **Roots (configured allowlist), recursive:** `core/ui/components/packaged`,
   `**/components/widgets`, `packages/design-system/src/components`, and explicitly
   opted-in block dirs. (Not `**/pages`, not `components/ui` primitives.)
2. **Per file (TypeScript AST — reuse the existing `ts.createSourceFile` logic):**
   extract the exported component name + export type; extract the `Props` interface
   into `propSchema` (name → type, required/optional); detect self-wiring
   (data-hook usage) and route dependency; compute a content hash for change
   detection.
3. **Gate + write:** apply the renderability criteria; upsert into `component_index`
   with `isApprovedForAssembly` set by the gate; set category from the dir/heuristics.
4. **Freshness:** run in CI or a nightly job (like the eval gate), and via
   `npm run component-index:sync`, so the library tracks the code instead of drifting
   (recall we just found + deleted 8 phantom rows).

## Phasing

- **Phase A (small):** make `sync-component-index` recurse and scan the packaged +
  widget roots. Turns today's hardcoded harvest into a real scan; picks up the 35
  packaged blocks + the widget dirs automatically. Immediately grows the honest,
  self-maintaining set.
- **Phase B (medium):** add the AST renderability classifier + approval gate to admit
  self-wiring domain blocks from broader roots, with a review queue for borderline
  ones. This is where the set grows toward ~50–120.
- **Phase C:** `propSchema` quality — extract real prop types + defaults so
  `render_instant_app`'s prop validation (and Forge synthesis) get accurate
  interfaces, and flag required-prop blocks that need explicit args.

## Risks / open questions

- **Sub-component false positives** — a "component export with no route hooks" is not
  the same as "renders usefully alone." The gate (required-props + self-wiring) is the
  main mitigation; Phase B needs a human/AI review step for borderline admits.
- **Self-wiring blocks that assume context** (org, auth, a provider) may still throw
  when mounted bare — the instant-app/gallery error boundary already degrades these
  gracefully, but they shouldn't be auto-approved.
- **`propSchema` fidelity** — the current extractor captures interface members as raw
  type strings; instant-app prop validation wants required/optional + serializability.
- **Category assignment** — today it's hardcoded; derive from directory/domain or an
  LLM pass.

## Recommendation

Do **Phase A** first — it's a contained change to one script that replaces the
hardcoded harvest with a real recursive scan of the block roots, and makes the
library self-maintaining. Evaluate the resulting set, then decide on Phase B's
broader admission with the renderability classifier. Do **not** attempt to index all
~1,150 files — pages and sub-components aren't standalone-renderable, and indexing
them would pollute the gallery and instant apps with things that can't render.
