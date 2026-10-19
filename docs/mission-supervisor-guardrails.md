# Mission Supervisor Guardrails - Implementation Plan

## Problem
Mission 184 failed because no supervisor pipeline exists in Organization 1.

## Root Cause
The mission execution service searches for a pipeline with a `supervisor` type job:
```typescript
const [supervisorStep] = await db
    .select({ pipelineId: pipelines.id, jobId: pipelineSteps.jobId })
    .from(pipelineSteps)
    .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
    .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
    .where(and(
        eq(jobs.type, "supervisor"),
        eq(pipelines.organizationId, orgId)
    ))
    .limit(1);

if (!supervisorPipelineId) {
    return { success: false, error: "No supervisor pipeline found." };
}
```

## Solution: Multi-Layer Guardrails

### Layer 1: Mission Creation Validation (Immediate)
**File:** `server/domain/mission/routes/missions.route.ts`

Add validation at mission creation time:
```typescript
// Before creating mission, ensure supervisor exists
const { missionExecutionService } = await import("../core/mission-execution.service.js");
await missionExecutionService.ensureSupervisorPipelineForOrg(orgId, userId);
```

### Layer 2: Auto-Create Supervisor Pipeline (Fallback)
**File:** `server/domain/mission/core/mission-execution.service.ts`

Implement `ensureSupervisorPipelineForOrg()`:
1. Check if supervisor pipeline exists
2. If not, auto-create one with default configuration
3. Return the pipeline ID

### Layer 3: UI Warning (User-Facing)
**File:** `server/domain/mission/ui/modules/missions/pages/MissionDetail.tsx`

Add "Mission Readiness" indicator:
- Check supervisor pipeline exists
- Show warning if missing
- Provide "Fix Configuration" button

### Layer 4: Pre-Launch Validation (Last Chance)
**File:** `server/domain/mission/core/mission-execution.service.ts`

Before `launchMission()` returns error, attempt auto-creation:
```typescript
if (!supervisorPipelineId) {
    // Attempt auto-create
    supervisorPipelineId = await this.ensureSupervisorPipelineForOrg(orgId, userId);
    
    if (!supervisorPipelineId) {
        return { success: false, error: "No supervisor pipeline found." };
    }
}
```

## Implementation Steps

### Step 1: Add ensureSupervisorPipelineForOrg method
```typescript
async ensureSupervisorPipelineForOrg(orgId: number | null, userId: string, tx?: any): Promise<number | null> {
    // 1. Check existing
    const [existing] = await db.select({ pipelineId: pipelines.id })
        .from(pipelineSteps)
        .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
        .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
        .where(and(
            eq(jobs.type, "supervisor"),
            orgId ? eq(pipelines.organizationId, orgId) : isNull(pipelines.organizationId)
        ))
        .limit(1);
    
    if (existing) return existing.pipelineId;
    
    // 2. Create supervisor job
    const [supervisorJob] = await db.insert(jobs).values({
        name: "Mission Supervisor",
        type: "supervisor",
        description: "Default mission orchestration supervisor",
        organizationId: orgId,
        createdBy: userId,
        config: {},
        isActive: true
    }).returning();
    
    // 3. Create pipeline
    const [pipeline] = await db.insert(pipelines).values({
        name: "Default Supervisor Pipeline",
        description: "Auto-created supervisor pipeline",
        organizationId: orgId,
        createdBy: userId,
        triggerType: "manual"
    }).returning();
    
    // 4. Link job to pipeline
    await db.insert(pipelineSteps).values({
        pipelineId: pipeline.id,
        jobId: supervisorJob.id,
        order: 0,
        outputName: "supervisor_output"
    });
    
    return pipeline.id;
}
```

### Step 2: Add validation to mission creation route
In `missions.route.ts`, before `missionService.createMission()`:
```typescript
// Ensure supervisor pipeline exists before creating mission
await missionService.ensureSupervisorPipelineForOrg(orgId, userId);
```

### Step 3: Add fallback in launchMission
In `mission-execution.service.ts`, modify the error case:
```typescript
if (!supervisorPipelineId) {
    // Try to auto-create
    supervisorPipelineId = await this.ensureSupervisorPipelineForOrg(orgId, userId);
    
    if (!supervisorPipelineId) {
        return { success: false, error: "No supervisor pipeline found and auto-creation failed." };
    }
}
```

## Benefits

1. **Self-Healing**: System auto-creates missing infrastructure
2. **User-Friendly**: No manual pipeline creation required
3. **Backward Compatible**: Existing missions continue to work
4. **Safe**: Only creates if none exists (idempotent)

## Testing

1. Create new mission in fresh org (no pipelines)
2. Verify supervisor pipeline auto-created
3. Launch mission successfully
4. Verify second mission uses existing supervisor (no duplication)
