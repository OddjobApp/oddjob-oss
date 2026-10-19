# App Forge Mach 4.0: Deterministic Assembly Architecture

## Overview
Mach 4.0 transitions App Forge from a **Generative Probability Engine** (where AI writes code from scratch) to a **Deterministic Assembly Engine** (where AI selects and configures pre-built industrial blocks).

This shift improves forge velocity by **10x** and structural stability to **~100%**.

---

## 🏗️ The Four Layers

### 1. Deterministic Scaffolding
Blueprints are no longer just "folders." They are **Slotified Templates** pre-loaded into Redis.
- **Service**: `ForgeScaffoldCacheService`
- **Mechanism**: On server boot, all blueprints are snapshotted and cached.
- **Benefit**: Zero-latency blueprint retrieval; no disk I/O during the forge mission.

### 2. Industrial Block Registry
A curated catalog of high-fidelity, build-tested React components.
- **Manifest**: `block-registry.json`
- **Components**: Located in `@domain-ui/packaged` (e.g., `MetricGrid`, `IndustrialDashboardHero`).
- **AI Integration**: The registry is injected into the AI Architect's prompt, turning the coding task into a **Configuration Task**.

### 3. Shadow Evaluation Pipeline
A background benchmarking system that runs "Challenger" models in parallel with the live forge.
- **Service**: `ForgeShadowService`
- **Scoring**: `ForgeWowService` calculates a **WOW Score (0-100)** based on glassmorphism, animations, and component richness.
- **Observability**: Comparison results are stored in Redis (`forge:shadow:result:*`).

### 4. Automated Evolution
The "Brain" that learns which assembly patterns perform best.
- **Service**: `ForgeEvolutionService`
- **Promotion**: If a shadow assembly consistently outperforms the live model, the system logs an "Evolution Finding" and promotes that pattern as the new system default.

---

## 🚀 Multi-Domain Expansion Roadmap

To maintain the "Lovable Speed" benchmark, the Block Registry must expand beyond Dashboards:

| Domain | Block Category | Key Components |
| :--- | :--- | :--- |
| **Communication** | `communication` | `AIAgentChat`, `NotificationFeed`, `SuggestedActions` |
| **Geospatial** | `geospatial` | `TacticalMapControl`, `TelemetryMarker`, `GeofenceEditor` |
| **Ops & Control** | `monitoring` | `MissionStatusTimeline`, `HILApprovalConsole`, `LogStreamer` |
| **Mobile Native** | `mobile` | `BottomTabNav`, `GestureCardStack`, `BiometricAuthLock` |

---

## 🛠️ Key Services & Files

| Component | Path | Description |
| :--- | :--- | :--- |
| **Orchestrator** | `forge-codegen.service.ts` | The central glue for slot-fill and registry injection. |
| **Registry** | `block-registry.json` | The catalog of available assembly blocks. |
| **Scoring** | `forge-wow.service.ts` | Numerical aesthetic validator. |
| **Shadow** | `forge-shadow.service.ts` | Background benchmarking engine. |
| **Evolution** | `forge-evolution.service.ts` | Pattern analysis and promotion logic. |

---

## 🚦 Operational Commands

### Warming the Cache
The cache warms automatically at boot, but can be manually triggered:
```bash
npx tsx scratch/verify_cache_warm.ts
```

### Running a Benchmark
To check the current shadow performance leaderboard:
```typescript
const stats = await forgeEvolutionService.analyzeShadowPerformance();
console.log(stats);
```
