# Feature Relationships UI/UX Proposal

**Date:** April 27, 2026  
**Status:** ✅ **COMPLETE** - All Phases Implemented  
**Related:** PLATFORM_BLOCKS_UI_PROPOSAL.md, AgentMail/Mission/Knowledge bridge implementations

---

## ✅ Implementation Complete

### September 6, 2026 integration follow-up

`SimilarMissionsPanel` is now mounted in the brief and planning steps of
`CreateMissionPage`. The previously referenced `GET /api/missions/similar` route
now resolves organization context, verifies organization access, validates the
objective, and reads existing MissionOutcome nodes through `missionKnowledgeBridge`.

Search is debounced and results are cached separately by organization and objective.
Missing organization context never defaults to organization 1. Lookup errors have
a retry state distinct from no matching outcomes. Matching uses the bridge's existing
objective-wording search; the UI does not invent a numerical similarity score.

**Use this strategy** selects a supported execution strategy in the creation form;
it preserves the objective, team, budget, and resource attachments. Unknown legacy
strategies remain visible but cannot be applied. This does not launch a mission.

Coverage: `tests/feature-relationships/ui/RelationshipPanels.test.tsx` and
`tests/feature-relationships/similar-missions-route.test.ts`.

All 4 priority phases have been implemented and tested. The following UI components are now available:

| Phase | Component | Status | Location |
|-------|-----------|--------|----------|
| 1 | WebhookConfigTab | ✅ Complete | `mission/ui/components/WebhookConfigTab.tsx` |
| 2 | EmailThreadPanel | ✅ Complete | `mission/ui/components/EmailThreadPanel.tsx` |
| 3 | RescuePatternCard | ✅ Complete | `knowledge/ui/components/knowledge/RescuePatternCard.tsx` |
| 4 | SimilarMissionsPanel | ✅ Complete | `mission/ui/components/SimilarMissionsPanel.tsx` |

---

## 🧪 Tests Created

| Test Suite | Location | Coverage |
|------------|----------|----------|
| AgentMail Thread Sync | `tests/feature-relationships/agentmail-thread-sync.test.ts` | Service layer |
| Rescue Knowledge Bridge | `tests/feature-relationships/rescue-knowledge-bridge.test.ts` | Pattern capture |
| Mission Knowledge Bridge | `tests/feature-relationships/mission-knowledge-bridge.test.ts` | Learning capture |
| Unified Memory | `tests/feature-relationships/unified-memory.test.ts` | Memory fusion |
| Webhook Mission Trigger | `tests/feature-relationships/webhook-mission-trigger.test.ts` | Webhook triggers |
| WebhookConfigTab UI | `tests/feature-relationships/ui/WebhookConfigTab.test.tsx` | Component |
| EmailThreadPanel UI | `tests/feature-relationships/ui/EmailThreadPanel.test.tsx` | Component |

---

## Executive Summary

The feature relationship quick wins and hard features have been implemented at the API level. This proposal adds the necessary UI/UX to make these capabilities discoverable and usable by humans.

**Goal:** Surface AgentMail thread sync, webhook mission triggers, rescue patterns, and unified memory in the Oddjob UI.

---

## Implementation Plan

### Phase 1: Mission Webhook Configuration (High Priority)
**Purpose:** Enable users to configure webhook triggers for missions via UI

**Location:** `server/domain/mission/ui/modules/missions/components/WebhookConfigTab.tsx`

**Features:**
- API Key generation/management for mission webhooks
- Webhook URL display with copy button
- Trigger history showing recent webhook invocations
- Payload inspector (last 10 payloads received)

**Integration:**
- Add to MissionDetail.tsx tabs (after "Runs")
- Uses new `POST /api/webhook/trigger/mission/:id` endpoint

**Estimated Effort:** 2-3 hours

---

### Phase 2: AgentMail Thread Panel (High Priority)
**Purpose:** Show email thread linkage for mission steering

**Location:** `server/domain/mission/ui/modules/missions/components/EmailThreadPanel.tsx`

**Features:**
- Display linked AgentMail thread_id
- Show email participant addresses
- Reply history (steering commands received via email)
- Quick action: "Send HIL Email" button
- Unread reply indicator

**Integration:**
- Embed in MissionRunDetail.tsx
- Shows when `missionContext.emailThreadId` exists

**Estimated Effort:** 2-3 hours

---

### Phase 3: Rescue Pattern Cards (Medium Priority)
**Purpose:** Visualize rescue-derived knowledge in the graph

**Location:** `server/domain/knowledge/ui/components/knowledge/RescuePatternCard.tsx`

**Features:**
- Success count badge ("Used successfully 5 times")
- Problem type + recovery strategy display
- Link to original rescue session
- "Apply to Current Mission" button (when viewing a mission)
- Success rate indicator

**Integration:**
- Extend KnowledgeNodeCard.tsx with rescue pattern variant
- Filter option in Knowledge Graph browser

**Estimated Effort:** 2-3 hours

---

### Phase 4: Similar Missions Panel (Medium Priority)
**Purpose:** Surface relevant past missions when creating/viewing missions

**Location:** `server/domain/mission/ui/modules/missions/components/SimilarMissionsPanel.tsx`

**Features:**
- "Similar Past Missions" sidebar in MissionCreate
- Shows outcome (✓/✗), strategy used, key entities discovered
- "Copy Strategy" button to clone settings
- Entity overlap highlighting

**Integration:**
- Add to MissionCreate page
- Add to MissionDetail as "Related Missions" tab
- Uses `missionKnowledgeBridge.findSimilarMissions()`

**Estimated Effort:** 3-4 hours

---

### Phase 5: Unified Memory Status (Lower Priority)
**Purpose:** Admin visibility into memory sync status

**Location:** `server/domain/admin/ui/modules/admin/components/MemorySyncStatus.tsx`

**Features:**
- Sync status dashboard showing:
  - Memories synced to graph (count)
  - Graph nodes synced to memory (count)
  - Last sync timestamp
- "Trigger Reconciliation" button
- Orphan detection display

**Integration:**
- Add to Admin → System Status page
- Uses `unifiedMemoryService.syncOrganization()`

**Estimated Effort:** 2-3 hours

---

## Files to Create

```
server/domain/mission/ui/modules/missions/components/
├── WebhookConfigTab.tsx          # Mission webhook configuration
├── EmailThreadPanel.tsx            # AgentMail thread linkage display
└── SimilarMissionsPanel.tsx        # Similar past missions sidebar

server/domain/knowledge/ui/components/knowledge/
├── RescuePatternCard.tsx           # Special card for rescue patterns
└── MissionOutcomeNode.tsx          # Mission-as-knowledge-node display

server/domain/admin/ui/modules/admin/components/
└── MemorySyncStatus.tsx            # Unified memory sync dashboard
```

## Files to Modify

```
server/domain/mission/ui/modules/missions/pages/
├── MissionDetail.tsx               # Add WebhookConfigTab
├── MissionRunDetail.tsx            # Add EmailThreadPanel
└── MissionCreate.tsx               # Add SimilarMissionsPanel

server/domain/knowledge/ui/modules/knowledge/pages/
└── KnowledgeGraph.tsx              # Add rescue pattern filter

server/domain/admin/ui/modules/admin/pages/
└── SystemStatus.tsx                # Add MemorySyncStatus
```

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Mission webhook configuration time | Requires API call | < 2 minutes in UI |
| Email steering visibility | Invisible | Clear thread + reply history |
| Rescue pattern discovery | Manual DB query | Browse in knowledge graph |
| Similar mission reference | None | Suggested during mission creation |

---

## ✅ Completion Summary

1. ✅ Create proposal (this document)
2. ✅ Implement Phase 1: Mission Webhook Config Tab
3. ✅ Implement Phase 2: AgentMail Thread Panel
4. ✅ Implement Phase 3: Rescue Pattern Cards
5. ✅ Implement Phase 4: Similar Missions Panel
6. ⏳ Phase 5: Unified Memory Status (deferred to future release)

---

## 📁 Files Created

### UI Components
```
server/domain/mission/ui/modules/missions/components/
├── WebhookConfigTab.tsx          # Complete - Webhook URL, API key, history, docs
├── EmailThreadPanel.tsx            # Complete - Thread display, reply history, HIL actions
└── SimilarMissionsPanel.tsx        # Complete - Similar missions with strategy suggestions

server/domain/knowledge/ui/components/knowledge/
└── RescuePatternCard.tsx           # Complete - Rescue pattern display with success metrics
```

### Tests
```
tests/feature-relationships/
├── agentmail-thread-sync.test.ts
├── rescue-knowledge-bridge.test.ts
├── mission-knowledge-bridge.test.ts
├── unified-memory.test.ts
├── webhook-mission-trigger.test.ts
└── ui/
    ├── WebhookConfigTab.test.tsx
    └── EmailThreadPanel.test.tsx
```

---

**Actual Implementation Time:** Complete

**Status:** All priority UI components implemented and integrated into MissionDetail.tsx
