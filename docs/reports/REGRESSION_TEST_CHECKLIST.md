# Regression Test Checklist

This checklist can be used for manual testing of the application. Check off each item as you complete it.

## Prerequisites
- [ ] Server is running on port 5000 (`npm run dev`)
- [ ] Database migrations are applied (`npm run db:push`)
- [ ] Migration `add_transformation_system.sql` has been applied (adds input_schema and output_schema columns to jobs table)
- [ ] Seed script `seed_jira_solver.ts` has been run (creates V1 pipeline)
- [ ] Test user account exists
- [ ] Browser with DevTools console open
- [ ] Test API credentials available (for testing CURL/API jobs with schema capture)

---

## Phase 1: Critical Paths (Must Pass)

### Authentication
- [ ] Navigate to `/auth/login` - login form displays
- [ ] Login with valid credentials - redirects to dashboard
- [ ] Session persists after page refresh
- [ ] Logout works and redirects to login
- [ ] Protected routes redirect to login when not authenticated

### Dashboard
- [ ] Navigate to `/dashboard` - page loads
- [ ] Statistics cards display correctly
- [ ] All metrics are clickable/navigable

### Jobs Management
- [ ] Navigate to `/jobs` - list loads
- [ ] Create new shell job - saves successfully
- [ ] Create new curl job - saves successfully
- [ ] Create new python job - saves successfully
- [ ] Create new AI API Call job - saves successfully
- [ ] Create new repeater job - saves successfully
- [ ] Create new transformer job - saves successfully
- [ ] Edit existing job - changes persist
- [ ] Delete job - removes from list
- [ ] Job detail page displays all fields correctly
- [ ] Job detail page shows "Test & Capture" tab
- [ ] Job detail page shows "Schemas" tab

#### Repeater Job Type (NEW FEATURE)
- [ ] Navigate to job creation form, select "Repeater" job type
- [ ] Repeater configuration form appears with all fields
- [ ] Input Source field accepts variable references (e.g., `{{step.1.output}}`)
- [ ] Nested Job Type dropdown shows options: CURL, API
- [ ] Item Variable Name field accepts custom variable name (default: "item")
- [ ] Max Iterations field accepts positive numbers (optional)
- [ ] Wait Between Iterations (ms) field accepts non-negative numbers (default: 0)
- [ ] Stop on Error checkbox works correctly
- [ ] Nested CURL Configuration section displays
- [ ] Nested URL field supports {{item.field}} and {{item["field"]}} variables
- [ ] Nested HTTP Method dropdown works correctly
- [ ] Nested Request Type and Response Type dropdowns work correctly
- [ ] Nested authentication configuration works correctly
- [ ] Nested query parameters field accepts JSON with item variables
- [ ] Nested headers field accepts JSON with item variables
- [ ] Nested request body field accepts text with item variables

**Repeater Job Creation**
- [ ] Create repeater job with valid configuration - saves successfully
- [ ] Validation: Input Source is required - shows error if empty
- [ ] Validation: Nested URL is required - shows error if empty
- [ ] Validation: Max Iterations must be positive number - shows error if invalid
- [ ] Validation: Wait Between Iterations must be non-negative - shows error if negative
- [ ] Validation: Nested query parameters must be valid JSON - shows error if invalid
- [ ] Validation: Nested headers must be valid JSON - shows error if invalid
- [ ] Repeater job appears in jobs list with "Repeater" badge

**Repeater Job Editing**
- [ ] Navigate to repeater job detail page - all config fields display correctly
- [ ] Edit Input Source - saves successfully
- [ ] Edit Nested Job Type - saves successfully
- [ ] Edit Item Variable Name - saves successfully
- [ ] Edit Max Iterations - saves successfully
- [ ] Edit Wait Between Iterations - saves successfully
- [ ] Toggle Stop on Error checkbox - saves successfully
- [ ] Edit nested CURL configuration fields - saves successfully
- [ ] All repeater config fields persist after page refresh

**Repeater Job Edit Screen - Nested CURL Configuration Fields (CRITICAL FIX)**
- [ ] Navigate to repeater job detail page and click Edit
- [ ] Authentication Type dropdown appears in Nested CURL Configuration section
- [ ] Authentication Type dropdown shows options: None, Bearer Token, Basic Auth
- [ ] Credential dropdown appears in Nested CURL Configuration section
- [ ] Credential dropdown is disabled when Authentication Type is "None"
- [ ] Credential dropdown is enabled and shows available API/JIRA credentials when auth type is set
- [ ] Query Parameters (JSON) textarea field appears in Nested CURL Configuration section
- [ ] Headers (JSON) textarea field appears in Nested CURL Configuration section
- [ ] Query Parameters field accepts JSON with item variables (e.g., `{"param": "{{item.key}}"}`)
- [ ] Headers field accepts JSON with item variables (e.g., `{"X-Custom-Header": "{{item.id}}"}`)
- [ ] Help text displays: "Use {{item.field}} to reference array item fields" for Query Parameters
- [ ] Help text displays: "Authorization header will be added automatically if using credentials" for Headers
- [ ] Set Authentication Type to "Basic Auth" - saves successfully
- [ ] Select a credential from dropdown - saves successfully
- [ ] Enter query parameters JSON - saves successfully
- [ ] Enter headers JSON - saves successfully
- [ ] Save button works correctly when all nested CURL fields are filled
- [ ] Validation: Query Parameters must be valid JSON - shows error if invalid JSON
- [ ] Validation: Headers must be valid JSON - shows error if invalid JSON
- [ ] Query Parameters and Headers are parsed from JSON strings correctly on save
- [ ] Nested CURL config with all fields (auth, credential, query params, headers, body) saves successfully
- [ ] All nested CURL configuration fields persist after page refresh
- [ ] Console shows debug logs: "[Repeater] Processing repeater config" on save
- [ ] Console shows debug logs: "[Repeater] Nested config validation passed" on successful validation
- [ ] Console shows debug logs: "[Repeater] Config validated and added to updates" on successful save

**Variable Substitution**
- [ ] Variable {{item.key}} resolves to item's "key" field
- [ ] Variable {{item["KUS: Feature"]}} resolves to item's "KUS: Feature" field (bracket notation)
- [ ] Variable {{item.index}} resolves to array index (0-based)
- [ ] Variables work in nested URL (e.g., `https://api.example.com/{{item.key}}`)
- [ ] Variables work in nested request body (e.g., `{"key": "{{item.key}}"}`)
- [ ] Variables work in nested query parameters JSON
- [ ] Variables work in nested headers JSON
- [ ] Error handling: Missing field in item shows clear error message
- [ ] Error handling: Invalid variable syntax shows clear error message

**Repeater Job Execution in Pipelines**
- [ ] Create pipeline with Step 1: Python job outputting JSON array
- [ ] Create pipeline with Step 2: Repeater job using `{{step.0.output}}` as input source
- [ ] Step 2 nested config uses {{item.key}} and {{item["field"]}} variables
- [ ] Execute pipeline - repeater job processes all items in array
- [ ] Repeater job waits specified milliseconds between iterations (if configured)
- [ ] Repeater job stops on first error when stopOnError is true
- [ ] Repeater job continues on errors when stopOnError is false
- [ ] Repeater job respects maxIterations limit
- [ ] Repeater job returns JSON array of results (one per item)
- [ ] Results array contains success/error status for each item
- [ ] Results array contains itemIndex for each result
- [ ] Step 2 output shows formatted JSON array of all iteration results
- [ ] Subsequent pipeline steps can use Step 2 output

#### Transformer Job Type (NEW FEATURE)
- [ ] Navigate to job creation form, select "Transformer" job type
- [ ] Transformer configuration form appears with all fields
- [ ] Input Source dropdown shows options: "Previous Step", "Provided"
- [ ] Transformation Rules section displays with add/remove buttons
- [ ] Rule builder shows: Source Path, Transform Type, Target Path fields
- [ ] Transform Type dropdown shows: direct, wrap_object, map_value, parse_json, to_string, extract_field
- [ ] Config panel appears conditionally based on transform type
- [ ] Wrap Object config shows "Wrapper Key" field
- [ ] Map Value config shows mapping table editor
- [ ] Extract Field config shows "Extract Path" field
- [ ] Entity Extraction section appears with enable/disable toggle
- [ ] Entity Rules builder appears when entity extraction enabled
- [ ] Relationship Rules builder appears when entity extraction enabled

**Transformer Job Creation**
- [ ] Create transformer job with valid configuration - saves successfully
- [ ] Validation: At least one transformation rule is required - shows error if empty
- [ ] Validation: Source Path is required for each rule - shows error if empty
- [ ] Validation: Target Path is required for each rule - shows error if empty
- [ ] Validation: Wrapper Key required for wrap_object type - shows error if missing
- [ ] Validation: Mapping required for map_value type - shows error if missing
- [ ] Validation: Extract Path required for extract_field type - shows error if missing
- [ ] Transformer job appears in jobs list with "Transformer" badge

**Schema Capture (Test & Capture)**
- [ ] Navigate to job detail page - "Test & Capture" tab appears
- [ ] Test & Capture tab shows "Run Step (Dry)" button
- [ ] For CURL/API jobs: Test execution shows live JSON response
- [ ] For AI jobs: Test execution shows AI response output
- [ ] JSON viewer displays response with syntax highlighting
- [ ] Schema preview shows detected fields with types
- [ ] Key detection indicators (badges/icons) appear on key fields
- [ ] Key fields are highlighted (id, key, uuid patterns detected)
- [ ] "Save Output Schema" button appears after test run
- [ ] Clicking "Save Output Schema" saves schema to job
- [ ] Schema is saved with captured timestamp
- [ ] Input schema capture works for transformer jobs (if input provided)
- [ ] Both input and output schemas can be captured

**Schema Viewer**
- [ ] Navigate to job detail page - "Schemas" tab appears
- [ ] Schemas tab shows input schema (if captured)
- [ ] Schemas tab shows output schema (if captured)
- [ ] Schema viewer displays flattened schema with dot notation
- [ ] Field types are displayed (string, number, object, array, etc.)
- [ ] Required status is indicated for fields
- [ ] Key indicators show which fields are keys
- [ ] Foreign key indicators show which fields are foreign keys
- [ ] Foreign key targets are displayed
- [ ] Sample values are shown for each field
- [ ] Edit schema annotations button works
- [ ] Can mark/unmark fields as keys
- [ ] Can set foreign key targets
- [ ] Schema changes save successfully

**Transformation Rules**
- [ ] Add transformation rule - new rule row appears
- [ ] Source Path dropdown populated from previous step's schema (if available)
- [ ] Source Path can be manually entered with dot notation
- [ ] Transform Type selection updates config panel
- [ ] Target Path accepts dot notation paths
- [ ] Live preview shows transformation result
- [ ] Preview updates as rules are modified
- [ ] Remove rule button removes rule from list
- [ ] Multiple rules can be added
- [ ] Rules are executed in order
- [ ] Direct transform copies value from source to target
- [ ] Wrap Object transform wraps value in object with wrapper key
- [ ] Map Value transform maps values using lookup table
- [ ] Parse JSON transform parses JSON strings
- [ ] To String transform converts value to string
- [ ] Extract Field transform extracts nested field from object

**Entity Extraction Configuration**
- [ ] Enable entity extraction toggle works
- [ ] Entity Rules section appears when enabled
- [ ] Add Entity Rule button creates new rule
- [ ] Entity Type field accepts text input
- [ ] Label field accepts text input
- [ ] Name mapping path selector works
- [ ] External ID mapping path selector works (optional)
- [ ] Data mappings table allows adding field mappings
- [ ] Auto-suggestions appear based on schema keys
- [ ] Relationship Rules section appears when enabled
- [ ] Add Relationship Rule button creates new rule
- [ ] Relation field accepts text input
- [ ] Source Entity dropdown populated from entity rules
- [ ] Target Entity dropdown populated from entity rules
- [ ] Source Path and Target Path selectors work
- [ ] Weight field accepts number input (optional)
- [ ] Condition field accepts text input (optional)

**Transformer Job Execution in Pipelines**
- [ ] Create pipeline with Step 1: CURL job fetching JSON data
- [ ] Create pipeline with Step 2: Transformer job using "Previous Step" input
- [ ] Step 2 transformation rules configured to reshape data
- [ ] Execute pipeline - transformer processes Step 1 output
- [ ] Transformer output shows transformed data structure
- [ ] Step 2 output is valid JSON
- [ ] Subsequent pipeline steps can use Step 2 output
- [ ] Entity extraction creates knowledge graph nodes (if enabled)
- [ ] Relationship extraction creates knowledge graph edges (if enabled)
- [ ] Knowledge graph nodes appear in Knowledge Graph Explorer
- [ ] Knowledge graph edges appear in Knowledge Graph Explorer

**Error Handling**
- [ ] Missing previous step output - shows error: "No previous step output available for transformer"
- [ ] Invalid source path - transformation returns undefined (doesn't fail)
- [ ] Invalid target path - shows validation error
- [ ] Missing required config (wrapperKey, mapping, etc.) - shows validation error
- [ ] Entity extraction failure - logs error but doesn't fail step
- [ ] Knowledge graph creation failure - logs error but doesn't fail step

**Backend Execution**
- [ ] Test endpoint (`/api/jobs/:id/test`) supports transformer jobs
- [ ] Test endpoint captures schemas when `captureInputSchema` or `captureOutputSchema` flags set
- [ ] Schema endpoints (`/api/jobs/:id/schemas`) GET returns saved schemas
- [ ] Schema endpoints (`/api/jobs/:id/schemas`) POST saves schemas
- [ ] Pipeline executor executes transformer jobs correctly
- [ ] Transformation engine processes arrays in batches
- [ ] Transformation engine caches compiled rules
- [ ] Knowledge graph extractor creates nodes and edges correctly

**Wait Period Between Iterations**
- [ ] Create repeater job with waitBetweenIterationsMs = 500
- [ ] Execute repeater job with 3 items in array
- [ ] Verify execution takes at least 1000ms (2 waits × 500ms)
- [ ] Verify API calls are not sent simultaneously (check timestamps/logs)
- [ ] Wait period of 0ms sends requests immediately (no delay)
- [ ] Wait period prevents overwhelming external services

**Error Handling**
- [ ] Empty array input - repeater returns empty results array
- [ ] Invalid JSON in input source - shows clear error: "Failed to parse input source as JSON array"
- [ ] Input source resolves to non-array - shows error: "Input source must resolve to a JSON array"
- [ ] Max iterations limit exceeded - only processes first N items (logs warning)
- [ ] stopOnError: true - stops after first failed iteration, returns partial results
- [ ] stopOnError: false - continues processing all items, returns all results (including failures)
- [ ] Individual iteration failure includes error message in result
- [ ] Nested CURL job failures are caught and reported per item

**Backend Execution**
- [ ] Test endpoint (`/api/jobs/:id/test`) supports repeater jobs
- [ ] Test endpoint validates repeater config structure
- [ ] Test endpoint executes single iteration with mock item for testing
- [ ] Pipeline executor processes repeater jobs correctly
- [ ] Python runner processes repeater jobs correctly
- [ ] Scheduled repeater jobs execute correctly via Python runner
- [ ] Repeater job execution logs show iteration progress

**Edge Cases**
- [ ] Repeater with single item in array - processes correctly
- [ ] Repeater with large array (100+ items) - processes all items
- [ ] Repeater with maxIterations limit - stops at limit
- [ ] Repeater with very long wait period - still processes correctly
- [ ] Repeater with special characters in item field names - bracket notation works
- [ ] Repeater with nested objects in items - JSON stringification works correctly
- [ ] Repeater output can be used as input to another repeater (nested looping)

#### RAG Asset Management (NEW FEATURE)
- [ ] Navigate to job detail page with job that has "RAG Resource" tool - RAG Assets section appears
- [ ] Click "Add Asset" button - form expands
- [ ] Attachment Source dropdown shows options: Custom upload or link, Knowledge document, Knowledge topic
- [ ] Select "Custom upload or link" - custom asset form displays

##### Text Asset Creation (CRITICAL FIX)
- [ ] Select Asset Type "Text" - Source dropdown is disabled (Text assets use text input)
- [ ] Enter asset name (e.g., "Product FAQ")
- [ ] Enter text content in Textarea (e.g., "Q: How do I reset my password? A: Click 'Forgot Password'...")
- [ ] Character counter displays correct count below textarea
- [ ] Click "Add Asset" button - text asset saves successfully
- [ ] Text asset appears in asset list with correct name
- [ ] Text asset displays "Text • X chars" metadata (where X is character count)
- [ ] Asset count increments correctly (e.g., "RAG Assets (1/3)")
- [ ] Success toast notification appears: "RAG asset added successfully"
- [ ] Form closes after successful save
- [ ] Text asset persists after page refresh
- [ ] Text content is saved correctly in database (verify via API or database query)
- [ ] Validation: Asset name is required - shows error if empty
- [ ] Validation: Text content is required for Text assets - shows error if empty
- [ ] Validation: Whitespace-only text content is rejected - shows error
- [ ] Can create multiple text assets (up to 3 total)
- [ ] Text asset can be deleted successfully
- [ ] Text asset character count displays correctly in metadata

##### File Upload Asset Creation
- [ ] Select Asset Type "PDF" (or other file type)
- [ ] Select Source "Upload"
- [ ] Click file input - file picker opens
- [ ] Select valid file (< 10MB) - file name and size display
- [ ] Enter asset name
- [ ] Click "Add Asset" - file asset saves successfully
- [ ] File asset appears in asset list
- [ ] File asset displays file size in metadata (e.g., "PDF • 2.45 MB")
- [ ] Validation: File is required for upload assets - shows error if no file selected
- [ ] Validation: File size limit (10MB) - shows error if file exceeds limit

##### URL Link Asset Creation
- [ ] Select Asset Type "URLs"
- [ ] Select Source "Link"
- [ ] Enter asset name
- [ ] Enter valid URL (e.g., "https://example.com/doc.pdf")
- [ ] Click "Add Asset" - URL asset saves successfully
- [ ] URL asset appears in asset list
- [ ] URL asset displays "URLs • Link" metadata
- [ ] Validation: URL is required for link assets - shows error if empty
- [ ] Validation: URL format validation works correctly

##### Knowledge Document/Topic Attachment
- [ ] Select Attachment Source "Knowledge document"
- [ ] Knowledge document dropdown shows available documents
- [ ] Select a document - asset saves successfully
- [ ] Document asset shows "Document" badge
- [ ] Select Attachment Source "Knowledge topic"
- [ ] Knowledge topic dropdown shows available topics
- [ ] Select a topic - asset saves successfully
- [ ] Topic asset shows "Topic" badge

##### Asset Management
- [ ] Maximum 3 assets enforced - "Add Asset" button disappears after 3 assets
- [ ] "Maximum of 3 assets reached" message displays when limit reached
- [ ] Drag and drop reordering works - assets can be reordered
- [ ] Asset order persists after page refresh
- [ ] Delete asset (X button) - asset removes from list
- [ ] Delete asset - counter decrements correctly
- [ ] Delete asset - "Add Asset" button reappears if was at max
- [ ] Asset deletion shows success toast: "Asset removed"

##### Backend API Tests - RAG Assets
- [ ] `POST /api/rag-assets` creates text asset with textContent correctly
- [ ] `POST /api/rag-assets` validates textContent is required for Text assets (returns 400 if missing)
- [ ] `POST /api/rag-assets` validates textContent is not empty for Text assets (returns 400 if empty/whitespace)
- [ ] `POST /api/rag-assets` validates fileData is required for upload assets (except Text)
- [ ] `POST /api/rag-assets` validates URL is required for link assets (returns 400 if missing)
- [ ] `POST /api/rag-assets` validates maximum 3 assets per job (returns 400 if exceeded)
- [ ] `POST /api/rag-assets` validates file size limit (10MB) - returns 400 if exceeded
- [ ] `GET /api/rag-assets?jobId=X` returns assets for specific job
- [ ] `DELETE /api/rag-assets/:id` removes asset successfully
- [ ] `POST /api/rag-assets/reorder` updates asset order correctly
- [ ] All RAG asset endpoints require authentication
- [ ] All RAG asset endpoints filter by organization context

##### Request and Response Type Selection for CURL/API Jobs (NEW FEATURE)
- [ ] Navigate to job creation form, select CURL or API job type
- [ ] "Request Type" dropdown appears after "HTTP Method" field
- [ ] "Response Type" dropdown appears after "Request Type" field
- [ ] Default Request Type: "JSON" for POST/PUT/PATCH methods, "Custom" for GET/DELETE
- [ ] Default Response Type: "Text"
- [ ] Request Type options: JSON, Text, Form-Data, XML, Custom
- [ ] Response Type options: JSON, Text, Auto
- [ ] Help text displays: "Content-Type header will be set automatically for JSON" for Request Type
- [ ] Help text displays: "JSON responses will be parsed and formatted" for Response Type

**Request Type: JSON**
- [ ] Create POST job with Request Type "JSON" and valid JSON body
- [ ] Save job - job saves successfully
- [ ] Execute job via test endpoint - Content-Type: application/json header is automatically set
- [ ] Verify body is validated as JSON - invalid JSON body shows error: "Invalid JSON in request body"
- [ ] Create PUT job with Request Type "JSON" - Content-Type header is set automatically
- [ ] Create PATCH job with Request Type "JSON" - Content-Type header is set automatically
- [ ] Custom headers with Content-Type override automatic setting (manual header takes precedence)

**Request Type: Custom**
- [ ] Create GET job with Request Type "Custom" - no automatic Content-Type header
- [ ] Create DELETE job with Request Type "Custom" - no automatic Content-Type header
- [ ] Manual headers are used as-is when Request Type is "Custom"

**Response Type: JSON**
- [ ] Create GET job with Response Type "JSON"
- [ ] Execute job - API returns JSON response
- [ ] Verify response is parsed and formatted (indented with 2 spaces)
- [ ] Invalid JSON response shows error: "Response is not valid JSON"
- [ ] Response format is preserved (keys, structure maintained after parsing/formatting)
- [ ] Use formatted JSON in pipeline step output - data is accessible as string

**Response Type: Text**
- [ ] Create job with Response Type "Text"
- [ ] Execute job - raw response text is returned (no parsing)
- [ ] Non-JSON responses work correctly with Response Type "Text"
- [ ] Binary/text responses are preserved exactly as received

**Response Type: Auto**
- [ ] Create job with Response Type "Auto"
- [ ] Execute job with Content-Type: application/json header - JSON is parsed and formatted
- [ ] Execute job with Content-Type: text/plain header - raw text is returned
- [ ] Execute job with no Content-Type header - raw text is returned

**Pipeline Workflow: GET JSON → AI Transform → PUT JSON**
- [ ] Create Step 1: GET job to fetch JIRA issue, Response Type: JSON
- [ ] Step 1 returns formatted JSON string
- [ ] Create Step 2: AI job with prompt using {{step.0.output}} variable
- [ ] AI job receives formatted JSON string, processes it
- [ ] AI job outputs updated JSON string
- [ ] Create Step 3: PUT job to update JIRA issue, Request Type: JSON
- [ ] Step 3 receives AI output via {{step.1.output}} variable
- [ ] Step 3 validates JSON body, sets Content-Type header
- [ ] Step 3 successfully updates JIRA issue
- [ ] End-to-end pipeline execution works correctly

**Job Editing**
- [ ] Edit existing CURL job - Request Type and Response Type fields display current values
- [ ] Change Request Type from "Custom" to "JSON" - saves successfully
- [ ] Change Response Type from "Text" to "JSON" - saves successfully
- [ ] Change HTTP Method from GET to POST - Request Type default updates to "JSON"
- [ ] Change HTTP Method from POST to GET - Request Type default updates to "Custom"

**Backend Execution**
- [ ] Test endpoint (`/api/jobs/:id/test`) respects Request Type and Response Type settings
- [ ] Pipeline executor respects Request Type and Response Type settings
- [ ] Python runner respects Request Type and Response Type settings
- [ ] Scheduled job execution via Python runner works with Request/Response types

**Backward Compatibility**
- [ ] Existing jobs without requestType/responseType fields work correctly (defaults applied)
- [ ] Existing jobs default to "text" response type
- [ ] Existing POST/PUT/PATCH jobs default to "json" request type
- [ ] Existing GET/DELETE jobs default to "custom" request type

**Error Handling**
- [ ] Invalid JSON in request body with Request Type "JSON" - clear error message
- [ ] Invalid JSON in response with Response Type "JSON" - clear error message
- [ ] Error messages include snippet of problematic JSON when possible
- [ ] Pipeline stops on JSON validation errors with clear error message

##### RAG Asset Execution in AI Jobs (Python Runner)
- [ ] Create AI job with tool set to "RAG Resource"
- [ ] Add text RAG asset to job
- [ ] Add file upload RAG asset (PDF) to job
- [ ] Schedule job execution via scheduler/runner (or execute directly from queue)
- [ ] Verify Python runner detects `tool = "RAG Resource"` and fetches RAG assets
- [ ] For Gemini models: Verify files are uploaded to Gemini Files API
- [ ] For Gemini models: Verify file attachments are included in Gemini API request
- [ ] For Gemini models: Verify API call includes `fileData` with `fileUri` and `mimeType` in request parts
- [ ] For non-Gemini providers: Verify RAG context text is appended to user prompt
- [ ] Verify job execution completes successfully with RAG assets
- [ ] Verify AI response includes information from RAG assets
- [ ] Test with multiple RAG assets (text + file + URL) - all are processed correctly
- [ ] Test with Gemini model that supports file attachments (e.g., gemini-1.5-pro, gemini-1.5-flash)
- [ ] Test error handling: Gemini model that doesn't support file attachments shows appropriate error
- [ ] Verify scheduled jobs with RAG assets execute correctly through Python runner
- [ ] Verify RAG assets are fetched from database in correct order (by `order` field)
- [ ] Test text assets are included in RAG context for non-Gemini providers
- [ ] Test file assets are uploaded and attached for Gemini providers
- [ ] Test URL assets are fetched and processed correctly
- [ ] Verify Python runner logs show RAG asset processing messages

### Pipelines Management
- [ ] Navigate to `/pipelines` - list loads
- [ ] Create new pipeline with steps - saves successfully
- [ ] Edit pipeline - add/remove/reorder steps works
- [ ] Pipeline detail page displays correctly
- [ ] Delete pipeline - removes from list

### Pipeline Execution
- [ ] Click "Run Now" on pipeline - execution starts
- [ ] View execution results - details display correctly
- [ ] Navigate to executions list - history displays
- [ ] View execution detail - step-by-step results visible
- [ ] Pipeline step execution with status "waiting_external_input" is supported
- [ ] Pipeline resume endpoint `/api/pipelines/:id/resume` requires authentication
- [ ] Pipeline resume validates execution is in "running" status
- [ ] Pipeline resume rebuilds variable context from completed steps
- [ ] Pipeline resume identifies next step to execute correctly

### Pipeline Version Control (NEW FEATURE)
- [ ] History button appears on pipeline detail page
- [ ] Click History - VersionHistorySheet opens
- [ ] Empty state displays when no versions exist
- [ ] Create version snapshot via API or UI
- [ ] Version appears in history list with correct details
- [ ] Click restore on a version - confirmation dialog appears
- [ ] Confirm restore - pipeline configuration restored
- [ ] Verify all steps restored correctly
- [ ] Verify pipeline detail page refreshes after restore

---

## Phase 1.5: Data Transformation System (NEW FEATURE)

### Schema Capture & Management
- [ ] Test & Capture UI works for all job types (CURL, API, AI, Python)
- [ ] Schema capture detects keys automatically (id, key, uuid patterns)
- [ ] Schema capture detects JIRA key patterns (PROJECT-123)
- [ ] Schema viewer displays captured schemas correctly
- [ ] Schema annotations (isKey, isForeignKey) can be edited
- [ ] Schema changes persist after save

### Transformation Engine
- [ ] All transformation types work correctly (direct, wrap_object, map_value, parse_json, to_string, extract_field)
- [ ] Transformation rules validate against schemas
- [ ] Rule compilation and caching improves performance
- [ ] Batch processing handles large arrays efficiently
- [ ] Transformation errors don't crash pipeline execution

### Knowledge Graph Integration
- [ ] Entity extraction creates knowledge graph nodes
- [ ] Relationship extraction creates knowledge graph edges
- [ ] Auto-suggestions for entity rules based on schema keys
- [ ] Knowledge graph nodes/edges appear in Knowledge Graph Explorer
- [ ] Entity extraction failures don't fail pipeline steps

### JIRA Transformation Use Case
- [ ] Create pipeline: Step 1 (GET JIRA Issues) → Step 2 (AI Analysis) → Step 3 (Transformer) → Step 4 (JIRA Update)
- [ ] Step 1 captures output schema with JIRA field structure
- [ ] Step 3 transformer wraps dropdown values in {"name": "value"} format
- [ ] Step 4 JIRA update receives correctly formatted data
- [ ] JIRA update succeeds without {"name": "Value"} vs "Value" conflicts
- [ ] End-to-end pipeline execution completes successfully

## Phase 2: Secondary Features

### Schedules
- [ ] Navigate to `/schedules` - list loads
- [ ] Create schedule with daily pattern - saves
- [ ] Create schedule with cron pattern - saves
- [ ] Schedule preview shows next fire times
- [ ] Edit schedule - changes persist
- [ ] Delete schedule - removes from list

### Scheduled Jobs
- [ ] Navigate to `/scheduled-jobs` - list loads
- [ ] Create scheduled job linking job + schedule - saves
- [ ] Edit scheduled job - changes persist
- [ ] Delete scheduled job - removes from list

#### Scheduled Jobs Detail & Edit Page (NEW FEATURE)
- [ ] Navigate to `/scheduled-jobs/:id` - detail page loads
- [ ] Detail page displays all scheduled job information correctly
- [ ] Edit button appears on detail page
- [ ] Click Edit button - enters edit mode
- [ ] Edit mode shows editable form fields (name, job, schedule, priority, status, alert settings)
- [ ] Name field is editable in edit mode
- [ ] Job dropdown shows all available jobs in edit mode
- [ ] Schedule dropdown shows all available schedules in edit mode (with "No schedule" option)
- [ ] Priority dropdown works correctly (High/Medium/Low)
- [ ] Active/Inactive toggle switch works correctly
- [ ] Alert on Failure toggle switch works correctly
- [ ] Cancel button exits edit mode without saving
- [ ] Cancel button resets form to original values
- [ ] Save Changes button saves scheduled job updates
- [ ] Save Changes validates required fields (name, job)
- [ ] Save Changes shows success toast on successful save
- [ ] Save Changes shows error toast on failure
- [ ] After successful save, page exits edit mode
- [ ] After successful save, updated values are displayed
- [ ] Delete button appears on detail page
- [ ] Delete button shows confirmation dialog
- [ ] Delete confirms deletion and removes scheduled job
- [ ] Delete redirects to scheduled jobs list after deletion
- [ ] Back button navigates to scheduled jobs list
- [ ] Job link navigates to job detail page
- [ ] Schedule link navigates to schedule detail page (when schedule is linked)
- [ ] Loading state displays while fetching scheduled job data
- [ ] Error message displays if scheduled job not found (404)
- [ ] Error message displays if user doesn't have access (403)
- [ ] Error handling for API failures works correctly

#### Scheduled Jobs List Page - Actions Menu
- [ ] Actions menu (three dots) appears on each scheduled job row
- [ ] Click Actions menu - dropdown opens
- [ ] Edit menu item appears in actions dropdown
- [ ] Click Edit in actions menu - navigates to `/scheduled-jobs/:id`
- [ ] Run Now menu item appears in actions dropdown (if implemented)
- [ ] Delete menu item appears in actions dropdown
- [ ] Delete shows confirmation dialog
- [ ] Delete removes scheduled job from list after confirmation

#### Upcoming Executions Next Run Time (NEW FEATURE)
- [ ] Navigate to `/monitoring` - page loads
- [ ] "Upcoming Executions" section displays
- [ ] Scheduled jobs with valid, active schedules show next run time (not "Not Scheduled")
- [ ] Next run time displays in formatted format (e.g., "Jan 15, 2024 14:30:00")
- [ ] Scheduled jobs without schedules show "Not Scheduled"
- [ ] Scheduled jobs with inactive schedules show "Not Scheduled"
- [ ] Scheduled jobs with invalid pattern data show "Not Scheduled"
- [ ] Pattern column displays schedule pattern description
- [ ] Daily schedules show "Daily at HH:MM" format
- [ ] Weekly schedules show "Weekly on [Days] at HH:MM" format
- [ ] Monthly schedules show "Monthly on day [N] at HH:MM" format
- [ ] Cron schedules show cron expression
- [ ] Next run time calculation respects schedule timezone
- [ ] Next run time updates correctly after schedule changes
- [ ] Server logs show debug information for "Get Issues Job" (if applicable)

### Credentials
- [ ] Navigate to `/credentials` - list loads
- [ ] Create AI provider credential - saves
- [ ] Create API key credential - saves
- [ ] Edit credential - changes persist
- [ ] Delete credential - removes from list

### Users
- [ ] Navigate to `/users` (admin) - list loads
- [ ] Create new user - saves successfully
- [ ] Edit user permissions - changes persist
- [ ] Profile page accessible and editable

### System Settings & SMTP Configuration (NEW FEATURE)
- [ ] Navigate to `/settings` - settings page loads
- [ ] SMTP Configuration card appears in Settings tab
- [ ] Enable SMTP toggle switch works
- [ ] SMTP fields appear when enabled
- [ ] SMTP Host input accepts text (e.g., "smtp.gmail.com")
- [ ] SMTP Port input accepts number (default 587)
- [ ] Use TLS/SSL toggle works correctly
- [ ] Username input accepts email address
- [ ] Password input is masked (type="password")
- [ ] From Address input accepts "Name <email>" format
- [ ] Save Settings button saves SMTP configuration
- [ ] SMTP configuration persists after page refresh
- [ ] SMTP configuration loads from API correctly
- [ ] Email service uses SMTP when enabled
- [ ] Email service falls back to console logging when SMTP disabled
- [ ] OTP emails are sent via SMTP when configured
- [ ] SMTP connection errors are handled gracefully
- [ ] Invalid SMTP configuration shows appropriate errors

---

## Phase 3: Supporting Features

### Monitoring
- [ ] Navigate to `/monitoring` - executions list loads
- [ ] Filter by status works
- [ ] Execution detail view displays correctly

### Alerts
- [ ] Navigate to `/alerts` - alerts list loads
- [ ] Acknowledge alert - status updates
- [ ] Filter by severity works

#### Quiet Hours Alert Suppression (NEW FEATURE)

##### User Profile Quiet Hours Configuration
- [ ] Navigate to `/profile` - profile page loads
- [ ] Quiet Hours section displays in profile form
- [ ] Enable Quiet Hours toggle switch works
- [ ] Quiet Hours Start time input accepts HH:MM format (24-hour)
- [ ] Quiet Hours End time input accepts HH:MM format (24-hour)
- [ ] Timezone dropdown shows list of available timezones
- [ ] Save changes with quiet hours enabled - saves successfully
- [ ] Quiet hours settings persist after page refresh
- [ ] Quiet hours settings are displayed correctly in form after save
- [ ] Validation: Start time must be in HH:MM format
- [ ] Validation: End time must be in HH:MM format
- [ ] Validation: Both start and end times required when quiet hours enabled
- [ ] Validation: Timezone required when quiet hours enabled
- [ ] Default values: Start time defaults to "22:00" if empty
- [ ] Default values: End time defaults to "08:00" if empty
- [ ] Default values: Timezone defaults to "UTC" if empty
- [ ] Disable Quiet Hours - settings persist as disabled
- [ ] Disable Quiet Hours - start/end/timezone can be cleared

##### Alert Suppression Logic - User-Level Quiet Hours
- [ ] Create scheduled job with alert on failure enabled
- [ ] Set user quiet hours (e.g., 22:00-08:00 UTC)
- [ ] Trigger job failure during quiet hours window
- [ ] Alert is created in database with `suppressed: true`
- [ ] Alert `suppressed_reason` contains user quiet hours information
- [ ] Alert is displayed in Alerts UI with suppressed badge/icon
- [ ] Alert suppressed reason is visible in UI
- [ ] Trigger job failure outside quiet hours window
- [ ] Alert is created with `suppressed: false`
- [ ] Alert displays normally (not suppressed) in UI
- [ ] Midnight-spanning quiet hours (e.g., 22:00-08:00) work correctly
- [ ] Normal quiet hours range (e.g., 09:00-17:00) work correctly
- [ ] Timezone conversion works correctly (quiet hours in user's timezone)
- [ ] Alert created by Python Runner respects user quiet hours
- [ ] Alert created by Python Scheduler respects user quiet hours

##### Alert Suppression Logic - Organization-Level Suppression Policies
- [ ] Create organization suppression policy with quiet hours enabled
- [ ] Configure severity bypass (e.g., critical alerts bypass quiet hours)
- [ ] Set user quiet hours active
- [ ] Trigger alert with bypassed severity during quiet hours
- [ ] Alert is created with `suppressed: false` (bypass works)
- [ ] Alert `suppressed_reason` contains bypass information (if applicable)
- [ ] Trigger alert with non-bypassed severity during quiet hours
- [ ] Alert is suppressed if user quiet hours are active
- [ ] Organization policy without quiet hours enabled doesn't suppress alerts

##### Alert UI Display
- [ ] Suppressed alerts display with BellOff icon
- [ ] Suppressed alerts show "Suppressed" badge with amber/amber styling
- [ ] Suppressed reason text displays below suppressed badge
- [ ] Suppressed alerts have reduced opacity (75%) in table row
- [ ] Suppressed alerts can still be acknowledged
- [ ] Suppressed alerts are included in severity filters
- [ ] Suppressed alerts show in "All Alerts" tab
- [ ] Suppressed alerts display correct severity badge
- [ ] Suppressed alerts maintain all other alert functionality (links, etc.)

##### Backend API Tests - Quiet Hours
- [ ] `GET /api/users/current` returns quiet hours settings
- [ ] `PATCH /api/users/:id` updates quiet hours settings correctly
- [ ] `PATCH /api/users/:id` validates quiet hours time format
- [ ] Alert creation endpoints check quiet hours before creating alert
- [ ] Alert creation always inserts alert into database (never skips)
- [ ] Alert creation sets `suppressed` and `suppressed_reason` fields correctly
- [ ] Quiet hours checking uses current time in user's timezone
- [ ] Quiet hours checking handles timezone conversion correctly
- [ ] Quiet hours checking supports midnight-spanning ranges correctly

##### Integration Tests
- [ ] Python Runner service imports quiet_hours module correctly
- [ ] Python Scheduler service imports quiet_hours module correctly
- [ ] Quiet hours checking works from Node.js server (TypeScript)
- [ ] Quiet hours checking works from Python services
- [ ] Both implementations produce consistent suppression results
- [ ] Database schema supports `suppressed` and `suppressed_reason` fields
- [ ] Alert queries return suppressed status and reason
- [ ] Organization suppression policy queries work correctly
- [ ] User quiet hours queries work correctly
- [ ] Error handling: Invalid timezone gracefully handles error (returns false, doesn't crash)
- [ ] Error handling: Invalid time format gracefully handles error (returns false, doesn't crash)
- [ ] Error handling: Missing user/org data doesn't crash alert creation

### Knowledge Store
- [ ] Navigate to `/knowledge-store` - topics list loads
- [ ] Create topic - saves successfully
- [ ] Add document to topic - indexes correctly

### Knowledge Graph Explorer (NEW FEATURE)

#### Frontend UI Tests
- [ ] Navigate to `/knowledge/graph` - Knowledge Graph Explorer page loads
- [ ] "Knowledge Graph" menu item appears in navigation sidebar
- [ ] React Flow canvas displays with grey dotted background
- [ ] Search bar in header toolbar is functional
- [ ] Search results navigate to and highlight matching nodes
- [ ] Node cards display with correct colors by type (User=blue, Ticket=green, Incident=red, etc.)
- [ ] Node selection opens Inspector Panel
- [ ] Inspector Panel displays node details, properties, and system data
- [ ] "Expand Neighbors" button fetches and displays 1st-degree connections
- [ ] "Edit" button opens Node Edit Dialog
- [ ] "Delete" button deletes node with confirmation
- [ ] "Create Node" button opens Node Edit Dialog for new node
- [ ] Node Edit Dialog form validates required fields (label, name)
- [ ] Node Edit Dialog saves new node successfully
- [ ] Node Edit Dialog updates existing node successfully
- [ ] Edge creation via drag-and-drop between nodes works
- [ ] Edge labels (relation names) display on edges
- [ ] Zoom controls (zoom in, zoom out, fit view) work correctly
- [ ] Mini map displays in bottom-right corner
- [ ] Legend displays node type color coding
- [ ] Dagre auto-layout arranges nodes correctly
- [ ] Graph updates after node/edge creation/deletion
- [ ] Knowledge Document nodes link to Knowledge Store correctly

#### Backend API Tests - Knowledge Graph
- [ ] `GET /api/knowledge-graph/nodes` returns list of nodes (requires auth)
- [ ] `GET /api/knowledge-graph/nodes` filters by organization context
- [ ] `GET /api/knowledge-graph/nodes?label=Incident` filters by label
- [ ] `POST /api/knowledge-graph/nodes` creates node successfully
- [ ] `POST /api/knowledge-graph/nodes` validates required fields (label, name)
- [ ] `GET /api/knowledge-graph/nodes/:id` returns node details
- [ ] `PUT /api/knowledge-graph/nodes/:id` updates node successfully
- [ ] `DELETE /api/knowledge-graph/nodes/:id` deletes node and cascades edges
- [ ] `GET /api/knowledge-graph/edges` returns list of edges
- [ ] `GET /api/knowledge-graph/edges?sourceId=X` filters by source
- [ ] `POST /api/knowledge-graph/edges` creates edge successfully
- [ ] `POST /api/knowledge-graph/edges` validates source and target nodes exist
- [ ] `POST /api/knowledge-graph/edges` validates nodes belong to same organization
- [ ] `GET /api/knowledge-graph/expand/:id` returns node + 1st-degree connections

## Phase 4: Intelligent Automation (JIRA Solver)

### End-to-End JIRA Pipeline Flow
- [ ] Run test script: `npx tsx -r dotenv/config server/test_jira_e2e.ts`
- [ ] Verify script authenticates via mock or env API keys
- [ ] Verify shell job (Fetch) executes
- [ ] Verify iterator job spawns child jobs (AI Agent)
- [ ] Verify iterator handles multiple items
- [ ] Verify pipeline pauses at "Human Approval" step
- [ ] Verify simulated approval resumes execution
- [ ] Verify pipeline completes successfully
- [ ] Verify "Capture Training Data" step output contains correct JSON

### Advanced Control Flow UI (Manual Verification)
- [ ] Navigate to Pipeline Builder
- [ ] Verify "Iterator" node displays with stacking cards icon
- [ ] Verify "Decision" node displays with diamond shape
- [ ] Verify decision nodes have Green/Red output ports
- [ ] Connect decision outputs to different downstream steps
- [ ] Execute pipeline with branching logic
- [ ] Verify correct branch is followed based on condition

### Knowledge Graph Integration
- [ ] Run Knowledge Extraction job manually
- [ ] Verify new nodes appear in Knowledge Graph Explorer
- [ ] Verify clicking a node shows metadata side-panel
- [ ] Verify "Extract" button on Document view triggers extraction
- [ ] `GET /api/knowledge-graph/search?q=query&mode=semantic` performs semantic search via Qdrant
- [ ] **`GET /api/knowledge-graph/search?q=query&approvedOnly=true` filters to approved content only**
- [ ] **`GET /api/knowledge-graph/search` prioritizes approved content in results**
- [ ] **`GET /api/knowledge-graph/search` sorts approved results by rating**
- [ ] **`GET /api/knowledge-graph/metrics` returns quality metrics (requires auth)**
- [ ] **`GET /api/knowledge-graph/metrics` returns total nodes, approvals, approval rate**
- [ ] **`GET /api/knowledge-graph/metrics` returns average rating**
- [ ] **`GET /api/knowledge-graph/metrics` returns approvals by entity type**
- [ ] **`GET /api/knowledge-graph/metrics` returns top approvers list**
- [ ] All knowledge graph endpoints require authentication
- [ ] All knowledge graph endpoints filter by organization context

#### Knowledge Graph Integration Tests - HIL Form Approval
- [ ] **Form submission with `approved: true` creates knowledge graph nodes**
- [ ] **Form submission with `approval: true` creates knowledge graph nodes**
- [ ] **Form submission with `rating: 8` creates knowledge graph nodes with rating**
- [ ] **Form submission with `quality_rating: 7` creates knowledge graph nodes with rating**
- [ ] **Form submission without approval/rating fields does NOT create nodes**
- [ ] **Knowledge graph nodes created from AI job output extract entities correctly**
- [ ] **Knowledge graph nodes created from API job output extract entities correctly**
- [ ] **Knowledge graph nodes include approval metadata (approvalStatus, rating, approvedBy, approvedAt)**
- [ ] **Knowledge graph nodes include source metadata (source: "hil_form_approval", jobId, jobName, etc.)**
- [ ] **Knowledge graph nodes include form responses in data field**
- [ ] **APPROVED edge created between approver user node and approved entity node**
- [ ] **Edge weight equals rating value (or 5 if no rating)**
- [ ] **User node created/get-or-created for approver email**
- [ ] **Entity extraction handles AI job output with incident/ticket/user objects**
- [ ] **Entity extraction handles API job output with data arrays**
- [ ] **Entity type inference works for common patterns (incidentId, ticketId, userId, etc.)**
- [ ] **Knowledge graph creation does not block form submission on errors**
- [ ] **Knowledge graph nodes are indexed in Qdrant after creation**
- [ ] **Knowledge graph creation respects organization boundaries**
- [ ] **Original job output is preserved before form submission overwrites step execution output**

### AI Cost Center & Token Observability (NEW FEATURE)

#### Frontend UI Tests
- [ ] Navigate to `/analytics` - cost dashboard page loads without errors
- [ ] "Cost Center" menu item appears in navigation sidebar
- [ ] Cost dashboard displays loading skeleton while fetching data
- [ ] Cost dashboard displays total spend correctly in KPI card
- [ ] Daily cost trend bar chart displays (last 30 days)
- [ ] Daily cost trend chart shows correct date formatting (MM-DD)
- [ ] Cost by model pie chart displays with labels
- [ ] Pie chart shows model names and costs correctly
- [ ] Top spending pipelines table displays with correct data
- [ ] Clicking pipeline name in table navigates to pipeline detail page
- [ ] Empty states display correctly when no data exists
- [ ] Error message displays if API call fails
- [ ] Charts are responsive and work on mobile/desktop
- [ ] All KPI cards display correct values (Total Spend, Active Models, Tracked Pipelines)
- [ ] Tooltips work correctly on charts
- [ ] Cost values are formatted correctly (4 decimal places)

#### Backend API Tests
- [ ] Cost dashboard endpoint `/api/analytics/cost-dashboard` returns valid JSON
- [ ] Cost dashboard endpoint requires authentication
- [ ] Organization context filtering works (only shows user's org data)
- [ ] Pipeline cost analytics endpoint `/api/pipelines/:id/cost-analytics` works
- [ ] Pipeline cost analytics returns correct pipeline-specific data
- [ ] Usage ingestion endpoint `/api/analytics/usage` accepts POST requests
- [ ] Usage ingestion validates required fields (provider, model)
- [ ] Usage ingestion calculates and stores cost correctly
- [ ] Usage ingestion endpoint respects organization context

#### Data & Integration Tests
- [ ] Usage logging occurs automatically after AI API calls in pipeline executor
- [ ] Cost is calculated correctly for different providers/models
- [ ] Token counts (prompt/completion/total) are logged correctly
- [ ] Cost values are stored with proper precision (6 decimal places)
- [ ] Organization ID is correctly associated with usage logs
- [ ] Pipeline ID is correctly linked to usage logs
- [ ] Daily aggregation queries return correct date groupings
- [ ] Model cost aggregation groups by model correctly
- [ ] Top pipelines query orders by cost correctly

#### Budget Management (Future Features)
- [ ] Pipeline budget field appears in pipeline form
- [ ] Set monthly budget on pipeline - saves successfully
- [ ] Budget status displays on pipeline detail page
- [ ] Budget progress bar shows current spend vs budget
- [ ] Circuit breaker prevents execution when over budget (if enabled)
- [ ] Budget warnings appear when approaching limit

### Form Submission Integration & Pipeline Resume (NEW FEATURE)

#### Form Submission Flow Tests
- [ ] Create pipeline step execution with status "waiting_external_input"
- [ ] Generate external task token with step execution ID
- [ ] External task token contains correct executionId (step execution ID)
- [ ] Form submission endpoint finds step execution by ID
- [ ] Form submission validates step execution status is "waiting_external_input"
- [ ] Form responses are JSON stringified and stored in step execution output
- [ ] Step execution status updates to "success" after form submission
- [ ] Step execution completedAt timestamp is set after form submission
- [ ] Pipeline execution status remains "running" after form submission
- [ ] Pipeline resume is triggered automatically after form submission
- [ ] Pipeline resume rebuilds variable context from completed steps
- [ ] Pipeline resume identifies next step correctly
- [ ] Form responses are available in variable context for subsequent steps
- [ ] Pipeline continues execution after form submission
- [ ] Error handling: Invalid step execution ID returns 404
- [ ] Error handling: Step execution not in waiting status returns 400
- [ ] Error handling: Missing token returns 400
- [ ] Error handling: Invalid JWT token returns 401

#### Pipeline Resume API Tests
- [ ] `POST /api/pipelines/:id/resume` requires authentication
- [ ] `POST /api/pipelines/:id/resume` validates execution ID is provided
- [ ] `POST /api/pipelines/:id/resume` validates execution exists
- [ ] `POST /api/pipelines/:id/resume` validates execution is in "running" status
- [ ] `POST /api/pipelines/:id/resume` validates pipeline ID matches execution
- [ ] `POST /api/pipelines/:id/resume` rebuilds context from completed steps
- [ ] `POST /api/pipelines/:id/resume` accepts optional fromStepId parameter
- [ ] `POST /api/pipelines/:id/resume` returns success response
- [ ] `POST /api/pipelines/:id/resume` handles errors gracefully

#### Storage & Data Tests
- [ ] `updatePipelineStepExecution` method updates output correctly
- [ ] `updatePipelineStepExecution` method updates status correctly
- [ ] `updatePipelineStepExecution` method sets completedAt timestamp
- [ ] Step execution output stores JSON stringified form responses
- [ ] Variable context rebuilds from step execution outputs correctly
- [ ] Named variables (outputName) are restored in context
- [ ] Positional variables (by step order) are restored in context
- [ ] Context data object is preserved during resume

### HIL Form Engine & External Gateway (NEW FEATURE)

#### Frontend UI Tests - Forms List Page
- [ ] Navigate to `/dashboard/forms` - forms list page loads without errors
- [ ] "Forms" menu item appears in navigation sidebar
- [ ] Forms list displays loading skeleton while fetching data
- [ ] Create Form button is visible and clickable
- [ ] Forms table displays all columns (Name, Description, Status, Updated, Actions)
- [ ] Search/filter functionality works correctly
- [ ] Status badges display correctly (Active/Archived)
- [ ] Edit button in actions menu navigates to form builder
- [ ] Archive button in actions menu archives the form
- [ ] Empty state displays when no forms exist
- [ ] Error message displays if API call fails

#### Frontend UI Tests - Form Builder
- [ ] Navigate to `/dashboard/forms/builder` - form builder page loads
- [ ] Navigate to `/dashboard/forms/builder/:id` - loads existing form correctly
- [ ] No React hooks errors in browser console (check DevTools Console)
- [ ] No "Cannot access before initialization" errors
- [ ] Route matching works correctly for both new and existing forms
- [ ] Component initializes without crashing or white screen
- [ ] All React hooks are called in correct order (no "Rules of Hooks" violations)
- [ ] Two-panel split layout displays correctly (configuration + preview)
- [ ] Form Editor tab shows field list
- [ ] External Settings tab shows branding and security options
- [ ] Add Field button creates new field
- [ ] Field editor allows editing (label, key, type, required)
- [ ] Field type selector works (text, textarea, select, rating, boolean)
- [ ] Select field type shows options input field
- [ ] Reorder fields using up/down buttons works
- [ ] Delete field button removes field correctly
- [ ] Live preview updates in real-time as fields change
- [ ] Form name input appears in header
- [ ] Save button saves form successfully
- [ ] Branding settings (company name, primary color, logo URL) save correctly
- [ ] Security settings (require OTP, token expiration) save correctly
- [ ] Form validation prevents saving empty form name
- [ ] Form validation prevents saving form with no fields
- [ ] Preview shows branded form correctly
- [ ] Preview form can be submitted (shows alert in preview mode)

#### Frontend UI Tests - External Task Page
- [ ] Navigate to `/external/task?token=...` - page loads
- [ ] Invalid/missing token shows appropriate error
- [ ] Loading state displays while validating token
- [ ] OTP required state shows identity verification card
- [ ] Email masking works correctly (shows masked email)
- [ ] OTP code input accepts 6-digit numeric code
- [ ] Request OTP button sends OTP code
- [ ] Verify OTP button validates code correctly
- [ ] Invalid OTP code shows error message
- [ ] Expired OTP code shows error message
- [ ] After OTP verification, form displays
- [ ] Form displays with correct branding (logo, company name, colors)
- [ ] Form fields render correctly from schema
- [ ] Form validation works (required fields)
- [ ] Form submission shows success message
- [ ] Form submission shows error if API fails
- [ ] Success state displays confirmation message
- [ ] **Job Execution Result card displays above form when jobContext is present**
- [ ] **Job output displays formatted JSON correctly (with indentation)**
- [ ] **Job output displays plain text correctly when not JSON**
- [ ] **Job output card shows job name and step order**
- [ ] **Job output card shows execution timestamp**
- [ ] **Job output card is scrollable for long content (max-height)**
- [ ] **Job output card handles null/undefined output gracefully**

#### Backend API Tests - Internal Management APIs
- [ ] `GET /api/forms` returns list of forms (requires auth)
- [ ] `GET /api/forms` filters by organization context correctly
- [ ] `GET /api/forms/:id` returns form details (requires auth)
- [ ] `GET /api/forms/:id` returns 404 for non-existent form
- [ ] `GET /api/forms/:id` returns 403 for form in different organization
- [ ] `POST /api/forms` creates new form (requires auth)
- [ ] `POST /api/forms` validates required fields (name, schema)
- [ ] `POST /api/forms` validates schema structure (fields array)
- [ ] `POST /api/forms` sets organization context correctly
- [ ] `PUT /api/forms/:id` updates form successfully
- [ ] `PUT /api/forms/:id` validates schema structure if provided
- [ ] `DELETE /api/forms/:id` archives form (soft delete)
- [ ] Archived forms don't appear in active forms list
- [ ] All form endpoints require authentication

#### Backend API Tests - External Gateway APIs
- [ ] `GET /api/external/task?token=...` validates JWT token
- [ ] `GET /api/external/task` returns 400 if token missing
- [ ] `GET /api/external/task` returns 401 if token invalid/expired
- [ ] `GET /api/external/task` returns correct status (otp_required/ready)
- [ ] `GET /api/external/task` returns form schema when OTP verified
- [ ] `GET /api/external/task` returns theme config with form
- [ ] **`GET /api/external/task` includes jobContext in response when step execution exists**
- [ ] **`GET /api/external/task` jobContext contains jobId, jobName, jobType, output, stepOrder, executedAt**
- [ ] **`GET /api/external/task` parses JSON job output correctly**
- [ ] **`GET /api/external/task` handles string job output (non-JSON) correctly**
- [ ] **`GET /api/external/task` handles missing step execution gracefully (jobContext is null)**
- [ ] **`GET /api/external/task` handles missing job/pipeline step gracefully**
- [ ] `POST /api/external/otp/request` generates OTP code
- [ ] `POST /api/external/otp/request` invalidates existing unused OTPs
- [ ] `POST /api/external/otp/request` sends OTP email (via SMTP if configured, otherwise console)
- [ ] `POST /api/external/otp/request` validates email matches token
- [ ] `POST /api/external/otp/verify` validates OTP code
- [ ] `POST /api/external/otp/verify` checks OTP expiration
- [ ] `POST /api/external/otp/verify` marks OTP as used
- [ ] `POST /api/external/otp/verify` returns form schema on success
- [ ] `POST /api/external/task/submit` validates JWT token
- [ ] `POST /api/external/task/submit` finds pipeline step execution by ID
- [ ] `POST /api/external/task/submit` verifies step execution status is "waiting_external_input"
- [ ] `POST /api/external/task/submit` updates step execution with form responses (JSON stringified)
- [ ] `POST /api/external/task/submit` sets step execution status to "success"
- [ ] `POST /api/external/task/submit` sets step execution completedAt timestamp
- [ ] `POST /api/external/task/submit` triggers pipeline resume after form submission
- [ ] `POST /api/external/task/submit` returns success response
- [ ] `POST /api/external/task/submit` handles invalid step execution ID gracefully
- [ ] `POST /api/external/task/submit` handles step execution not in waiting status gracefully
- [ ] **`POST /api/external/task/submit` preserves original job output before updating with form responses**
- [ ] **`POST /api/external/task/submit` detects approval fields (approved, approval) in form responses**
- [ ] **`POST /api/external/task/submit` detects rating fields (rating, quality_rating) in form responses**
- [ ] **`POST /api/external/task/submit` creates knowledge graph nodes when approval/rating present**
- [ ] **`POST /api/external/task/submit` extracts entities from AI job output correctly**
- [ ] **`POST /api/external/task/submit` extracts entities from API/CURL job output correctly**
- [ ] **`POST /api/external/task/submit` creates nodes with approval metadata (approvalStatus, rating, approvedBy, etc.)**
- [ ] **`POST /api/external/task/submit` creates APPROVED edge between approver and approved entity**
- [ ] **`POST /api/external/task/submit` uses rating value as edge weight (defaults to 5 if no rating)**
- [ ] **`POST /api/external/task/submit` indexes created nodes in Qdrant (non-blocking)**
- [ ] **`POST /api/external/task/submit` handles knowledge graph creation errors gracefully (doesn't fail form submission)**
- [ ] **`POST /api/external/task/submit` only creates nodes when organizationId is present**
- [ ] External gateway routes bypass CSRF protection
- [ ] External gateway routes validate JWT instead of session

#### Data & Integration Tests
- [ ] Form schema JSONB stores field definitions correctly
- [ ] Theme config JSONB stores branding settings correctly
- [ ] Security config JSONB stores OTP settings correctly
- [ ] OTP codes are stored with correct expiration (10 minutes)
- [ ] OTP codes are properly cleaned up after expiration
- [ ] Organization filtering works for forms queries
- [ ] Form creation sets createdBy user ID correctly
- [ ] Form updates set updatedAt timestamp correctly
- [ ] Form archiving sets isArchived flag correctly
- [ ] OTP code generation creates 6-digit numeric codes
- [ ] JWT tokens include correct payload (executionId, formId, email, role)
- [ ] JWT tokens expire according to security config
- [ ] Form schema validation rejects invalid field types
- [ ] Form schema validation requires fields array
- [ ] Pipeline step execution status "waiting_external_input" is valid
- [ ] Form responses are stored as JSON string in step execution output
- [ ] Step execution update sets completedAt timestamp correctly
- [ ] Pipeline execution context is rebuilt from completed step executions
- [ ] Variable context (named/positional) is preserved during resume
- [ ] SMTP configuration is stored in systemSettings.settingsData.smtp
- [ ] SMTP password is stored securely (not logged in plain text)
- [ ] Email service reads SMTP config from database correctly
- [ ] SMTP config defaults are applied when not configured

#### Security & Access Control Tests
- [ ] Users can only access forms in their organization
- [ ] Admins can access all forms
- [ ] JWT tokens cannot be forged without JWT_SECRET
- [ ] Expired JWT tokens are rejected
- [ ] Invalid JWT signature is rejected
- [ ] OTP codes cannot be reused after verification
- [ ] OTP codes expire after 10 minutes
- [ ] Email must match JWT token email for OTP requests
- [ ] External gateway routes are accessible without authentication
- [ ] External gateway routes validate JWT properly
- [ ] Form submission endpoint validates JWT token
- [ ] Form submission endpoint only updates step executions in "waiting_external_input" status
- [ ] Pipeline resume endpoint requires authentication
- [ ] Pipeline resume endpoint validates execution ownership/access
- [ ] SMTP password is not exposed in API responses
- [ ] SMTP configuration changes require authentication

---

## Phase 4: Security & Error Handling

### CSRF Protection
- [ ] POST request without CSRF token - returns 403
- [ ] POST request with valid CSRF token - succeeds
- [ ] CSRF token refresh on 403 error works

### Authentication
- [ ] Access protected route without login - redirects
- [ ] API endpoint without auth - returns 401/403

### Error Handling
- [ ] Access non-existent resource - 404 displayed
- [ ] Invalid form data - validation errors shown
- [ ] Network error - error message displayed

### React Component Errors & Hooks Issues
- [ ] No React hooks errors in browser console for any page
- [ ] No "Cannot access before initialization" errors
- [ ] No "Rules of Hooks" violations (hooks called conditionally or in loops)
- [ ] No "React.Children.only expected to receive a single React element child" errors
- [ ] FormControl components wrap only single child elements (not multiple children or divs)
- [ ] FormControl does NOT wrap conditional rendering branches (e.g., `{type === "text" && <Input />}`)
- [ ] Each conditional branch in FormField render has its own FormControl wrapper (not shared)
- [ ] Radix UI Slot-based components (FormControl, etc.) have exactly one child
- [ ] All routes load without component initialization errors
- [ ] Route parameters are parsed correctly (check optional params like `/builder/:id?`)
- [ ] useForm hooks are defined before useEffects that use them
- [ ] Component state initializes correctly on page load
- [ ] No infinite re-render loops (check React DevTools Profiler)
- [ ] Form components (react-hook-form) work without errors
- [ ] Navigation between pages doesn't cause hook ordering issues
- [ ] Optional route parameters handled correctly
- [ ] Browser console shows no uncaught exceptions on page navigation
- [ ] Form fields with multiple inputs (e.g., color picker + text input) don't use FormControl wrapper
- [ ] FormRenderer component renders all field types without React.Children.only errors
- [ ] **No SelectItem components have empty string values (`value=""` is not allowed)**
- [ ] **Select components use non-empty placeholder values (e.g., "none", "null") instead of empty strings**
- [ ] **Select components properly convert placeholder values (like "none") to null/undefined when saving**
- [ ] **Scheduled job edit page schedule Select works correctly with "No schedule" option**

### Data Integrity
- [ ] Delete job used in pipeline - handles gracefully
- [ ] Delete pipeline - versions cascade delete
- [ ] Rollback preserves all step data correctly
- [ ] Delete pipeline - AI usage logs are preserved (onDelete: set null)
- [ ] Cost calculations are accurate across all providers
- [ ] Token counts are preserved in usage logs

---

## Phase 5: Error Diagnosis & Observability (Error Diagnosis Agent)

### Schema Mismatch Detector
- [ ] **Schema diff button/badge appears on successful step execution details**
- [ ] **Clicking "Schema Changed" opens comparison dialog**
- [ ] **Dialog shows added fields in green**
- [ ] **Dialog shows removed fields in red**
- [ ] **Dialog shows type changes in yellow**
- [ ] **Badge shows "Schema Mismatch" (red) for breaking changes**
- [ ] **Badge shows "Schema Changed" (yellow) for non-breaking changes**
- [ ] **Verify schema output is captured for API/CURL jobs**
- [ ] **Verify schema output is captured for Transformer jobs**
- [ ] **Verify schema comparison works against previous healthy execution**

### Error Clustering (Admin)
- [ ] **Navigate to `/admin/clusters` - page loads successfully**
- [ ] **Cluster list displays recognized error patterns**
- [ ] **Clicking "Analyze" on a cluster shows sample errors**
- [ ] **Clicking "Create Pattern" opens pattern creation dialog**
- [ ] **Rejecting a cluster removes it from the list**
- [ ] **Approving a cluster creates a permanent error pattern**
- [ ] **Verify "Fingerprint" generation logic groups similar errors**
- [ ] **Verify cluster statistics (error count, first seen, last seen)**

### Automated Alerts (Admin)
- [ ] **Navigate to `/admin/alerts` - page loads successfully**
- [ ] **Create new alert rule with "Slack" channel**
- [ ] **Create new alert rule with "Email" recipient**
- [ ] **Configure trigger condition (e.g., "Error Count > 10 in 1 hour")**
- [ ] **Save alert rule - persists to database**
- [ ] **Test alert rule - sends test notification**
- [ ] **Disable/Enable alert rule works correctly**
- [ ] **Verify alert history log updates after firing**

### Pattern Management (Admin)
- [ ] **Navigate to `/admin/patterns` - page loads successfully**
- [ ] **Export patterns to JSON file**
- [ ] **Import patterns from JSON file**
- [ ] **Validate import schema (rejects invalid JSON)**
- [ ] **Search patterns by name or regex**
- [ ] **Verify imported patterns are active in diagnosis**

### Root Cause Analysis (Pipeline Execution)
- [ ] **Navigate to FAILED pipeline execution**
- [ ] **"Root Cause Analysis" section appears below error message**
- [ ] **Timeline graph visualizes execution flow**
- [ ] **Root cause node is highlighted (Red)**
- [ ] **Contributor nodes are highlighted (Orange)**
- [ ] **Victim nodes are highlighted (Gray)**
- [ ] **Clicking a node shows error details and impact score**
- [ ] **Verify "Retry Analysis" button works if initial load fails**

---

## Test Results Summary

**Date:** _______________
**Tester:** _______________

**Phase 1 (Critical):** ___/___ passed
**Phase 2 (Secondary):** ___/___ passed
**Phase 3 (Supporting):** ___/___ passed
**Phase 4 (Security):** ___/___ passed
**React Component Errors:** ___/___ passed
**AI Cost Center Feature:** ___/___ passed
**HIL Form Engine Feature:** ___/___ passed
**Form Submission Integration:** ___/___ passed
**SMTP Configuration:** ___/___ passed
**Knowledge Graph Explorer:** ___/___ passed
**HIL Form + Knowledge Graph Integration:** ___/___ passed
**Quiet Hours Alert Suppression:** ___/___ passed
**RAG Asset Management:** ___/___ passed
**RAG Asset Execution (Python Runner):** ___/___ passed
**Request/Response Type Selection (CURL/API Jobs):** ___/___ passed
**Repeater Job Type:** ___/___ passed

**Total:** ___/___ tests passed

**Critical Issues Found:** _______________

**Notes:** _______________

---

## Quick Smoke Test (5-minute check)

If you only have 5 minutes, run these critical tests:

1. [ ] Login works
2. [ ] Dashboard loads
3. [ ] Create a job - saves successfully
4. [ ] Create a transformer job - saves successfully
5. [ ] Test CURL job and capture output schema - schema saves
6. [ ] View captured schema in Schemas tab - displays correctly
7. [ ] Create a pipeline with transformer step - executes successfully
8. [ ] Create a pipeline with the job - saves successfully
9. [ ] View pipeline version history - opens correctly
10. [ ] Navigate to Cost Center (`/analytics`) - page loads
11. [ ] Cost dashboard displays charts and data (or empty states)
12. [ ] Navigate to Forms (`/dashboard/forms`) - page loads
13. [ ] Create a form - form builder opens and saves successfully
14. [ ] Navigate to Settings (`/settings`) - SMTP configuration card appears
15. [ ] Configure SMTP settings - saves successfully
16. [ ] Navigate to Knowledge Graph (`/knowledge/graph`) - page loads
13. [ ] Create a knowledge graph node - saves successfully
14. [ ] Navigate to Profile (`/profile`) - quiet hours settings display correctly
15. [ ] Enable quiet hours and save - settings persist correctly
16. [ ] Create a repeater job - saves successfully with nested CURL config
17. [ ] Browser console shows no React errors (check DevTools)
18. [ ] Logout works

If all 18 pass, the application is in good shape!

---

## Troubleshooting Common Errors

### React Hooks Errors

**Symptoms:**
- Console errors: "Cannot access before initialization"
- Console errors: "Rules of Hooks" violations
- Component fails to render or shows white screen
- Infinite re-render loops

**Checks:**
1. Open browser DevTools (F12) → Console tab
2. Look for React errors (red text with React stack traces)
3. Verify hooks are called in the same order every render
4. Verify `useForm` (or other hooks) are defined before `useEffect` that use them
5. Check that hooks aren't called conditionally or in loops

**Common Issues:**
- `useForm` called after `useEffect` that uses it → Move `useForm` before `useEffect`
- Hooks called conditionally → Move all hooks to top of component
- Missing dependencies in `useEffect` → Add all used variables to dependency array

### Route Matching Errors

**Symptoms:**
- Page doesn't load when navigating to route
- Route parameters not extracted correctly
- Optional route parameters not working

**Checks:**
1. Verify route pattern matches URL structure
2. Check that route parameters are parsed correctly
3. Test both routes: with ID (`/builder/123`) and without (`/builder`)
4. Check browser console for route-related errors

**Common Issues:**
- Optional params like `/:id?` may not work in all routers → Use explicit route matching or URL parsing
- Route not matching → Verify route pattern in `App.tsx` matches component's `useRoute` pattern

### Component Initialization Errors

**Symptoms:**
- Page loads but shows blank/white screen
- Components don't render
- Errors on page load

**Checks:**
1. Open DevTools → Console tab for JavaScript errors
2. Check Network tab for failed API requests
3. Verify all imports are correct
4. Check that required props are provided
5. Verify component state initialization

**Common Issues:**
- Missing import → Check import statements
- Undefined variable → Verify all variables are defined before use
- API endpoint returning error → Check Network tab for failed requests

### MCP (Model Context Protocol) Server (NEW FEATURE)

#### Prerequisites
- [ ] MCP SDK installed (`@modelcontextprotocol/sdk`)
- [ ] Database is running and accessible
- [ ] Environment variable `DATABASE_URL` is set
- [ ] Environment variable `ODDJOB_ORG_ID` is set (optional, defaults to 1)

#### Server Startup
- [ ] Run `npm run mcp` - server starts without errors
- [ ] Run `npm run mcp:dev` - server starts in development mode
- [ ] Server logs show `[oddjob-mcp] Starting MCP server v1.0.0...`
- [ ] Server logs show `[oddjob-mcp] Server connected and ready`
- [ ] Server logs show correct organization ID

#### Knowledge Graph Tools
- [ ] Tool `search_knowledge_graph` is listed in available tools
- [ ] `search_knowledge_graph` accepts `query` parameter
- [ ] `search_knowledge_graph` accepts optional `entityType` parameter
- [ ] `search_knowledge_graph` accepts optional `includeRelationships` parameter
- [ ] `search_knowledge_graph` returns matching nodes
- [ ] `search_knowledge_graph` returns relationships when enabled
- [ ] Tool `get_entity_impact` is listed in available tools
- [ ] `get_entity_impact` accepts `entityName` parameter
- [ ] `get_entity_impact` returns inbound and outbound relationships
- [ ] `get_entity_impact` returns impact summary
- [ ] Tool `create_entity` is listed in available tools
- [ ] `create_entity` accepts `name` and `entityType` parameters
- [ ] `create_entity` creates node in database successfully
- [ ] `create_entity` returns created node details
- [ ] Tool `create_relationship` is listed in available tools
- [ ] `create_relationship` finds source and target by name
- [ ] `create_relationship` creates edge in database successfully
- [ ] Tool `suggest_schema` is listed in available tools
- [ ] `suggest_schema` accepts `domainDescription` parameter
- [ ] `suggest_schema` returns ontology with entity types and relationships
- [ ] Tool `get_graph_statistics` is listed in available tools
- [ ] `get_graph_statistics` returns total entity and relationship counts
- [ ] `get_graph_statistics` returns counts by entity type
- [ ] `get_graph_statistics` returns counts by relationship type

#### Pipeline Tools
- [ ] Tool `list_pipelines` is listed in available tools
- [ ] `list_pipelines` returns all pipelines for organization
- [ ] `list_pipelines` respects `activeOnly` filter
- [ ] `list_pipelines` respects `search` filter
- [ ] Tool `get_pipeline_details` is listed in available tools
- [ ] `get_pipeline_details` accepts `pipelineId` parameter
- [ ] `get_pipeline_details` accepts `pipelineName` parameter (alternative)
- [ ] `get_pipeline_details` returns pipeline configuration
- [ ] `get_pipeline_details` returns recent execution history
- [ ] Tool `run_pipeline` is listed in available tools
- [ ] `run_pipeline` accepts `pipelineId` or `pipelineName`
- [ ] `run_pipeline` with `dryRun: true` doesn't execute
- [ ] `run_pipeline` creates execution record
- [ ] `run_pipeline` returns execution ID
- [ ] Tool `get_pipeline_execution_status` is listed in available tools
- [ ] `get_pipeline_execution_status` accepts `executionId` parameter
- [ ] `get_pipeline_execution_status` returns execution status
- [ ] `get_pipeline_execution_status` returns execution timestamps
- [ ] Tool `list_recent_executions` is listed in available tools
- [ ] `list_recent_executions` returns paginated results
- [ ] `list_recent_executions` filters by `status`
- [ ] `list_recent_executions` filters by `pipelineId`

#### Document Tools
- [ ] Tool `search_documents` is listed in available tools
- [ ] `search_documents` accepts `query` parameter
- [ ] `search_documents` searches document content
- [ ] `search_documents` returns matching document chunks
- [ ] Tool `list_documents` is listed in available tools
- [ ] `list_documents` returns document list
- [ ] `list_documents` respects `limit` parameter
- [ ] `list_documents` respects `search` filter
- [ ] Tool `get_document_content` is listed in available tools
- [ ] `get_document_content` accepts `documentId` parameter
- [ ] `get_document_content` returns full document content

#### MCP Resources
- [ ] Resource `oddjob://knowledge/nodes` is listed
- [ ] Reading `oddjob://knowledge/nodes` returns entity list
- [ ] Resource `oddjob://knowledge/schemas` is listed
- [ ] Reading `oddjob://knowledge/schemas` returns schema definitions
- [ ] Resource `oddjob://knowledge/statistics` is listed
- [ ] Reading `oddjob://knowledge/statistics` returns entity counts
- [ ] Resource `oddjob://pipelines` is listed
- [ ] Reading `oddjob://pipelines` returns pipeline list
- [ ] Resource `oddjob://documents` is listed
- [ ] Reading `oddjob://documents` returns document list

#### MCP Prompts
- [ ] Prompt `knowledge_analyst` is listed
- [ ] Prompt `knowledge_analyst` accepts `question` argument
- [ ] Prompt `knowledge_analyst` returns formatted prompt message
- [ ] Prompt `pipeline_operator` is listed
- [ ] Prompt `pipeline_operator` accepts `task` argument
- [ ] Prompt `pipeline_operator` returns formatted prompt message
- [ ] Prompt `document_search` is listed
- [ ] Prompt `document_search` accepts `question` argument
- [ ] Prompt `document_search` returns formatted prompt message
- [ ] Prompt `impact_analysis` is listed
- [ ] Prompt `impact_analysis` accepts `entity_name` argument
- [ ] Prompt `impact_analysis` accepts optional `change_type` argument
- [ ] Prompt `impact_analysis` returns formatted prompt message

#### Claude Desktop Integration
- [ ] Add MCP server to `~/.claude/claude_desktop_config.json`
- [ ] Restart Claude Desktop
- [ ] Claude shows "oddjob" as available MCP server
- [ ] Test query: "List all entities in the knowledge graph"
- [ ] Claude uses `search_knowledge_graph` or resource correctly
- [ ] Test query: "What depends on the Payment Service?"
- [ ] Claude uses `get_entity_impact` correctly
- [ ] Test query: "Run the daily sync pipeline"
- [ ] Claude uses `list_pipelines` then `run_pipeline`
- [ ] Test query: "Search for deployment documentation"
- [ ] Claude uses `search_documents` correctly

#### Error Handling
- [ ] Missing required parameter returns clear error
- [ ] Entity not found returns appropriate message
- [ ] Pipeline not found returns appropriate message
- [ ] Document not found returns appropriate message
- [ ] Database connection errors are logged
- [ ] Tool execution errors don't crash server

---

## Phase 5: Error Handling & Self-Healing (NEW FEATURE - Phase 3)

### Error Diagnosis Dashboard
- [ ] Navigate to `/admin/errors` - Error Diagnosis Dashboard loads
- [ ] Dashboard displays list of recent error diagnoses
- [ ] Each diagnosis shows error message, HTTP status, job type
- [ ] Click diagnosis row - diagnosis detail expands/opens
- [ ] Diagnosis detail shows AI analysis summary (if available)
- [ ] Diagnosis detail shows matched pattern information
- [ ] Diagnosis detail shows recommendations list
- [ ] "Was this helpful?" feedback buttons work (Yes/No)
- [ ] Feedback is recorded and toast notification appears

### Error Diagnosis Engine
- [ ] Run eval script: `npx tsx eval_error_diagnosis.ts`
- [ ] Eval passes with 75%+ success rate
- [ ] Pattern matching works for common HTTP errors (401, 403, 404, 429, 500, 504)
- [ ] Pattern matching correctly identifies auth-failed, rate-limit-exceeded, request-timeout patterns
- [ ] Recommendations are generated for matched patterns
- [ ] AI diagnosis is generated for unknown errors (when patterns don't match)
- [ ] Diagnosis is persisted to `error_diagnoses` table

### Advanced Retry Policies (NEW FEATURE)
- [ ] Navigate to Pipeline Builder - pipeline step detail sheet
- [ ] Retry Policy section appears in step configuration
- [ ] "Max Retries" input accepts positive numbers (default 0)
- [ ] "Backoff (ms)" input accepts positive numbers (default 1000)
- [ ] "Backoff Multiplier" input accepts decimal numbers (default 2.0)
- [ ] Retry configuration saves with pipeline step
- [ ] Retry configuration persists after page refresh

#### Backend Retry Execution
- [ ] Run test script: `npx tsx scripts/test-retry-policy.ts`
- [ ] Test passes - retry loop executes correctly
- [ ] Step with retries configured retries on failure
- [ ] Backoff delay is applied between retry attempts
- [ ] Retry stops after maxRetries exceeded
- [ ] Retry stops on success (doesn't retry successful executions)
- [ ] `DISABLE_JOB_QUEUE=true` env var forces in-process execution for testing

### HIL Correction Interface (NEW FEATURE)
- [ ] Navigate to Error Diagnosis detail page
- [ ] Recommendations with `canAutoApply=true` show "Auto-Fix" button
- [ ] "Auto-Fix" button is enabled for applicable recommendations
- [ ] Click "Auto-Fix" - fix is applied and pipeline resumes
- [ ] Success toast notification appears after fix applied
- [ ] Diagnosis record is updated with `appliedFixId` and `fixSuccessful`

#### Backend HIL Correction
- [ ] Run test script: `npx tsx scripts/test-hil-correction.ts`
- [ ] Test passes - full correction loop works
- [ ] `applyFix` method updates job configuration correctly
- [ ] `applyFix` method updates pipeline step retry config (for add_retry action)
- [ ] `applyFix` method resumes pipeline execution after fix
- [ ] Pipeline resumes from corrected step and completes successfully
- [ ] Feedback is recorded in diagnosis record

### Error Alerting System (NEW FEATURE)
- [ ] Navigate to `/admin/alerts` - Error Alerts page loads
- [ ] Alert configuration form displays
- [ ] Create alert config with name, min occurrences, time window
- [ ] Alert config saves successfully
- [ ] Alert config appears in configs list
- [ ] Edit alert config - changes persist
- [ ] Delete alert config - removes from list
- [ ] Alert history displays triggered alerts

#### Backend Alerting
- [ ] Run test script: `npx tsx scripts/test-alerting.ts`
- [ ] Test passes - alert is triggered after threshold met
- [ ] Alert record created in `error_alerts` table
- [ ] Alert includes error count, sample errors, diagnosis summary
- [ ] Cooldown period prevents duplicate alerts
- [ ] Slack notification sent (when webhook configured)
- [ ] Email notification sent (when SMTP configured)

#### API Endpoints
- [ ] `GET /api/alerts` returns list of alert configs
- [ ] `POST /api/alerts` creates new alert config
- [ ] `PUT /api/alerts/:id` updates alert config
- [ ] `DELETE /api/alerts/:id` deletes alert config
- [ ] `GET /api/alerts/history` returns triggered alerts
- [ ] `POST /api/admin/diagnoses/:id/fix` applies recommended fix
- [ ] `POST /api/admin/diagnoses/:id/feedback` records user feedback
- [ ] All endpoints require authentication

#### Integration Tests
- [ ] Pipeline failure automatically creates error diagnosis
- [ ] Error diagnosis triggers alert check
- [ ] Multiple failures within time window trigger alert
- [ ] Alert is created with correct metadata
- [ ] Fix application updates database and resumes pipeline

---

### React.Children.only Errors

**Symptoms:**
- Console error: "React.Children.only expected to receive a single React element child"
- Error occurs when editing forms or using form components
- Component fails to render with Radix UI/Slot-related errors

**Checks:**
1. Open browser DevTools (F12) → Console tab
2. Look for "React.Children.only" error messages
3. Identify which component is causing the error (check stack trace)
4. Find FormControl or other Slot-based components that wrap multiple children
5. Verify each FormControl wraps exactly one child element

**Common Issues:**
- FormControl wrapping multiple inputs (e.g., color picker + text input) → Remove FormControl wrapper, put inputs directly in FormItem
- FormControl wrapping a div with multiple children → Either remove FormControl or restructure to have single child
- FormControl wrapping conditional rendering branches → Move FormControl inside each conditional branch
- Slot component (used by FormControl) expects exactly one child → Ensure all Slot-based components have exactly one child element

**Fix Examples:**

**Example 1: Multiple Inputs**
```tsx
// ❌ WRONG - FormControl wrapping multiple children
<FormControl>
  <div className="flex gap-2">
    <Input type="color" />
    <Input />
  </div>
</FormControl>

// ✅ CORRECT - Inputs outside FormControl
<div className="flex gap-2">
  <Input type="color" value={field.value} onChange={...} />
  <Input value={field.value} onChange={...} />
</div>
```

**Example 2: Conditional Rendering**
```tsx
// ❌ WRONG - FormControl wrapping conditional branches
<FormControl>
  {type === "text" && <Input />}
  {type === "textarea" && <Textarea />}
  {type === "select" && <Select>...</Select>}
</FormControl>

// ✅ CORRECT - FormControl inside each branch
{type === "text" && (
  <FormControl>
    <Input />
  </FormControl>
)}
{type === "textarea" && (
  <FormControl>
    <Textarea />
  </FormControl>
)}
{type === "select" && (
  <FormControl>
    <Select>...</Select>
  </FormControl>
)}
```

