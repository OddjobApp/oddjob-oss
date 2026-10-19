# Missing Pipeline Diagnosis: "Summarize Issues"

## Issue Found

The pipeline exists in the database but may not be visible due to **organization context filtering**.

### Pipeline Details
- **ID:** 23
- **Name:** "Summarize Issue" (note: singular, not plural)
- **Organization ID:** NULL (no organization assigned)
- **Created by:** superadmin
- **Status:** Active

## Root Cause

The pipeline list endpoint (`GET /api/pipelines`) filters pipelines by organization:

```typescript
const conditions = orgContext.organizationId !== null
  ? [eq(pipelines.organizationId, orgContext.organizationId)]
  : [sql`${pipelines.organizationId} IS NULL`];
```

**What this means:**
- If you're logged in with an organization context (`organizationId` is not null), you only see pipelines belonging to that organization
- If you have no organization (`organizationId` is null), you only see pipelines with `organizationId = NULL`
- The "Summarize Issue" pipeline has `organizationId = NULL`, so:
  - ✅ Visible if you're logged in without an organization context
  - ❌ Hidden if you're logged in with an organization context

## Solutions

### Option 1: Assign Pipeline to Your Organization (Recommended)
If you have admin access, you can update the pipeline to belong to your organization:

1. Find your organization ID
2. Update the pipeline's `organizationId` field
3. The pipeline will then appear in your list

### Option 2: Remove Your Organization Context
If you don't need organization filtering for this pipeline, you can:
1. Log in without an organization context
2. Or update your user's default organization

### Option 3: Admin Override
Admins should be able to see all pipelines regardless of organization. This might need a fix if it's not working correctly.

## Quick Fix Script

Run this to check if the pipeline exists and see its organization:

```bash
npx tsx scripts/find-pipeline.ts "Summarize Issue"
```

Or search for all pipelines:

```bash
npx tsx scripts/find-pipeline.ts ""
```

## Next Steps

1. **Verify:** Check if the pipeline shows up when logged in without an organization
2. **Fix:** Either assign the pipeline to your organization or adjust organization context
3. **Prevent:** Consider making organization filtering optional for admins

