# Unified Workflow UI Strategy - Workstreams & Cycles

**Proposal Date:** June 15, 2026  
**Based On:** Temporal's "Dark Magic of Workflow Exploration"  
**Scope:** Apply unified visualization principles across Workstream Blueprints and Operational Cycles

---

## Architecture Understanding

### Workstream Blueprints
- **Purpose:** Graph-based workflow definitions
- **Components:** Nodes (agents, modifiers, datasets) + Edges (with conditions)
- **Triggers:** Manual, Schedule, Webhook
- **Nature:** Template/blueprint - static definition

### Operational Cycles
- **Purpose:** Execution instances of cycle blueprints
- **Components:** Wave-based missions with CPM calculations
- **State:** Planning → Active → Reviewing → Closed
- **Nature:** Runtime - dynamic, state-changing execution

### Relationship
```
Workstream Blueprint (Template)
    ↓ Used by
Operational Cycle (Instance)
    ├─ Cycle Blueprint (Tactical component)
    ├─ Execution Plan (CPM waves + timing)
    └─ Strategic Audits (Alignment tracking)
```

---

## Unified Design System

### 1. Shared Visual Language

#### Node Types & Icons
```
🤖 Agent          - Processing/computation step
🔄 Modifier       - Conditional branching, iteration, transformation
📊 Dataset        - Data input/reference
✓ Mission         - Mission execution (cycles only)
⏸️  Manual Gate    - Requires human approval
⏱️  Timer          - Scheduled delay/wait
🔗 Webhook        - External trigger/integration
```

#### Edge Types & Lines
```
━━━→  Normal flow (completion → next)
┈┈┈→  Conditional flow (requires condition)
═══→  Critical path (cycles only)
┈┈┈→  Pending/waiting (animated dash)
✗━━→  Failed path
⚠️━━→ Retry path
```

#### Status Colors
```
🟢 Green    - Success/Ready/Completed
🟡 Yellow   - In Progress/Running
🔵 Blue     - Pending/Waiting
🔴 Red      - Failed/Error
⚫ Gray      - Not Started/Skipped
🟣 Purple    - Paused/Suspended
🟠 Orange    - Warning/Retry
```

#### Shape Language (Optional Enhancement)
```
○  = Waiting/Pending input
◐  = Partially complete/In progress
●  = Active/Running
✓  = Completed successfully
✗  = Failed
⚠  = Warning/Retry
⏸  = Paused
```

---

## Workstream View Hierarchy

### View 1: **Workstream Canvas** (DAG Visualization)

**Purpose:** Design and understand workflow structure  
**Design:** Interactive node-graph editor

```
┌─────────────────────────────────────────┐
│  Workstream: "Data Analysis Pipeline"   │
├─────────────────────────────────────────┤
│                                         │
│     [Dataset A]                         │
│          │                              │
│          ↓                              │
│     [🤖 Extract] ──→ [🔄 Filter]       │
│                         │               │
│                         ↓               │
│     [Dataset B] ──→ [🤖 Analyze]       │
│                         │               │
│                         ↓               │
│                    [⏸️  Review] ──→ [✓]│
│                                         │
└─────────────────────────────────────────┘

Legend:
🤖 = Agent (17 inputs, 3 outputs)
🔄 = Modifier - Decision Branch
⏸️  = Manual approval gate
✓  = Trigger webhook on success
```

**Features:**
- Drag-and-drop node arrangement
- Real-time validation
- Node inspection (click → detail panel)
- Conditional edge editing
- Trigger configuration
- Export/import blueprint

### View 2: **Workstream Summary** (Simplified View)

**Purpose:** Quick understanding of workflow structure  
**Design:** Compact hierarchical layout

```
Data Analysis Pipeline
├─ Extract Phase
│  ├─ 🤖 Extract Data (AI Agent)
│  └─ 📊 Input: Dataset A
├─ Transform Phase
│  ├─ 🔄 Filter (Decision Branch)
│  ├─ 🤖 Analyze (AI Agent)
│  └─ ⏸️  Manual Review (Gate)
└─ Publish Phase
   └─ 🔗 Webhook (external notify)

Triggers: [Manual] [Schedule: Daily] [Webhook]
```

**Features:**
- Hierarchical grouping by phase
- Node counts and quick stats
- Trigger badges
- Expandable sections

### View 3: **Test/Preview Mode** (Simulation)

**Purpose:** Dry-run workflow before deploying  
**Design:** Timeline with simulated execution

```
Simulating execution...

[🤖 Extract Data]     [████████] 2m 34s ✓
└→ Output: 1,245 records

[🔄 Filter]           [████████] 45s ✓
└→ Output: 892 records

[🤖 Analyze]          [████████] 3m 12s ✓
└→ Results: 15 insights

[⏸️  Manual Review]    [⏳ waiting] (paused)
└→ Ready for approval

[🔗 Webhook Notify]   [○ pending] (not started)
```

**Features:**
- Execute with test data
- Show performance metrics
- Identify bottlenecks
- Validate conditional branches

---

## Cycle View Hierarchy

### View 1: **Cycle Waves** (Gantt-Like CPM)

**Purpose:** Understand execution plan and critical path  
**Design:** Wave-based timeline with CPM visualization

```
Operational Cycle: Q3 Market Launch (Active)

Wave 1 [████████ 100%]  ✓ Complete
├─ 🤖 Market Research        [████] 3d
├─ 📊 Competitive Analysis   [████] 3d
└─ ✓ Research Gate          [█] 1h

Wave 2 [█████░░░░ 50%]  ⏳ In Progress
├─ 🤖 Product Design         [█████] 5d (Critical Path ⭐)
├─ 🤖 Copywriting           [███] 3d
└─ 🤖 Asset Creation        [██░░] 2d (Float: +1d)

Wave 3 [░░░░░░░░░░ 0%]   ◯ Ready
├─ 🤖 QA & Testing          [expected 4d]
├─ ⏸️  Launch Approval       [expected 1h]
└─ 🔗 Deploy to Market      [expected 1h]

Timeline: ▼───────▼───────▼───────▼
          Jun 15  Jun 22  Jun 29  Jul 6
          
Critical Path: Research → Design → QA → Deploy (13d)
Overall Progress: 5/13 days (38%)
Budget: $2,340 / $5,000 (47%)
```

**Features:**
- Wave-based grouping
- Critical path highlighting
- Float visualization (slack time)
- Budget/token tracking
- Real-time progress
- Dependency chain showing

### View 2: **Cycle Timeline** (Detailed Execution)

**Purpose:** See actual execution with timing  
**Design:** Timeline with real execution data

```
Cycle: Q3 Launch (🟡 Active, Day 5/13)

Jun 15  Research Phase
├─ 🤖 Market Research ✓      Completed in 3d 2h
│  └─ Processed: 150 sources
├─ 📊 Competitive Analysis ✓ Completed in 3d 4h
│  └─ Analyzed: 12 competitors
└─ ⏸️  Research Gate ✓        Approved by @sarah

Jun 18  Design Phase (⏳ Running)
├─ 🤖 Product Design 🟡     3d 6h / 5d estimated
│  └─ Iterations: 4, Cost: $1,200
├─ 🤖 Copywriting 🟡        2d 3h / 3d estimated
│  └─ Status: 85% complete
└─ 🤖 Asset Creation ⏳      0h / 2d estimated
   └─ Ready to start (blocked by design 80%)

Jun 28  QA Phase (◯ Not started)
├─ 🤖 Testing               4d estimated
├─ ⏸️  Launch Approval      1h estimated
└─ 🔗 Deploy                1h estimated

Summary:
✓ 2 complete | ⏳ 2 in progress | ⏸️ 1 gate | ◯ 3 pending
Duration: 5d / 13d (38%) | Budget: $2,340 / $5,000 (47%)
Critical: Design on track (0d slack)
```

**Features:**
- Actual vs estimated timing
- Per-mission cost tracking
- Inline blocking analysis
- Dependency visualization
- Real-time progress bars

### View 3: **Cycle Full History** (Complete Audit)

**Purpose:** Debugging and compliance  
**Design:** Detailed event timeline

```
Jun 15 14:30 → Planning started
Jun 15 15:45 → Market Research mission created (🤖 Agent: Sonnet)
Jun 15 15:46 → Dataset A uploaded (150 sources, 45MB)
Jun 15 16:00 → Market Research started
Jun 17 14:30 → Market Research completed (Result: 85 insights)
Jun 17 14:45 → Gate triggered: Research approval needed
Jun 17 15:20 → ⏸️  Manual approval: @sarah approved
Jun 17 15:21 → Design Phase unlocked
Jun 17 15:30 → Product Design mission started
Jun 17 18:45 → ⚠️  Product Design iteration 1 flagged (quality issue)
Jun 17 19:00 → Design rerun approved
Jun 18 14:00 → Design iteration 2 completed
Jun 18 14:15 → Copywriting started
Jun 19 10:00 → Design blocked: awaiting asset library
Jun 19 11:00 → Asset Creation started
Jun 20 16:00 → Design unblocked (assets ready)

[Detailed metrics, costs, and decision logs for each event]
```

**Features:**
- Chronological event log
- Expandable event details
- Cost/token attribution
- Decision rationale
- Error analysis
- Full audit trail

---

## Shared Features Across Views

### 1. Real-Time Liveness
```
✓ WebSocket updates for running cycles
✓ Animated progress bars
✓ Status badges update instantly
✓ Pending dependencies highlight when ready
✓ Cost updates in real-time
```

### 2. Inline Exploration (No Navigation)
```
Click node/mission → Slide-in detail panel:

┌─────────────────────────┐
│ 🤖 Market Research      │
├─────────────────────────┤
│ Status: ✓ Completed     │
│ Duration: 3d 2h 15m     │
│ Cost: $450 / $500       │
│ Model: Sonnet 4.6       │
│ Tokens In: 125K         │
│ Tokens Out: 234K        │
│ Quality Score: 92%      │
│ Output: [View Results]  │
│                         │
│ Dependencies:           │
│ └─ Blocked: Design Phase│
│    (awaiting approval)  │
└─────────────────────────┘
```

### 3. Smart Filtering & Search
```
[Filter by Status] ▼
├─ ✓ Completed (8)
├─ ⏳ In Progress (2)
├─ ◯ Pending (5)
├─ ⏸️  Blocked (2)
└─ ✗ Failed (0)

[Filter by Type] ▼
├─ 🤖 Agents
├─ 🔄 Modifiers
├─ 📊 Datasets
├─ ⏸️  Gates
└─ 🔗 Integrations

[Search: "design"] 🔍
└─ 3 results found
```

### 4. Multi-Panel Comparison (Cycles)
```
Compare side-by-side:

┌──────────────────┐  ┌──────────────────┐
│ Market Research  │  │ Copywriting      │
├──────────────────┤  ├──────────────────┤
│ Status: ✓        │  │ Status: ⏳       │
│ Time: 3d 2h      │  │ Time: 2d 3h/3d  │
│ Cost: $450       │  │ Cost: $320/$400  │
│ Quality: 92%     │  │ Quality: 85%     │
│ Tokens: 359K     │  │ Tokens: 245K/800K│
└──────────────────┘  └──────────────────┘
```

### 5. Export & Share
```
[Export] ▼
├─ Cycle Report (PDF)
├─ Timeline Chart (PNG)
├─ Execution Log (CSV)
└─ Metrics Summary (JSON)

[Share] ▼
├─ Copy link
├─ Email report
└─ Slack notification
```

---

## Implementation Roadmap

### Phase 1: Design System (Week 1-2)
- [ ] Define shared icon set (12 icons)
- [ ] Create color palette with accessibility review
- [ ] Design node/edge component library
- [ ] Create visual language guide (internal)

### Phase 2: Workstream Improvements (Week 3-4)
- [ ] Build Workstream Canvas view
- [ ] Create Summary view
- [ ] Add Test/Preview mode
- [ ] Implement inline detail panels

### Phase 3: Cycle Improvements (Week 5-6)
- [ ] Redesign Wave view (CPM-aware)
- [ ] Build detailed Timeline view
- [ ] Create Full History view
- [ ] Add real-time updates

### Phase 4: Unified Features (Week 7-8)
- [ ] Implement filtering across both
- [ ] Add comparison mode
- [ ] Create export capabilities
- [ ] Performance optimization

### Phase 5: Polish & Deploy (Week 9-10)
- [ ] User testing & feedback
- [ ] Accessibility audit
- [ ] Mobile responsiveness
- [ ] Documentation & training

---

## Benefit Matrix

### For Workstream Users (Developers)
| Current | Improved |
|---------|----------|
| Unclear node flow | Visual node graph |
| Manual testing | Preview/simulation mode |
| No reuse patterns | Canvas-based design |
| No validation feedback | Real-time validation |
| Single static view | Three contextual views |

### For Cycle Users (Managers)
| Current | Improved |
|---------|----------|
| Can't see critical path | CPM visualization |
| Manual progress tracking | Real-time updates |
| Unclear blocking issues | Dependency highlighting |
| No cost visibility | Per-mission cost tracking |
| Limited history | Full audit trail |

### For Everyone
| Current | Improved |
|---------|----------|
| Scattered UI patterns | Unified design system |
| Must navigate away | Inline exploration |
| No filtering | Smart filtering |
| Single view | Multiple specialized views |
| Static display | Real-time liveness |

---

## Technical Implementation Notes

### Shared Components
```
- IconLibrary (unified icon system)
- NodeComponent (workstream nodes)
- EdgeComponent (with conditional UI)
- StatusBadge (status indicators)
- ProgressBar (real-time animation)
- DetailPanel (inline exploration)
- FilterBar (smart filtering)
- Timeline (cycle execution view)
```

### Data Flow for Real-Time Updates
```
WebSocket Event → Redux/State → UI Components
- Cycle state changed
  ├─ Update progress bars
  ├─ Animate cost counters
  ├─ Update status badges
  └─ Highlight dependencies

Mission completed
├─ Cascade unlock dependent missions
├─ Update wave progress
├─ Update critical path
└─ Notify connected users
```

### Performance Optimization
```
- Virtualize large node graphs (1000+ nodes)
- Lazy-load mission details
- Debounce filter updates (300ms)
- Cache CPM calculations
- Use Web Workers for graph algorithms
```

---

## Success Metrics

### Usability
- Time to understand cycle status: <5s (from current ~30s)
- Clicks to find blocking issue: <3 (from current 5-7)
- Workstream design time: -20% faster

### Engagement
- Dashboard visits +15% (more useful)
- Average session duration +25%
- Feature adoption >80% within month

### Operational
- Fewer blocking-issue escalations
- Faster incident debugging
- Better stakeholder communication

---

## Migration Strategy

### Phase 1: Workstreams (Lower Risk)
- Workstream UI isolated from cycles
- Easy to roll back if needed
- Build confidence

### Phase 2: Cycles (Higher Impact)
- Use lessons learned from workstreams
- Coordinate with stakeholders on changes
- Provide training/documentation

### Parallel: Design System
- Build shared components from day 1
- Both workstreams and cycles use same foundation
- Consistency across product

---

## Conclusion

By applying Temporal's proven visualization principles to **both Workstreams and Cycles** through a **unified design system**, we can:

1. **Reduce cognitive load** through consistent visual language
2. **Improve efficiency** with specialized multi-view approach
3. **Enable debugging** through real-time liveness and full history
4. **Enhance clarity** with visual relationships and status tracking
5. **Scale elegantly** from simple workflows to complex orchestrations

The result: A cohesive UI that treats Workstreams as design-time blueprints and Cycles as runtime executions, both using the same visual vocabulary and interaction patterns.

---

**Next Steps:**
1. Review proposal with design & product teams
2. Create interactive prototype for both views
3. Conduct user research with managers and developers
4. Finalize component library design
5. Begin Phase 1 implementation (Workstreams)
