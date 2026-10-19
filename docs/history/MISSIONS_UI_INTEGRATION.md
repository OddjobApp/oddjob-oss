# Missions UI Integration

**Part of:** Unified Workflow UI Strategy  
**Context:** Missions are the execution atoms within Cycles  
**Purpose:** Detailed mission-level visualization and control

---

## Mission's Role in Hierarchy

```
Level 1: Workstream Blueprint    (Node graph template)
         ↓ defines
Level 2: Operational Cycle       (Execution instance with CPM)
         ├─ Wave visualization
         ├─ CPM timeline
         └─ Strategic audit
                ↓
Level 3: Cycle Blueprints        (Tactical mission groups)
         └─ Missions (individual execution units)
                ↓
Level 4: Mission Details         (Execution telemetry)
         ├─ Blackboard state
         ├─ Execution history
         ├─ Resource consumption
         └─ Outcomes & learnings
```

---

## Mission Visualization Views

### View 1: Mission Summary Panel (Inline, from Cycle Timeline)

**Triggered by:** Click mission in cycle timeline  
**Location:** Right-side slide-in panel

```
┌─────────────────────────────────────────┐
│ 🤖 Market Research                      │
│ Part of Wave 1 (Research Phase)         │
├─────────────────────────────────────────┤
│ Status: ⏳ Running (Day 2/3)             │
│ Duration: 2d 8h / 3d est.               │
│ Progress: ███████░░░ 70%                │
│                                         │
│ EXECUTION                               │
│ ├─ Type: supervisor_led                 │
│ ├─ Strategy: dynamic_autonomous         │
│ ├─ Model: Sonnet 4.6                    │
│ └─ Cost: $289 / $500 (57%)              │
│                                         │
│ RESOURCES                               │
│ ├─ Tokens: 245K in / 156K out           │
│ ├─ Time Elapsed: 2d 8h                  │
│ └─ Est. Remaining: 16h                  │
│                                         │
│ GOVERNANCE                              │
│ ├─ Policy: Market Research (conservative)
│ ├─ HIL Strictness: moderate             │
│ └─ Evaluation Threshold: 2/3 consensus  │
│                                         │
│ KEY OUTPUTS                             │
│ ├─ Insights: 67 identified              │
│ ├─ Deliverables: [View All] →           │
│ └─ Learnings: [View All] →              │
│                                         │
│ ACTIONS                                 │
│ [Pause] [View Blackboard] [View History]
└─────────────────────────────────────────┘
```

**Features:**
- Status badge with progress bar
- Execution parameters visible
- Cost/token tracking in real-time
- Quick access to outputs
- Actions: pause, inspect, view history

### View 2: Mission Blackboard (Deep Dive)

**Purpose:** See mission's state and execution plan  
**Triggered by:** Click "View Blackboard" from summary

```
MISSION BLACKBOARD: Market Research
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXECUTION STATE
├─ Current Step: 3/12
├─ Step: "Synthesize findings across sources"
├─ Model Reasoning: [Expand to see full reasoning]
└─ Last Update: 2 minutes ago

PLAN (Pre-planned steps)
1. ✓ Define research scope
2. ✓ Identify target sources
3. ⏳ Gather from sources (70% complete)
   ├─ Financial Reports (23/25)
   ├─ Industry Analysis (15/20)
   └─ Competitor Reviews (32/35)
4. ◯ Synthesize findings
5. ◯ Rank insights by impact
6. ◯ Generate report outline

DELIVERABLES (Expected outputs)
[✓] Research Scope Definition
[✓] Source List (assembled)
[⏳] Gathered Data (70% indexed)
[◯] Insights (pending synthesis)
[◯] Final Report (pending)

AUTO-CONTEXT (Knowledge enrichment)
Entities Discovered: 47
├─ Companies: 23
├─ Executives: 15
├─ Products: 9

Relationships Found: 89
├─ Competitor relationships: 34
├─ Partnership relationships: 28
└─ Acquisition relationships: 27

KEY LEARNINGS (Real-time insights)
- Market consolidation faster than expected
- New entrant "TechCorp" gaining traction
- Pricing pressures in segment B increasing

GOVERNANCE COMPLIANCE
✓ Budget: $289/$500 (57%)
✓ Tokens: 401K/1M limit (40%)
✓ Duration: On track (2d 8h/3d est)
✓ Quality: Consensus 2/3 reached
⚠ Outputs: 3/5 deliverables complete

[Export Blackboard] [View Full History] [Rollback State]
```

**Features:**
- Step-by-step execution visibility
- Auto-discovered knowledge entities
- Real-time learnings and insights
- Governance compliance dashboard
- Ability to export/rollback state

### View 3: Mission History & Execution Log

**Purpose:** Debug, audit, and understand execution path  
**Triggered by:** Click "View History" from summary

```
MISSION EXECUTION LOG: Market Research
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Time Filter: All] [Type Filter: All] [Status Filter: All]

Jun 16 14:30 → Mission started
             └─ Execution Strategy: dynamic_autonomous
             └─ Budget: $500, Tokens: 1M

Jun 16 14:31 → Step 1: Define research scope
             ├─ Duration: 8m 15s
             ├─ Cost: $22
             ├─ Output: Scope document (1,245 words)
             └─ Quality: ✓ Passed

Jun 16 14:40 → Step 2: Identify target sources
             ├─ Duration: 12m 30s
             ├─ Cost: $34
             ├─ Sources identified: 143
             └─ Quality: ✓ Passed

Jun 16 14:53 → Step 3: Gather from sources
             ├─ Duration: 1d 21h (ongoing)
             ├─ Sub-steps:
             │  ├─ Financial Reports (in progress, 92% complete)
             │  ├─ Industry Analysis (in progress, 75% complete)
             │  └─ Competitor Reviews (in progress, 91% complete)
             ├─ Cost so far: $233
             └─ Quality metrics: [View Details]

Jun 17 09:15 → Dynamic replan triggered
             ├─ Reason: Slower-than-expected data ingestion
             ├─ Adjustment: Added 8 hours to timeline
             ├─ Cost impact: +$45 estimated
             └─ Approved by: system (within budget)

Jun 17 10:00 → New entities discovered
             ├─ Companies: 8 new
             ├─ Partnerships: 15 new
             └─ Action: Added to auto-context

Jun 17 14:00 → Model evaluation triggered
             ├─ Consensus check: 2/3 agreement needed
             ├─ Evaluators: 3 (Sonnet, GPT-4, Claude3)
             ├─ Quality score: 87%
             └─ Status: ✓ Passed

[Earlier entries...] [Next page →]

EXECUTION SUMMARY
├─ Total Duration: 1d 10h (ongoing)
├─ Total Cost: $289 / $500 (57%)
├─ Steps Complete: 2 / 12
├─ Quality: 87% average
├─ Consensus: Maintained (2/3+)
└─ Status: ⏳ On track

[Detailed Metrics] [Rollback to Earlier State] [Export Log]
```

**Features:**
- Chronological event timeline
- Decision points and replans visible
- Cost attribution per step
- Quality metrics and evaluation results
- Governance audit trail
- Ability to rollback to any point

### View 4: Mission Comparison (Multi-Mission)

**Purpose:** Compare parallel missions within a wave  
**Triggered by:** From cycle wave view, multi-select missions

```
WAVE 1 COMPARISON: Research Phase
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    Market Research    Competitive Analysis
Status:             ⏳ Running          ✓ Complete
Progress:           70%                 100%
Duration:           2d 8h / 3d          3d 1h / 3d 2h
Cost:               $289/$500           $445/$450
Tokens:             401K/1M             892K/900K
Quality Score:      87%                 94%
Steps Complete:     3/12                12/12

EFFICIENCY
Cost/Hour:          $16.50              $14.50
Quality/Dollar:     0.30                0.21
Time vs Estimate:   On-track            Ahead +1h

OUTPUTS
Deliverables:       3/5                 5/5
Insights Found:     67                  89
Entities Learned:   47                  52
Key Learnings:      8                   12

MODEL USAGE
Primary Model:      Sonnet 4.6          Sonnet 4.6
Evaluation Model:   Claude 3            Claude 3
Quality Consensus:  2/3                 3/3

[Sync these missions] [Show detailed comparison] [Metrics export]
```

**Features:**
- Side-by-side metrics
- Efficiency comparisons
- Output quality analysis
- Reuse/sync recommendations

---

## Mission Interactions

### From Cycle Timeline
```
Click on mission tile
    ↓
Summary panel opens (right side)
    ├─ [View Blackboard] → Deep state view
    ├─ [View History] → Execution log
    ├─ [Pause] → Pause mission
    └─ [Actions menu]
        ├─ Change execution strategy
        ├─ Adjust budget
        ├─ Modify plan
        └─ View outputs
```

### From Cycle Gantt/CPM
```
Hover over mission block
    ├─ Show float/slack (time available before blocking)
    ├─ Highlight dependencies (predecessors/successors)
    ├─ Show cost/budget used
    └─ Right-click → Quick actions

Click mission block
    ├─ Summary panel (same as timeline)
    └─ Update Gantt showing task dependencies
```

### From Wave View
```
Multi-select related missions
    ↓
Comparison view opens
    └─ Side-by-side metrics for all selected
```

---

## Mission Status Indicators

### Status Badges
```
✓ Completed (green)        - All steps finished, outputs generated
⏳ Running (yellow)         - Active execution
⏸ Paused (blue)            - User paused, awaiting resume
⚠ Warning (orange)         - Approaching budget/time limit
✗ Failed (red)             - Execution failed, requires intervention
◯ Pending (gray)           - Awaiting predecessor completion
🔄 Replanning (purple)     - Dynamic replan in progress
```

### Mini Indicators (Inline)
```
🤖 AI-driven execution
👤 Manual/approval needed
📊 Data processing step
🔍 Research/analysis step
⚙️  System/infrastructure step
🧪 Testing/validation step
💾 Data persistence step
🚀 Deployment step
```

---

## Mission Execution Controls

### Quick Actions (Right-Click Context Menu)
```
├─ Pause Mission
├─ Resume Mission (if paused)
├─ Change Strategy (pre-planned → dynamic, etc)
├─ Adjust Budget (+/- amount)
├─ View Blackboard
├─ View Execution Log
├─ Terminate Mission
├─ Rollback to Earlier State
└─ Export Results
```

### Advanced Controls (Via Summary Panel)
```
[Change Execution Strategy]
├─ pre_planned (default)
├─ dynamic_autonomous
├─ rolling_wave
├─ human_driven
├─ parallel_fan_out
└─ reactive

[Modify Governance]
├─ HIL Strictness: [low] [moderate] [strict]
├─ Evaluation Threshold: [1/3] [2/3] [3/3]
└─ Approval Required: [yes/no]

[Adjust Resources]
├─ Budget Limit: $[input]
├─ Token Limit: [input]
└─ Time Limit: [input]
```

---

## Mission in Cycle Timeline View

When viewing a cycle timeline, missions appear as:

```
Research Phase (Wave 1) ✓ Complete
├─ 🤖 Market Research        [████████░] 70% ⏳ 2d 8h/$289
├─ 📊 Competitive Analysis   [██████████] 100% ✓ 3d 1h/$445
└─ ✓ Research Gate          [██████████] 100% ✓ completed

Design Phase (Wave 2) ⏳ Running
├─ 🤖 Product Design         [█████░░░░] 50% ⏳ 5d/$1,200
├─ 🤖 Copywriting           [███░░░░░░] 30% ⏳ 3d/$320
└─ 🤖 Asset Creation        [░░░░░░░░░] 0% ◯ blocked by Design

Deploy Phase (Wave 3) ◯ Pending
├─ 🤖 QA Testing           [░░░░░░░░░] 0% ◯ 4d/$500
├─ ⏸️  Launch Approval      [░░░░░░░░░] 0% ⏸ manual gate
└─ 🚀 Deploy to Market     [░░░░░░░░░] 0% ◯ 1h/$100
```

**Click any mission** → Summary panel with full details  
**Hover any mission** → Tooltip with quick stats + dependencies  
**Multi-select missions** → Comparison view

---

## Mission Notifications & Alerts

### Real-Time Events
```
🔔 Mission started
🔔 Mission completed (success)
⚠️  Mission nearing budget limit (>80%)
⚠️  Mission nearing time limit
✗ Mission failed (error)
🔄 Mission automatically replanned (reason: ...)
⏸ Mission paused (manual)
```

### Blockers & Dependencies
```
🔗 Awaiting predecessor: "Product Design" (2h remaining)
⏸ Manual approval needed: "Launch Review"
💰 Budget alert: $289/$500 (57%)
⏱ Timeline drift: Estimate increased by 8h
```

---

## Mission Blackboard Integration

The mission blackboard is the heart of execution state:

```
MissionBlackboard {
  // Current execution state
  executionStep?: number          // Step 1/12
  currentTask?: string            // "Synthesize findings"
  modelReasoning?: string         // Full reasoning trace
  
  // Planned steps
  plan: {
    steps: [
      { step: 1, task: "Define scope", status: "✓" },
      { step: 2, task: "Identify sources", status: "✓" },
      { step: 3, task: "Gather data", status: "⏳", progress: 70 },
      ...
    ]
  }
  
  // Deliverables tracking
  expected_deliverables: [
    { id: "scope", description: "Scope document", status: "✓" },
    { id: "sources", description: "Source list", status: "✓" },
    { id: "data", description: "Gathered data", status: "⏳" },
    ...
  ]
  
  // Auto-discovered context
  autoContext: {
    entities: [
      { id: "company-1", name: "TechCorp", type: "company" },
      { id: "exec-1", name: "John Doe", type: "executive" },
      ...
    ],
    relationships: [
      { type: "competitor", from: "company-1", to: "company-2" },
      ...
    ]
  }
  
  // Outcomes
  outcome?: string                // Summary result
  keyLearnings?: [                // Real-time insights discovered
    "Market consolidation faster than expected",
    "New entrant gaining traction",
    ...
  ]
  
  // Governance
  governance: {
    costSpent: "$289",
    budgetLimit: "$500",
    tokensUsed: "401K",
    tokenLimit: "1M",
    qualityScore: 87,
    consensusThreshold: "2/3",
    consensusReached: true
  }
}
```

---

## Conclusion

**Missions are the execution atoms** within Cycles. The unified UI provides:

✅ **Multi-level visualization**: Wave → Cycle Blueprint → Mission  
✅ **Real-time execution state**: Blackboard with step-by-step progress  
✅ **Complete audit trail**: Every decision, replan, and output logged  
✅ **Governance compliance**: Budget, tokens, quality metrics visible  
✅ **Flexible controls**: Pause, replan, adjust strategy, rollback  

**The result:** Managers see cycle progress at the wave level; analysts can drill down into any mission's blackboard for complete transparency.
