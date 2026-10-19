# Missions System Documentation

> **Spec Reference:** [MISSIONS_SPEC](../../specs/MISSIONS_SPEC.md) — Schema, API, checkpoint format, resume conditions.

## **Feature Overview**

### **Purpose & Business Value**

Missions are durable execution state machines for workgroups. They track pipeline sequences, checkpoints, and resume conditions. The Blackboard serves as the shared mission context; checkpoints persist state to `workgroup_blackboard_history`. Missions enable long-running workflows that can pause for external events (file uploads, human approval) and resume when conditions are met.

### **User Personas & Use Cases**

- **Process Engineers**: Design mission-driven workflows with file- and approval-based gates
- **Operations Managers**: Monitor mission progress and dwell times
- **Supervisors**: Resolve HIL approvals and unblock waiting missions
- **Developers**: Configure folder_import and human_approval steps for event-driven resumption

### **Key Requirements & Constraints**

- **Durable State**: Mission context (Golden State) persists across pauses
- **Checkpointing**: State snapshots on milestone completion or step completion
- **Strategic Planning**: AI-driven DAG generation with full awareness of Org resources (tools, datasets, HIL forms).
- **Execution Strategies**: Choice between `pre_planned` (DAG) and `dynamic_autonomous` (Iterative Loop).
- **Resume Conditions**: `waiting_on_file` (folder_import), `waiting_on_human` (HIL)
- **Mission Blueprints**: Master templates for rapid mission deployment (SDM, Research, Audits).
- **Global Software Changelog**: Immutable audit trail of agent-driven software modifications.
- **Multi-tenant**: Missions scoped by organization and workgroup

### **Success Metrics**

- Mission checkpoint latency < 500ms
- Resume from file/approval within 1 minute of condition met
- Zero data loss on mission pause/resume

---

## **User Interface Documentation**

### **Screens & Navigation**

#### **Workgroup Detail (`/workgroups/:id`)**

- **Mission Tracker**: Horizontal track of pipeline sequence; each step shows status (completed, active, waiting_on_human, waiting_on_file)
- **Dwell Time Overlay**: "Waiting since X" when mission is awaiting file or approval
- **Durable Blackboard Explorer**: Mission Variables (editable) vs Step Outputs (read-only)
- **Decision Timeline**: Checkpoint cards + approval events merged chronologically
- **Software Changelog Tab**: A dedicated view within the mission dashboard showing all code changes made during the mission.
- **Blueprint Gallery**: A searchable modal (`/api/missions/templates`) for launching missions from pre-configured master blueprints.

### **Component Hierarchy**

```
WorkgroupDetail/
├── MissionTracker.tsx - Pipeline sequence progress, status badges, resume button
├── DwellTimeOverlay - Inline in MissionTracker; "Waiting since X"
├── BlackboardExplorer.tsx - Mission Variables + Step Outputs, inline edit
├── DecisionTimeline.tsx - Checkpoint cards + approval events
├── CheckpointCard - Single checkpoint in timeline (collapsible missionContext)
└── WorkgroupActivity.tsx - Recent pipeline runs (separate from Decision Timeline)
```

### **User Interactions**

#### **Mission Creation Flow**

1. Create workgroup with members (pipelines, jobs)
2. On "Launch Mission", supervisor creates mission with pipeline sequence
3. Mission starts with `status: active` and `currentStepIndex: 0`

#### **Checkpoint Flow**

1. Pipeline step completes; execution has `workgroupId` and linked mission
2. MissionCheckpointHook merges step output into `missionContext`
3. Writes to `workgroupBlackboardHistory` with `changeReason: "checkpoint:step_N"` or `"checkpoint:milestone_complete"`
4. Updates `missions.lastCheckpointAt`

#### **File Wake-Up Flow**

1. folder_import step finds no matching file; pauses mission
2. Mission status → `waiting_on_file` with `resumeCondition: { type: "file", folderPath, filePattern, pipelineExecutionId, stepId }`
3. When file matches (folder_import runs again or async poller), `missionService.resumeMission(matchedFilePath)` is called
4. Pipeline resumes from step with `matched_file_path` in context

#### **HIL Wake-Up Flow**

1. human_approval step creates approval request; pauses mission
2. Mission status → `waiting_on_human` with `resumeCondition: { type: "human_approval", approvalRequestIds }`
3. User approves/rejects via `/api/approvals/:id/decision`
4. `missionService.resumeIfWaitingOnApproval(requestId)` clears mission state
5. Existing HIL flow resumes pipeline

---

## **API Endpoints**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/missions` | List missions (query: `workgroupId`, `orgId`, `status`) |
| GET | `/api/missions/:id` | Get mission detail |
| POST | `/api/missions` | Create mission |
| PUT | `/api/missions/:id` | Update mission (missionContext, status, etc.) |
| POST | `/api/missions/:id/resume` | Manual resume | 
| GET | `/api/missions/:id/checkpoints` | Checkpoint history |
| GET | `/api/missions/:id/dwell-time` | Dwell time for waiting missions |
| GET | `/api/missions/:id/timeline` | Combined timeline (checkpoints + approvals) |
| GET | `/api/missions/templates` | List available Mission Blueprints |
| POST | `/api/missions/templates/:id/instantiate` | Launch a mission from a blueprint |
| POST | `/api/missions/shadows/:id/promote-to-blueprint` | Promote a successful run to a Master Blueprint |

---

## **Integration Points**

- **Workgroups**: Missions belong to workgroups; `workgroupId` links workgroup blackboard
- **Pipeline Executor**: Passes `workgroupId`, calls mission checkpoint on step complete
- **folder_import Executor**: Checks file match for `waiting_on_file` missions; calls `resumeMission`
- **human_approval Executor**: Calls `pauseForHumanApproval` when creating approval
- **Approvals Route**: Calls `resumeIfWaitingOnApproval` after decision before `submitHilResponse`
- **workgroupBlackboardHistory**: Checkpoint snapshots with `changeReason: "checkpoint:*"`

---

## **Error Handling & Edge Cases**

- **No mission for workgroup**: Mission Tracker shows "No missions for this workgroup"
- **Mission not found**: 404 for GET/PUT/POST/:id
- **Invalid resume condition**: `resumeMission` clears condition and sets active
- **Transaction aborted**: Checkpoint and mission update run in DB transaction

---

## **Related**

- [WORKGROUPS_SPEC](../../specs/WORKGROUPS_SPEC.md) — Workgroups and blackboard
- [HUMAN_APPROVAL_SPEC](../../specs/HUMAN_APPROVAL_SPEC.md) — HIL flow
- [MISSIONS_AND_BLACKBOARD](../../guides/MISSIONS_AND_BLACKBOARD.md) — User guide
