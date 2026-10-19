# Slice-23 Evaluation: Event-Driven Triggers (Webhooks)

## Current Implementation Status

### ✅ Already Implemented

1. **Schema Support - Pipelines** (`shared/schema.ts:307-315`)
   - `pipelineTriggerTypes` includes "webhook" ✅
   - `pipelines` table has `triggerType` field ✅
   - `pipelines` table has `triggerCredentialId` field for secured webhooks ✅

2. **Schema Support - Scheduled Jobs** (`shared/schema.ts:706-726`)
   - `triggerTypes` includes "Webhook" ✅
   - `scheduledJobs` table has `triggerType` field ✅

3. **Credential Type Support** (`shared/schema.ts:87-95`)
   - `credentialTypes` includes "webhook" ✅
   - Credentials table can store webhook credentials ✅

4. **UI - Pipeline Form** (`client/src/pages/Pipelines.tsx:173-184`)
   - Pipeline form has "Trigger Method" dropdown with "Webhook" option ✅
   - TRIGGER_TYPES constant includes webhook ✅

### ❌ Missing/Incomplete Features

1. **Webhook API Endpoint - Not Implemented**
   - **Issue**: No API endpoint to receive webhook requests from external systems
   - **Spec Requirement**: `api.triggerWebhook` endpoint (mentioned in spec as "Mock API Endpoint")
   - **Expected Behavior**: 
     - Accept POST requests with API key/secret in headers or query params
     - Validate webhook credential
     - Trigger corresponding pipeline or scheduled job
     - Return success/failure response
   - **Location**: `server/routes.ts` - needs new endpoint like `POST /api/webhook/:id` or `POST /api/webhook/trigger`

2. **Scheduled Jobs Schema - Missing triggerCredentialId**
   - **Issue**: `scheduledJobs` table doesn't have `triggerCredentialId` field
   - **Current Schema**: Only has `triggerType` field
   - **Spec Requirement**: Scheduled jobs should support webhook credentials for secured webhooks
   - **Location**: `shared/schema.ts:709-741`
   - **Impact**: Cannot secure webhook-triggered scheduled jobs

3. **Pipeline Form UI - Missing Credential Selection**
   - **Issue**: When `triggerType` is "webhook", form doesn't show field to select webhook credential
   - **Current Behavior**: Only shows trigger type dropdown, no credential selection
   - **Spec Requirement**: Show credential dropdown when webhook is selected
   - **Location**: `client/src/pages/Pipelines.tsx:173-184`
   - **Expected**: Conditional field that appears when `triggerType === 'webhook'`

4. **Scheduled Jobs Form UI - Missing Webhook Configuration**
   - **Issue**: Scheduled Jobs form doesn't have webhook trigger type or credential selection
   - **Current Behavior**: Form doesn't expose webhook trigger options
   - **Spec Requirement**: Add webhook trigger type and credential selection
   - **Location**: `client/src/components/ScheduledJobs.tsx` (needs update)

5. **Webhook Validation Logic - Not Implemented**
   - **Issue**: No logic to validate webhook credentials when requests arrive
   - **Spec Requirement**: 
     - Extract API key/secret from request (headers or query params)
     - Look up credential by `triggerCredentialId`
     - Compare provided secret with stored secret (from environment variable)
     - Reject if invalid
   - **Location**: New webhook endpoint handler in `server/routes.ts`

6. **Webhook Trigger Execution - Not Implemented**
   - **Issue**: No logic to execute pipeline or scheduled job when webhook is received
   - **Spec Requirement**: 
     - For pipelines: Call `pipelineExecutor.executePipeline(pipelineId, userId)`
     - For scheduled jobs: Trigger job execution (similar to manual trigger)
   - **Location**: New webhook endpoint handler

7. **Webhook URL Generation - Not Implemented**
   - **Issue**: No way to generate or display webhook URLs for users
   - **Spec Requirement**: 
     - Generate unique webhook URLs (e.g., `/api/webhook/trigger/:pipelineId` or `/api/webhook/trigger/:scheduledJobId`)
     - Display webhook URL in UI when webhook trigger is configured
     - Include instructions on how to use the webhook
   - **Location**: 
     - Backend: Webhook endpoint
     - Frontend: Pipeline detail page and Scheduled Job detail page

8. **Schema Validation - Missing triggerCredentialId**
   - **Issue**: Pipeline schema validation doesn't include `triggerCredentialId`
   - **Location**: `shared/schema.ts:322-329` (`insertPipelineSchema`)
   - **Impact**: Cannot save webhook credentials when creating/updating pipelines

## Required Changes

### 1. Add Webhook API Endpoint

**File**: `server/routes.ts`

- Add `POST /api/webhook/trigger/:id` endpoint
- Accept webhook requests with:
  - API key in header (e.g., `X-API-Key`) or query parameter
  - Optional payload in request body
- Validate webhook credential:
  - Get pipeline or scheduled job by ID
  - Check if `triggerType` is "webhook"
  - Get credential from `triggerCredentialId`
  - Compare provided API key with credential's `envVarName` value from environment
- Execute pipeline or scheduled job:
  - For pipelines: Call `pipelineExecutor.executePipeline(pipelineId, 'webhook')`
  - For scheduled jobs: Trigger job execution
- Return success/failure response

**Alternative Approach**: 
- Use separate endpoints: `POST /api/webhook/pipeline/:id` and `POST /api/webhook/scheduled-job/:id`
- Or use a single endpoint with type parameter: `POST /api/webhook/trigger/:type/:id`

### 2. Update Scheduled Jobs Schema

**File**: `shared/schema.ts:709-741`

- Add `triggerCredentialId` field to `scheduledJobs` table:
  ```typescript
  triggerCredentialId: integer("trigger_credential_id"), // For secured webhooks
  ```
- Update `insertScheduledJobSchema` to include optional `triggerCredentialId`
- Add foreign key reference to credentials table (optional, nullable)

### 3. Update Pipeline Form UI

**File**: `client/src/pages/Pipelines.tsx`

- Update `PipelineCreateSchema` to include `triggerCredentialId`:
  ```typescript
  triggerCredentialId: z.number().int().positive().optional().nullable(),
  ```
- Add conditional credential selection field:
  - Show when `triggerType === 'webhook'`
  - Fetch webhook credentials (where `type === 'webhook'`)
  - Display dropdown to select credential
  - Update form layout to accommodate new field

### 4. Update Scheduled Jobs Form UI

**File**: `client/src/components/ScheduledJobs.tsx`

- Add `triggerType` field to form
- Add conditional credential selection when `triggerType === 'Webhook'`
- Update form state and submission logic
- Display webhook URL when webhook trigger is configured

### 5. Update Pipeline Schema Validation

**File**: `shared/schema.ts:322-329`

- Update `insertPipelineSchema` to include:
  ```typescript
  triggerCredentialId: z.number().int().positive().optional().nullable(),
  ```

### 6. Add Webhook URL Display

**Files**: 
- `client/src/pages/Pipelines.tsx` (Pipeline detail view)
- `client/src/components/ScheduledJobs.tsx` (Scheduled job detail view)

- Display webhook URL when webhook trigger is configured
- Format: `POST https://your-domain.com/api/webhook/trigger/pipeline/:id` or similar
- Include copy-to-clipboard button
- Show API key usage instructions

### 7. Update API Routes for Pipeline Creation

**File**: `server/routes.ts`

- Update `POST /api/pipelines` and `PUT /api/pipelines/:id` to:
  - Accept `triggerCredentialId` in request body
  - Validate that credential exists and is of type "webhook" when `triggerType === 'webhook'`
  - Store `triggerCredentialId` in database

### 8. Update API Routes for Scheduled Job Creation

**File**: `server/routes.ts`

- Update `POST /api/scheduled-jobs` and `PUT /api/scheduled-jobs/:id` to:
  - Accept `triggerCredentialId` in request body
  - Validate credential when `triggerType === 'Webhook'`
  - Store `triggerCredentialId` in database

## Implementation Notes

- **Webhook Security**: 
  - Use API key/secret authentication
  - Store secrets in environment variables (via credential's `envVarName`)
  - Validate on every webhook request
  - Consider rate limiting for webhook endpoints

- **Webhook Payload**: 
  - Webhook endpoint should accept optional payload
  - Payload can be passed to job execution (if job supports parameters)
  - Consider storing webhook payload in execution metadata

- **Error Handling**:
  - Return 401 if credential validation fails
  - Return 404 if pipeline/scheduled job not found
  - Return 400 if trigger type is not "webhook"
  - Return 500 if execution fails

- **Webhook URL Format**:
  - Consider using unique tokens instead of IDs for security
  - Or use signed URLs with expiration
  - For MVP, simple ID-based URLs are acceptable

- **Backward Compatibility**:
  - Existing pipelines/scheduled jobs without webhook triggers should continue to work
  - `triggerCredentialId` should be optional/nullable

## Dependencies

- Requires credential management system (already exists)
- Requires pipeline executor (already exists)
- Requires scheduled job execution logic (may need to be implemented)
- Uses existing authentication/authorization system

## UI/UX Considerations

- Webhook credential selection should only appear when webhook trigger is selected
- Webhook URL should be clearly displayed and easy to copy
- Include instructions on how to use webhook (HTTP method, headers, payload format)
- Show webhook status (active/inactive) based on pipeline/scheduled job status
- Consider adding webhook test button to verify webhook configuration

## Testing Considerations

- Test webhook endpoint with valid credentials
- Test webhook endpoint with invalid credentials
- Test webhook endpoint with missing credentials
- Test webhook endpoint for non-existent pipelines/scheduled jobs
- Test webhook endpoint for pipelines/scheduled jobs without webhook trigger type
- Test pipeline execution via webhook
- Test scheduled job execution via webhook
- Test webhook URL generation and display

