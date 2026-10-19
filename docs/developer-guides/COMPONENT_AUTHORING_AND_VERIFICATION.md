# Component Authoring & Verification Guide

This guide establishes the development standard for UI blocks, packaged domain pods, and shared design system components in Oddjob. Adherence to these practices ensures full interoperability with the SDLC App Forge, the Component Style Gallery, and the automated verification harness (`npm run components:verify`).

---

## 1. Component Architecture & Storage Roots

Oddjob categorizes reusable UI into two managed roots scanned by the automatic indexer:

1. **Packaged Domain Blocks (`forge-ui`)**:
   - Location: [`server/domain/core/ui/components/packaged/`](../../server/domain/core/ui/components/packaged)
   - Purpose: Complex, autonomous domain pods (e.g. `ToolScaffoldPod`, `DecisionMatrixPod`, `AppArchitecturePlanPod`).
   - Import Alias: `@domain-ui/packaged/*`.
2. **Design System Primitives (`@oddjob/design-system`)**:
   - Location: [`packages/design-system/src/components/`](../../packages/design-system/src/components)
   - Purpose: Low-level atomic layout engines and data presentation primitives (`FormalLayout`, `MetricSummaryCard`).
   - Import Alias: `@oddjob/design-system`.

---

## 2. Export & Naming Conventions

The component indexer (`scripts/sync-component-index.ts`) resolves components by parsing export signatures on disk.

### Critical Rules:
1. **Name Matching**: The component name must match the file basename in PascalCase (e.g. `FormalLayout.tsx` must export `FormalLayout`).
2. **Dual Export Pattern**: Always provide both a named export and a default export for maximum consumer flexibility:
   ```tsx
   // packages/design-system/src/components/FormalLayout.tsx
   export const FormalLayout: React.FC<FormalLayoutProps> = (props) => { ... };
   export default FormalLayout;
   ```
3. **Display Name vs Symbol**: The Component Index will de-space display names (e.g. `"Formal Layout"` looks for export symbol `FormalLayout` or `Formal Layout`).

---

## 3. Defensive Headless SSR Props Contract

The Component Verification Harness (`npm run components:verify`) smoke-renders every indexed component in a headless Node SSR environment using synthesized mock props based on TypeScript prop schemas.

To prevent verification failures:
1. **Never Assume Nested Properties on Objects**: Always guard deep property access:
   ```tsx
   // ❌ Fragile: throws if catalog or plan is undefined
   const selection = catalog[plan.archetype];
   const layoutName = selection.layout.replaceAll("_", " ");

   // ✅ Resilient: safely defaults
   const safePlan = plan || { archetype: "default", appName: "App" };
   const safeCatalog = catalog || {};
   const selection = safeCatalog[selected] || { layout: "default", surfaces: [] };
   const label = (v?: string) => (v || "").replaceAll("_", " ");
   ```
2. **Never Directly Access Browser Globals at Root Render**:
   - Wrap `window`, `document`, and `localStorage` checks inside `useEffect` or check `typeof window !== "undefined"`.
   - Routing hooks like `useLocation()` from `wouter` should be evaluated within routing boundaries or protected with fallbacks.

---

## 4. Registering & Verifying New Components

When introducing a new packaged pod or primitive:

```bash
# 1. Synchronize the component index database with files on disk
npm run component-index:sync

# 2. Test-mount the component in the verification harness
npm run components:verify -- --filter "MyNewComponent"

# 3. Dry-run verify all components without persisting scores
npm run components:verify -- --dry-run

# 4. Record successful verification outcomes in the database
npm run components:verify
```

### Verification States:
- **`✅ Passed`**: Module resolved, exported callable component, and mounted without throwing. Scores updated to 100% success rate.
- **`— Skipped`**: Unmeasurable in Node due to pure bundler assets (CSS Modules, stylesheets). Skips do NOT break CI builds.
- **`✗ Failed`**: Uncaught runtime throw or missing export. Fails CI with exit code 1.
