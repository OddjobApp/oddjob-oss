# Formal Layout & WCAG Mathematical Verification Guide

Oddjob incorporates formal methods into front-end application assembly. Through the **QF_LRA SMT Compiler** and the **Design System Layout Primitives**, Oddjob mathematically proves that generated user interfaces never suffer from horizontal overflow, touch target truncation, or contrast failures across arbitrary viewports ($W \in [320\text{px}, 2560\text{px}]$).

---

## 1. Why Formal Methods in UI Assembly?

In standard web development, responsive interfaces are tested at a handful of discrete breakpoints (e.g. 375px, 768px, 1200px). This frequently allows layout bugs (horizontal scrollbars, overlapping cards, clipped touch targets) to escape at intermediate screen sizes.

Oddjob replaces breakpoint guesswork with **First-Order Logic (Quantifier-Free Linear Real Arithmetic / QF_LRA)** to prove layout correctness before an application is forged.

---

## 2. Mathematical Layout Invariants

The layout engine verifies 3 core invariant classes:

### Invariant 1: Continuous Viewport Containment
For every viewport width $W \in [W_{\min}, W_{\max}]$, the total rendered width of any horizontal container $\sum w_i$ must not exceed $W$:
$$\forall W \in [320, 2560], \quad \sum_{i=1}^{n} w_i(W) + (n-1) \cdot \text{gap} \le W$$

### Invariant 2: WCAG 2.5.5 Ergonomic Touch Target Minimum
Interactive elements (buttons, inputs, links) must provide a minimum bounding target size of $48\text{px} \times 48\text{px}$ to prevent mis-clicks on mobile and tablet touchscreens:
$$\forall t \in \text{TouchTargets}, \quad \text{width}(t) \ge 48\text{px} \land \text{height}(t) \ge 48\text{px}$$

### Invariant 3: Closed-Form CSS `clamp()` Track Sizing
Grid tracks synthesize mathematical fluid clamp formulas that dynamically resize without requiring media query step functions:
$$\text{colWidth} = \text{clamp}(C_{\min}, 25\text{vw}, C_{\max})$$

---

## 3. Design System Primitives

The [`@oddjob/design-system`](../../packages/design-system/src/components/FormalLayout.tsx) exports mathematically verified primitives:

### `FormalFlex`
A continuous flexbox container that automatically wraps when child minimum width bounds are reached:
```tsx
import { FormalFlex } from "@oddjob/design-system";

<FormalFlex direction="row" gap={16} minChildWidth={280} wrap={true}>
  <div>Card A</div>
  <div>Card B</div>
</FormalFlex>
```

### `FormalGrid`
A CSS Grid container using closed-form clamp track allocations:
```tsx
import { FormalGrid } from "@oddjob/design-system";

<FormalGrid minColWidth={280} maxColWidth={400} gap={16}>
  <MetricCard />
  <StatusCard />
</FormalGrid>
```

### `ErgonomicTouchTarget`
Enforces the WCAG 48px hitbox constraint on interactive actions:
```tsx
import { ErgonomicTouchTarget } from "@oddjob/design-system";

<ErgonomicTouchTarget minSize={48}>
  <button aria-label="Close panel">
    <X className="h-4 w-4" />
  </button>
</ErgonomicTouchTarget>
```

---

## 4. Verification Suite

Run the formal verification test suite to prove layout schedulability and theorem proofs:

```bash
npm run verify:formal
```
This executes:
* `server/domain/scaffold/formal/tests/formal-layout-engine.test.ts`
* `server/domain/mission/tests/mission-schedulability-prover.test.ts`
* `server/domain/governance/tests/formal-governance.test.ts`
