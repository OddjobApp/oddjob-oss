# Phase 1: Job Type Consolidation Migration Guide

## Summary

This migration consolidates redundant job types and removes orphaned types that had no backend implementation.

## Changes Made

### 1. Deprecated: `api` → `curl`

The `api` job type is now deprecated in favor of `curl`. Both types share the same executor and configuration schema.

**Backward Compatibility:** ✅ The `api` type still works for existing jobs, but:
- New jobs should use `curl` type
- UI now shows "API Call (Legacy)" with gray styling
- Migration helper available: `migrateJobType("api")` returns `"curl"`

### 2. Removed Orphaned Types (No Executors)

These types were removed from the UI configuration as they had no backend implementation:

| Type | Reason |
|------|--------|
| `document` | No executor, no schema - document processing is handled via folder_import + extraction |
| `workflow` | Confusion with Pipeline concept - needs clarification before implementation |
| `safety` | No executor - content moderation should be governance policy, not job type |
| `integration` | Too generic - specific integrations have their own types |
| `webhook` | Only had outgoing webhook (POST) - incoming webhooks need different architecture |

## Data Migration

### For Existing `api` Jobs

Option 1: Migrate existing jobs to `curl` type (recommended):

```sql
-- Review affected jobs
SELECT id, name, type, organization_id 
FROM jobs 
WHERE type = 'api';

-- Migrate to curl type
UPDATE jobs 
SET type = 'curl', 
    updated_at = NOW()
WHERE type = 'api';
```

Option 2: Keep existing jobs as `api` (backward compatible)
- The ApiExecutor handles both `api` and `curl` types
- No immediate action required

### For Removed Types

If you had jobs with these types (unlikely, as no executors existed):

```sql
-- Check for any existing jobs with removed types
SELECT id, name, type, organization_id 
FROM jobs 
WHERE type IN ('document', 'workflow', 'safety', 'integration', 'webhook');
```

If any exist, they would have failed to execute. Options:
1. Delete them: `DELETE FROM jobs WHERE type IN (...)`
2. Recreate as appropriate type (e.g., `folder_import` for document processing)

## Code Changes

### Files Modified

1. `@server/domain/jobs/ui/job-type-config.ts`
   - Added `isDeprecated`, `migrateTo`, `deprecationReason` fields to interface
   - Marked `api` as deprecated, points to `curl`
   - Removed orphaned types: document, workflow, safety, integration, webhook
   - Cleaned up unused icon imports

2. `@shared/schema/jobs/types.ts`
   - Added `DEPRECATED_JOB_TYPES` mapping
   - Added `migrateJobType()` helper function
   - Added deprecation comment to `api` in jobTypes array

3. `@shared/schema/jobs/table.ts`
   - Updated comment on `api` entry in discriminated union

4. `@server/config/jobs/schemas.ts`
   - Removed deprecated `api` schema entry (was just a pointer to `curl`)

## Testing Checklist

- [ ] Existing `api` jobs still execute correctly
- [ ] New `curl` jobs can be created
- [ ] UI shows deprecation styling for `api` type
- [ ] No orphaned types appear in job creation dropdown
- [ ] Icon imports don't cause build errors

## Rollback

If needed, restore the removed types by reverting the commits to:
- `server/domain/jobs/ui/job-type-config.ts`
