/**
 * Codegen Pipeline Workbench — UI module barrel.
 *
 * Public entry point for the workbench frontend (types, hooks, components, pages).
 * Populated wave-by-wave per the implementation plan:
 *   - Wave 1 (done): types
 *   - Wave 2: hooks        (./modules/hooks)
 *   - Wave 3: components   (./modules/components)
 *   - Wave 4: pages        (./modules/pages)
 */

export type * from "./modules/types/index.js";
export * from "./modules/hooks/index.js";
export * from "./modules/components/index.js";
export * from "./modules/pages/index.js";
