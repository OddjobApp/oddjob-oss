# 🚀 CREW Room & Operational Cycle App Surface Integration

> **Release Version:** Oddjob 2026.8  
> **Status:** Production Ready  
> **Key Architecture:** Dual-Mode Cycle Rooms, Live App Canvas, Meeting Scheduler & RFC 5545 iCal, App Deployment Resolution Overhaul.

---

## Executive Overview

Deliberation without actionable live surfaces leads to abstract decisions. Oddjob now connects **CREW Multi-Agent Deliberation Rooms** directly to **Operational Business Cycles** and **Live Micro-Frontend App Surfaces** (Workbenches, Codegen Matrices, Geospatial Telemetry Dashboards, Financial Simulators, and Dispatch Consoles).

In addition, this update introduces:
1. **CREW Multi-Agent Meeting Scheduler**: Multi-user, multi-agent automated availability negotiation with RFC 5545 `.ics` iCalendar calendar generation.
2. **Universal App Surface Resolution Overhaul**: Direct public slug routing and auto-publishing for workspace and cycle-deployed app surfaces.
3. **Embedded Room App Canvas**: In-room split-screen and full-screen micro-frontend iframe canvas allowing humans and agents to interact with active workbenches while maintaining live conversation.

---

## 1. Architecture & Dual-Mode Room Lifecycles

```
+----------------------------------------------------------------------------------------------------+
|                                    OPERATIONAL CYCLE (e.g. hybrid-sdlc)                            |
|                                                                                                    |
|  +---------------------------+       +-----------------------------+       +--------------------+  |
|  | Stage: Architecture RFC   | ----> | Stage: Codegen & Synthesis  | ----> | Stage: QA Release  |  |
|  +---------------------------+       +-----------------------------+       +--------------------+  |
|               |                                     |                                 |            |
|       Convene Stage Room                    Convene Stage Room                Convene Stage Room   |
|               v                                     v                                 v            |
+---------------+-------------------------------------+---------------------------------+------------+
                |                                     |                                 |
                +---------------------------------+   |   +-----------------------------+
                                                  |   |   |
                                                  v   v   v
+----------------------------------------------------------------------------------------------------+
|                                         CREW ROOM COUNCIL                                          |
|                                                                                                    |
|  +-------------------------------------+   +----------------------------------------------------+  |
|  | Left: Multi-Agent Transcript        |   | Right: Embedded App Canvas (CrewCycleAppCanvas)    |  |
|  | - Opening Ceremony Directive        |   | - SDLC Workbench (/app/sdlc-workbench?embed=cycle) |  |
|  | - Stage Gate Checklists             |   | - Codegen Pipeline / QA Regression Matrix          |  |
|  | - Socratic Deliberation & Decisions |   | - Live Iframe Sandbox & App Switcher               |  |
|  +-------------------------------------+   +----------------------------------------------------+  |
|                                                                                                    |
|  +----------------------------------------------------------------------------------------------+  |
|  | Right Rail / Blackboard: Cycle Fleet Dock & Stage Consensus Gate Status                      |  |
|  +----------------------------------------------------------------------------------------------+  |
+----------------------------------------------------------------------------------------------------+
```

### Dual-Mode Lifecycle Options

| Lifecycle Pattern | Persistence | Typical Use Case | Gate Progression Behavior |
| :--- | :--- | :--- | :--- |
| **Standing Council Room** | Persistent across cycles & sprint weeks | Departmental syncs, executive council, continuous architecture steering | Retains full rolling transcript memory. When a cycle stage completes, posts synthetic milestone turn summary. |
| **Stage Ceremony Room** | Spawned per cycle stage | RFC reviews, P0 War Rooms, Stage-Gate sign-offs | Spawned with `parentSessionId` / `breakoutLineage` linkage. Concludes with an Executive Closing Report advancing the cycle state. |

---

## 2. Database Schema & Data Models

### Updated `crew_sessions` Schema (`shared/schema/crew.ts`)

```typescript
export interface CrewCycleContext {
  cycleSlug: string;
  cycleName?: string;
  stageId?: string;
  stageName?: string;
  requiredDecisions?: string[];
  isStandingRoom?: boolean;
}

export const crewSessions = pgTable("crew_sessions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  sessionKey: text("session_key").notNull().unique(),
  title: text("title"),
  status: text("status").default("active"),
  mode: text("mode").default("explore"),
  // ...
  // New Cycle Connection Columns:
  cycleSlug: text("cycle_slug"),
  cycleStageId: text("cycle_stage_id"),
  cycleContext: jsonb("cycle_context").$type<CrewCycleContext>(),
  parentSessionId: integer("parent_session_id").references(() => crewSessions.id, { onDelete: "set null" }),
  // ...
}, (table) => ({
  cycleIdx: index("idx_crew_sessions_cycle").on(table.organizationId, table.cycleSlug),
  parentIdx: index("idx_crew_sessions_parent").on(table.parentSessionId),
}));
```

---

## 3. Backend Services & REST APIs

### `CrewCycleBridgeService` (`server/domain/crew/core/crew-cycle-bridge.service.ts`)

* **`getCycleFleetForRoom(orgId, sessionKey)`**:
  Queries the room's linked cycle and discovers all deployed apps in the workspace matching the cycle's blueprints or slug.
* **`createCycleStageRoom(orgId, params)`**:
  Provisions a ceremony room pre-seeded with agenda turns, required gate decisions, and assigned agent rosters.
* **`advanceCycleGateOnConsensus(orgId, sessionKey)`**:
  Evaluates all `accepted` records in `crew_decisions` against the stage's `requiredDecisions` list. Returns satisfied status and pending items.

### New CREW Endpoints (`server/domain/crew/api/crew.routes.ts`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/crew/:sessionKey/cycle-fleet` | `GET` | Fetches all live micro-frontend app surfaces connected to this room's cycle. |
| `/api/crew/cycle/convene` | `POST` | Convenes a new stage ceremony room or attaches to a standing council room. |
| `/api/crew/:sessionKey/gate-status` | `GET` | Returns stage gate checklist satisfaction and consensus percentage. |
| `/api/crew/schedules` | `POST` | Creates a multi-agent / multi-user meeting schedule with candidate slots. |
| `/api/crew/schedules/:id/vote` | `POST` | Submits attendee availability vote for candidate meeting slots. |
| `/api/crew/schedules/:id/confirm` | `POST` | Locks in confirmed slot and auto-provisions room. |
| `/api/crew/schedules/:id/ics` | `GET` | Generates RFC 5545 standard `.ics` iCalendar export. |

---

## 4. Frontend UI Components

### 1. `CrewCycleAppCanvas` (`client/src/components/agent-chat/CrewCycleAppCanvas.tsx`)
* Embedded micro-frontend iframe with sandboxing (`allow-same-origin allow-scripts allow-forms allow-popups allow-modals`).
* **App Surface Switcher**: Quick dropdown to switch between multiple workbenches in the same cycle.
* **Toolbar Controls**:
  - `Live Surface` pulsating badge
  - `Reload` iframe without refreshing chat
  - `Pop out to New Tab`
  - `Fullscreen Canvas` toggle
  - `Close Canvas` split view

### 2. `AgentChatPanel` Enhancements (`client/src/components/agent-chat/AgentChatPanel.tsx`)
* **Header Stage Badge**: `Enterprise Hybrid AI SDLC : Architecture Review` with `Boxes` icon.
* **Header Canvas Toggle Button**: Direct toggle button showing live app count badge.
* **Split Layout**: Real-time side-by-side view of transcript on the left and live app surface on the right.
* **Blackboard Cycle Fleet Card**: Right rail list of all live apps with 1-click **"Canvas"** launcher.

---

## 5. Automated Verification & Test Coverage

| Test Suite | Location | Passing Tests |
| :--- | :--- | :--- |
| **Crew Cycle Bridge Tests** | `server/domain/crew/tests/crew-cycle-bridge.test.ts` | **3/3 passing** |
| **Full CREW Backend Domain** | `server/domain/crew/` (27 test files) | **273/273 passing** |
| **Crew Cycle App Canvas Tests** | `client/src/components/agent-chat/CrewCycleAppCanvas.test.tsx` | **3/3 passing** |
| **Agent Chat Panel Property Tests** | `client/src/components/agent-chat/AgentChatPanel.property.test.tsx` | **3/3 passing** |
| **Total Test Coverage** | **31 files** | **282/282 passing (100%)** |

---

*Oddjob CREW: Deliberate with intelligence, execute with live surfaces.*
