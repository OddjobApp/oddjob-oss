# Feature Relationships Tests

Test suite for the Feature Relationships implementation covering quick wins and hard features.

## Overview

This directory contains comprehensive tests for all feature relationship implementations:
- AgentMail thread sync with mission context
- Schedules to mission launch
- Webhook to mission triggers
- Rescue to knowledge learning
- Mission to knowledge graph bidirectional sync
- Long-term memory to knowledge graph fusion

---

## Test Structure

```
feature-relationships/
├── README.md                              # This file
├── agentmail-thread-sync.test.ts          # Thread linking and routing
├── rescue-knowledge-bridge.test.ts        # Rescue pattern capture
├── mission-knowledge-bridge.test.ts       # Mission learning capture
├── unified-memory.test.ts                 # LTM + KG fusion
├── webhook-mission-trigger.test.ts        # Webhook triggers
├── slack-integration.test.ts             # Slack conversational integration
├── hil-knowledge-bridge.test.ts          # HIL pattern learning (Quick Win)
├── alert-mission-bridge.test.ts          # Alert-to-rescue automation (Quick Win)
└── ui/
    ├── WebhookConfigTab.test.tsx          # Webhook config UI
    ├── EmailThreadPanel.test.tsx          # Email thread UI
    └── AlertAutoRescueConfig.test.tsx     # Auto-rescue config UI (Quick Win)
```

---

## Backend Service Tests

### agentmail-thread-sync.test.ts
Tests the `AgentMailThreadSyncService`:
- `linkThreadToMission()` - Stores thread-mission associations
- `findMissionByThreadId()` - Retrieves active mission link
- `routeReplyToMission()` - Routes email replies as steering commands
- `unsubscribeFromThread()` - Deactivates thread links

**Coverage:** Thread linking, security (sender verification), mission event emission

---

### rescue-knowledge-bridge.test.ts
Tests the `RescueKnowledgeBridge`:
- `captureSuccessPattern()` - Converts successful rescues to knowledge nodes
- Pattern deduplication and success count incrementing
- `getRescuePatternsForProblem()` - Query patterns by problem type

**Coverage:** Knowledge graph writes, pattern recognition, success metrics

---

### mission-knowledge-bridge.test.ts
Tests the `MissionKnowledgeBridge`:
- `captureMissionLearning()` - Records mission outcomes to knowledge graph
- `getRelevantMissions()` - Semantic search for similar past missions
- `enrichMissionWithKnowledge()` - Adds relevant entities to mission context

**Coverage:** Outcome capture, mission similarity, entity enrichment

---

### unified-memory.test.ts
Tests the `UnifiedMemoryService`:
- `getUnifiedContext()` - Merges LTM and KG results
- Query intent routing (personal vs organizational)
- `query()` - Unified search across both memory systems
- `syncBidirectional()` - Keeps LTM and KG in sync
- `recall()` - Formatted context for AI prompts

**Coverage:** Memory fusion, relevance weighting, bidirectional sync

---

### webhook-mission-trigger.test.ts
Tests the `WebhookService.triggerMission()`:
- Mission launch via webhook endpoint
- API key validation
- Payload passing to mission context
- Error handling for invalid missions/keys

**Coverage:** Webhook security, mission launching, context injection

---

### slack-integration.test.ts
Tests the Slack conversational integration via `ConversationalBridgeService`:
- Intent analysis (LAUNCH_MISSION, QUERY_KNOWLEDGE, GENERAL_CHAT)
- User resolution (platform identity → Oddjob user)
- Thread-based mission routing (Slack thread_ts → mission context)
- Attachment processing (file download → evidence storage)
- Audio transcription (voice → mission objective)
- Connector resolution (active Slack connector lookup)

**Coverage:** Multi-modal input, thread continuity, identity challenge, unified memory

---

### hil-knowledge-bridge.test.ts
Tests the HIL (Human-in-the-Loop) Knowledge Bridge for capturing approval patterns:
- Decision pattern capture (new and existing)
- Context classification (plan approval, dynamic action, etc.)
- Approval likelihood prediction based on history
- Approver pattern retrieval
- Long-term memory storage of decisions

**Coverage:** Organizational learning from HIL decisions, pattern recognition, prediction

---

### alert-mission-bridge.test.ts
Tests the Alert-to-Mission Bridge for automated incident response:
- Alert qualification (severity, category checks)
- Cooldown and rate limiting
- Rescue mission auto-creation
- Triage summary generation
- Service type categorization

**Coverage:** Self-healing automation, proactive incident response, alert correlation

---

## UI Component Tests

### WebhookConfigTab.test.tsx
Tests the mission webhook configuration UI:
- Webhook URL display with copy functionality
- API key generation and regeneration
- Active/inactive status badges
- Trigger history display
- Integration documentation (cURL, JS, GitHub Actions)

**Key Interactions:**
- Copy URL to clipboard
- Generate/regenerate API key
- Send test webhook
- View trigger history

---

### EmailThreadPanel.test.tsx
Tests the AgentMail thread integration UI:
- Setup UI when no thread linked
- Linked thread info display
- Reply history with intent badges (Steer, Approve, Reject)
- New/unread reply indicators
- Send HIL email action
- Unlink thread action
- "Open in AgentMail" external link

**Key Interactions:**
- Send HIL approval email
- View reply history
- Unlink thread
- External link to AgentMail

---

### AlertAutoRescueConfig.test.tsx
Tests the Alert Auto-Rescue Configuration UI:
- Master toggle for enabling/disabling auto-rescue
- Category selection (System Errors, Pipeline Failures, etc.)
- Threshold configuration (min severity, cooldown, rate limits)
- Auto-approval settings with warning display
- Analytics dashboard (stats, success rates, top categories)
- History table with rescue session links

**Key Interactions:**
- Toggle alert categories
- Configure cooldown and rate limits
- Enable/disable auto-approval (with safety warning)
- View auto-rescue statistics
- Browse rescue mission history
- Manual rescue trigger (future)

---

## Running Tests

```bash
# Run all feature relationship tests
npm test -- tests/feature-relationships/

# Run specific test file
npm test -- tests/feature-relationships/agentmail-thread-sync.test.ts

# Run with coverage
npm test -- tests/feature-relationships/ --coverage
```

---

## Test Environment

- **Framework:** Vitest
- **UI Testing:** @testing-library/react with jsdom
- **Mocks:** Services mocked at module level via vi.mock()
- **Database:** Mocked (no real DB calls in unit tests)

---

## Integration Test Notes

For integration testing with real services:
1. Set `INTEGRATION_TEST=true` environment variable
2. Ensure test database is available at `postgresql://postgres:postgres@127.0.0.1:5433/oddjob`
3. Use `beforeAll` to seed test data, `afterAll` to clean up

---

## Related Files

### Implementation
- `server/domain/integrations/core/agentmail-thread-sync.service.ts`
- `server/domain/integrations/core/webhook.service.ts`
- `server/domain/integrations/core/slack-service.ts`
- `server/domain/integrations/core/hil-knowledge-bridge.ts`       # NEW: HIL pattern learning
- `server/domain/integrations/core/approval.service.ts`           # Updated with HIL bridge
- `server/domain/core/infrastructure/alert-mission-bridge.ts`     # NEW: Alert automation
- `server/domain/core/infrastructure/alerting.service.ts`         # Updated with alert bridge
- `server/domain/apps/core/apps-knowledge-bridge.ts`             # NEW: App knowledge registration
- `server/domain/apps/app-registry.service.ts`                    # Updated with apps bridge
- `server/domain/integrations/conversational-bridge.service.ts`
- `server/routes/messaging-webhooks.ts`
- `server/routes/saas/connectors.ts`
- `server/domain/rescue/core/rescue-knowledge-bridge.ts`
- `server/domain/mission/core/mission-knowledge-bridge.ts`
- `server/domain/agents/core/unified-memory.service.ts`
- `server/domain/mission/ui/components/WebhookConfigTab.tsx`
- `server/domain/mission/ui/components/EmailThreadPanel.tsx`

### Documentation
- `server/domain/apps/FEATURE_RELATIONSHIPS_UI_PROPOSAL.md`
- `docs/CONVERSATIONAL_SLACK_INTEGRATION.md`

---

**Last Updated:** April 27, 2026
