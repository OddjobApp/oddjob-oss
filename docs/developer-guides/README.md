# Oddjob Developer Guides & Best Practices Index

This directory contains official engineering guidelines, architectural standards, and operational runbooks for contributors and agents building in the Oddjob ecosystem.

---

## 🧭 Domain & Sub-Domain Architecture Map

- **[Domain & Sub-Domain Best Practices Taxonomy](./DOMAIN_TAXONOMY_AND_BEST_PRACTICES.md)**:
  - Canonical mapping of all 66 server domains, sub-domains, and client modules into 7 functional clusters.
  - File prefix quick-lookup for agents (`spatial`, `knowledge`, `governance`, `packaged`, etc.).
  - Database tables, bound capabilities, and mandatory verification gates per domain.

---

## 🎨 UI, Styling & Design System

1. **[Dual-Theme Token & Styling Guide](./THEME_AND_TOKEN_SYSTEM.md)**:
   - Semantic tokens (`bg-card`, `bg-muted`, `border-border`, `text-foreground`).
   - Saturated accent pairings and light/dark mode contrast rules.
   - Passing the `npm run lint:theme` regression gate.
2. **[Component Authoring & Verification Guide](./COMPONENT_AUTHORING_AND_VERIFICATION.md)**:
   - Conventions for packaged domain pods (`forge-ui`) and design system primitives (`@oddjob/design-system`).
   - Dual-export contracts, automated indexing (`npm run component-index:sync`), and headless smoke testing (`npm run components:verify`).
3. **[Formal Layout & WCAG Mathematical Verification Guide](./FORMAL_LAYOUT_AND_WCAG_VERIFICATION.md)**:
   - Continuous viewport containment proofs via the QF_LRA SMT compiler.
   - Closed-form CSS `clamp()` track allocations.
   - WCAG 2.5.5 ergonomic 48px hitbox constraints.

---

## 🤖 Agent Architecture & Autonomy

4. **[Agent Autonomy & Evolution Engineering Guide](./AGENT_AUTONOMY_AND_EVOLUTION.md)**:
   - The 5-Layer Governed AI Control Plane.
   - Autonomy Levels (L1 Assisted to L5 Full Autonomy).
   - Evo-Devo Self-Improvement Tiers (Directive Patch, Golden Samples, LoRA Fine-Tuning) and Canary Sandboxing.
5. **[Agent Tool Authoring & Idempotency Classification Guide](./TOOL_AUTHORING_AND_IDEMPOTENCY.md)**:
   - The Idempotency Triad (`read-safe`, `idempotent`, `side-effecting`).
   - JSON Schema / TypeBox contracts and W3C distributed traceparent propagation.
   - Passing `npm run check:tool-idempotency`.

---

## 🏛️ Backend, Routing & Data Layer

6. **[Deep Module Architecture & Routing Guardrails](./DEEP_MODULE_ARCHITECTURE.md)**:
   - Thin Express route handlers vs deep domain services.
   - Zod schema validation and prohibited anti-patterns.
   - Zero-warning architectural linting (`npm run lint:arch`).
7. **[Database Schema & Zero-Downtime Migration Guide](./DATABASE_MIGRATION_GUIDE.md)**:
   - Safe Drizzle schema updates and zero schema drift (`npm run check:schema-drift`).
   - Migration journal integrity (`npm run check:migration-journal`).
   - Accidental Data Loss Prevention standards.
8. **[Knowledge Graph & RAG Vector Hygiene Guide](./KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md)**:
   - Relational graph and Qdrant semantic vector integration.
   - Ingestion chunking standards, multi-tenant isolation, and vector poisoning defenses.

---

## 📡 Telemetry, Testing & Onboarding

9. **[Real-Time Telemetry & Spatial Streams Guide](./REALTIME_TELEMETRY_AND_STREAMS.md)**:
   - Universal Event Envelope (UEE) specification.
   - Eulerian Hexagonal (Uber H3) geospatial indexing.
   - High-throughput WebSocket buffering and stream throttling.
10. **[E2E Playwright & Synthetic Verification Guide](./E2E_PLAYWRIGHT_TESTING.md)**:
    - Flake-free Playwright locators and assertions.
    - Testing Human-in-the-Loop (HIL) ratification workflows.
    - Automated test fixture management and demo recordings.
11. **[S.C.O.R.E. Interactive Walkthrough Authoring Runbook](../tutorials/SCORE_AUTHORING_RUNBOOK.md)**:
    - Step-by-step authoring of guided onboarding tours.
    - Stable `data-tutorial` anchoring and cross-route transitions.
    - Automated drift verification (`npm run test:drift`).
