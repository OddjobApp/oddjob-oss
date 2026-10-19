# Platform Maintenance Progressions (Items 2, 3, 4)

> **Feature Status:** Level 4 / Level 5 Production-Grade  
> **Module Path:** `server/domain/admin/`, `server/domain/audit/`, `server/domain/evolution/`  
> **API Base Route:** `/api/oddjob/admin`, `/api/oddjob/audit`, `/api/oddjob/evolution`

---

## Overview

This documentation covers the three matured **Platform Maintenance** services:
1. **Documentation Freshness & Live Doctest Verifier** (Level 3 → Level 4/5)
2. **Software Audit & Zero-Touch Deployment Gate** (Level 4 → Level 5)
3. **Governed Bayesian A/B Testing Engine for System Evolution** (Level 3 → Level 4/5)

---

## Core Services

### 1. Documentation Freshness & Live Doctest Verifier
- **Service:** [doctest-verifier.service.ts](../../server/domain/admin/infrastructure/doctest-verifier.service.ts)
- **Capabilities:** Parses embedded TSDoc and Markdown code blocks in `docs/` and verifies AST validity against runtime symbol exports. Computes Documentation Freshness Score (% passing doctests).

### 2. Software Audit Zero-Touch Deployment Gate
- **Service:** [zero-touch-audit-gate.service.ts](../../server/domain/audit/zero-touch-audit-gate.service.ts)
- **Capabilities:** Performs predictive zero-day vulnerability scanning against dependency manifests and AST patch verification against CycloneDX SBOM attestation signatures. Enforces zero-touch deployment sign-off gates.

### 3. Governed Bayesian A/B Testing Engine for System Evolution
- **Service:** [bayesian-ab-testing.service.ts](../../server/domain/evolution/core/bayesian-ab-testing.service.ts)
- **Capabilities:** Evaluates Beta-Binomial conjugate posterior distributions comparing control deployment topologies against candidate evolution waves. Triggers automated zero-downtime canary promotion when $P(\text{Variant} > \text{Control}) \ge 95\%$ ($N \ge 50$).

---

## API Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/api/oddjob/admin/doctest/verify` | `POST` | Triggers live doctest verification and calculates documentation freshness score. |
| `/api/oddjob/audit/zero-touch-gate` | `POST` | Evaluates software audit security patches and SBOM compliance for zero-touch deployment approval. |
| `/api/oddjob/evolution/ab-test/evaluate` | `POST` | Computes Bayesian A/B posterior win probabilities for rollout topologies. |
