# Capability Proposals & Autonomous Platform RFC Engine (Level 4 Delegated / Production)

> **Feature Status:** Level 4 (Delegated / Production)  
> **Module Path:** `server/domain/capabilities/`  
> **API Base Route:** `/api/oddjob/capabilities`

---

## Overview

The **Capability Proposals & Autonomous Platform RFC Engine** automates tool gap discovery, synthetic priority scoring, vector duplicate risk detection, and technical platform RFC document compilation (`PLATFORM_RFC_<id>.md`) for governance review.

---

## Core Capabilities

### 1. Synthetic Gap Prioritization Engine
- **Service:** [capability-gap-prioritizer.service.ts](../../server/domain/capabilities/core/capability-gap-prioritizer.service.ts)
- **Description:** Ranks capability proposals based on agent task execution gap frequency, confidence ratings, developer votes, and vector similarity duplicate risk detection ($P = \text{confidence} \times 0.4 + \text{failureCount} \times 12 + \text{votes} \times 8$).

### 2. Autonomous Platform RFC Synthesizer
- **Service:** [platform-rfc-synthesizer.service.ts](../../server/domain/capabilities/core/platform-rfc-synthesizer.service.ts)
- **Description:** Auto-compiles formal technical platform RFC markdown documents (`docs/platform-rfcs/PLATFORM_RFC_<id>.md`) with complete JSON Tool Manifest specs, synthetic regression benchmark plans, and governance consensus sign-off checklists.

---

## API Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/api/oddjob/capabilities/proposals/prioritize` | `GET` | Ranks and returns prioritized capability proposals for an organization. |
| `/api/oddjob/capabilities/proposals/:id/synthesize-rfc` | `POST` | Compiles and publishes a technical platform RFC markdown document. |
