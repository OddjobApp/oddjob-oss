# Mission UI Optimization Proposal
## Execution-Type-Aware Detail & Run Report Screens

### Executive Summary

Transform the Mission Detail and Mission Run Report screens to dynamically adapt their UI based on the mission's **execution strategy** and **mission type**. This will surface the unique capabilities of each execution mode and provide users with contextual insights, controls, and visualizations specific to how their mission operates.

---

## Current State

The Mission Detail screen (`MissionDetail.tsx`) currently has a one-size-fits-all layout that:
- Shows generic mission info (budget, status, members)
- Displays a Forge preview panel conditionally
- Uses standard tabs (Activity, Deliverables, Blackboard)
- Has limited differentiation between execution strategies

**Execution Strategies Supported:**
1. `pre_planned` - Static execution with predefined steps
2. `dynamic_autonomous` - Adaptive execution with self-healing
3. `rolling_wave` - Phase-based Forge app building

**Mission Types:**
- `supervisor_led` - AI supervisor manages execution
- `governed` - Policy-controlled with strict constraints
- `manual` - User-controlled step-by-step
- `mission_based` - Nested child missions
- `rescue` - Recovery and repair missions

**New Phase 5 Capabilities (Need UI Exposure):**
- Predictive Planning (5.1) - Risk assessment, tool recommendations
- Self-Healing (5.2) - Auto-recovery, failure patterns
- Multi-Agent Coordination (5.3) - Agent collaboration, consensus

---

## Proposed Solution

### 1. Strategy-Aware Layout System

Create an execution strategy registry that defines UI components, tabs, and visualizations for each strategy:

```typescript
type ExecutionStrategy = 'pre_planned' | 'dynamic_autonomous' | 'rolling_wave';
type MissionType = 'supervisor_led' | 'governed' | 'manual' | 'mission_based' | 'rescue';

interface StrategyConfig {
  // Visual identity
  icon: LucideIcon;
  colorScheme: string;
  heroComponent: React.ComponentType;
  
  // Layout sections
  primaryMetrics: MetricConfig[];
  sidebarWidgets: WidgetConfig[];
  tabs: TabConfig[];
  
  // Special features
  showPredictivePlanning: boolean;
  showSelfHealing: boolean;
  showMultiAgent: boolean;
  showForgePreview: boolean;
}
```

---

### 2. Strategy-Specific UI Components

#### A. PRE_PLANNED Missions
**Characteristics:** Predictable, sequential, milestone-driven

**Hero Component:** Timeline Gantt Chart
- Visual timeline of planned steps
- Progress markers at each phase
- Estimated vs actual duration comparison

**Primary Metrics:**
- Plan adherence % (actual vs planned timeline)
- Milestone completion rate
- Budget burn rate vs plan
- Step completion velocity

**Special Tabs:**
1. **Plan** - Original planned steps with status
2. **Timeline** - Gantt-style visualization
3. **Deviations** - Where execution diverged from plan

**Sidebar Widgets:**
- Next 3 upcoming steps with time estimates
- Plan fidelity score
- Critical path indicator

---

#### B. DYNAMIC_AUTONOMOUS Missions  
**Characteristics:** Adaptive, self-healing, AI-driven, unpredictable path

**Hero Component:** Dynamic Flow Graph + Health Dashboard
- Real-time decision tree visualization
- Self-healing event indicators
- AI confidence scores

**Primary Metrics:**
- Adaptation events count (path changes)
- Self-healing success rate
- AI decision confidence (avg)
- Recovery time from failures
- Predictive accuracy (if planning used)

**Special Tabs:**
1. **Adaptations** - List of execution path changes with reasoning
2. **Healing Log** - Auto-recovery events with before/after
3. **AI Decisions** - Decision points with confidence scores
4. **Agents** - Multi-agent coordination view (if applicable)

**Sidebar Widgets:**
- Live health score with trend
- Recent adaptations (last 3)
- Active failure patterns being monitored
- Predicted next actions

**Phase 5 Integration:**
- **Predictive Planning Panel** - Risk meter, tool recommendations, completion estimate
- **Self-Healing Dashboard** - Pattern detection, remedy status, escalation tracker
- **Multi-Agent Coordination** - Agent status, task assignments, consensus state

---

#### C. ROLLING_WAVE Missions (Forge)
**Characteristics:** Phase-based, iterative, deliverable-focused, app-building

**Hero Component:** Wave Progress + App Preview
- Phase indicators (Planning → Construction → Vibe Check)
- Live app preview iframe
- Deliverable completion rings

**Primary Metrics:**
- Current phase progress
- Deliverables completed / total
- Iteration count
- App health score
- User acceptance test status

**Special Tabs:**
1. **Phases** - Rolling wave progress with phase details
2. **Deliverables** - Structured deliverable list with acceptance
3. **Iterations** - History of app versions
4. **Preview** - Full app preview with interaction
5. **Terminal** - Build logs and output

**Sidebar Widgets:**
- Phase indicator with % complete
- App preview thumbnail (click to expand)
- Deliverable checklist
- Current iteration number
- Build status

---

### 3. Mission Type Overlays

Each execution strategy gets enhanced by mission type:

#### SUPERVISOR_LED Overlay
- Show supervisor AI thought stream
- Decision rationale panel
- Override controls for key decisions

#### GOVERNED Overlay  
- Policy compliance indicators (green/yellow/red)
- Governance checkpoint history
- Exception requests status

#### MANUAL Overlay
- Step-by-step approval controls
- Manual trigger buttons
- Override capability indicators

#### MISSION_BASED Overlay
- Child mission tree view
- Nested mission status rollup
- Cross-mission dependency graph

#### RESCUE Overlay
- Recovery objective tracker
- Damage assessment panel
- Fix verification status

---

### 4. Phase 5 Feature Integration

#### Predictive Planning (5.1) - For Dynamic Missions
**New Components:**
```typescript
<PredictivePlanningPanel missionId={id} />
```
- **Risk Thermometer** - Visual risk level with factors
- **Tool Recommendations** - Suggested tools with success rates
- **Completion Forecast** - Estimated completion with confidence interval
- **Historical Pattern Match** - Similar missions comparison

#### Self-Healing (5.2) - For Dynamic Missions
**New Components:**
```typescript
<SelfHealingDashboard missionId={id} />
```
- **Health Score Gauge** - Real-time mission health
- **Failure Pattern Alerts** - Detected patterns with auto-fix status
- **Remedy Timeline** - Applied fixes with timestamps
- **Escalation Status** - Human intervention requests
- **Learning Indicators** - New patterns learned from resolutions

#### Multi-Agent Coordination (5.3) - For All Multi-Agent Missions
**New Components:**
```typescript
<MultiAgentCoordinationPanel missionId={id} />
```
- **Agent Grid** - Visual agent status (idle/working/offline)
- **Message Stream** - Inter-agent communications
- **Consensus Panel** - Active proposals with vote status
- **Conflict Resolver** - Detected conflicts with resolution status
- **Task Assignment Board** - Who's doing what

---

### 5. Mission Run Report Enhancements

Create execution-type-specific report templates:

#### Pre-Planned Report
- Timeline adherence analysis
- Milestone achievement summary
- Deviation report (what changed from plan)
- Budget vs planned budget

#### Dynamic Report
- Adaptation summary (how many path changes)
- Self-healing events log
- AI decision confidence analysis
- Agent collaboration summary
- Predictions accuracy review

#### Rolling Wave Report
- Phase completion summary
- Deliverable acceptance status
- Iteration evolution view
- App quality metrics
- User feedback summary

---

### 6. Implementation Plan

#### Phase 1: Strategy Registry & Base Components (3-4 hours)
1. Create `mission-strategies.config.ts` with strategy definitions
2. Build `StrategyHeroLayout` wrapper component
3. Implement strategy detection hook
4. Create base metric card components

#### Phase 2: Hero Components (4-5 hours)
1. `PrePlannedTimelineHero` - Gantt-style timeline
2. `DynamicFlowHero` - Graph visualization with health
3. `RollingWaveHero` - Phase progress with preview
4. Add animated transitions between states

#### Phase 3: Specialized Tabs (5-6 hours)
1. `AdaptationsTab` - For dynamic missions
2. `HealingLogTab` - Self-healing events
3. `AIDecisionsTab` - Decision audit trail
4. `PhasesTab` - Rolling wave phases
5. `AgentsTab` - Multi-agent coordination

#### Phase 4: Phase 5 Integration (4-5 hours)
1. `PredictivePlanningPanel` component
2. `SelfHealingDashboard` component
3. `MultiAgentCoordinationPanel` component
4. Wire to existing MCP tools

#### Phase 5: Mission Type Overlays (3-4 hours)
1. `GovernanceOverlay` for governed missions
2. `SupervisorOverlay` for supervisor-led
3. `ManualControls` for manual missions
4. `MissionTree` for mission-based

#### Phase 6: Report Templates (3-4 hours)
1. Strategy-specific report layouts
2. Export capabilities (PDF/JSON)
3. Print-friendly styles

**Total Estimate: 22-28 hours**

---

### 7. Benefits

1. **Clarity** - Users immediately understand their mission's execution model
2. **Context** - Relevant features surface automatically (no hunting)
3. **Trust** - AI decisions and adaptations are visible and explainable
4. **Control** - Strategy-appropriate controls (approvals, overrides)
5. **Insights** - Metrics that matter for each execution type
6. **Adoption** - Phase 5 features become discoverable and usable

---

### 8. Mockup Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Mission: [Name]                    [Status Badge] [Actions]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           STRATEGY-SPECIFIC HERO                   │   │
│  │  (Timeline/Flow Graph/Phase Waves + Preview)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Metric 1 │ │ Metric 2 │ │ Metric 3 │ │ Metric 4 │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [Standard] [Strategy] [Activity] [Deliverables] [...]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              STRATEGY-SPECIFIC TAB CONTENT                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ SIDEBAR: Next Steps | Health | Quick Actions | Widgets     │
└─────────────────────────────────────────────────────────────┘
```

---

## Approval Request

This proposal requires approval before implementation. The changes are significant but backward-compatible (existing missions will render with appropriate defaults).

**Please confirm:**
1. Proceed with this optimization?
2. Prioritize specific execution strategies?
3. Any additional mission types or strategies to consider?
