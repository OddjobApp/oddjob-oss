# Jobs System Documentation

> **Spec Reference:** [JOB_TYPES_SPEC](../../specs/JOB_TYPES_SPEC.md) — Config schemas, executor mapping, API.

## **Feature Overview**

### **Purpose & Business Value**
The Jobs System is the core of Oddjob's automation platform, enabling users to create, configure, test, and execute individual automated tasks. It serves as the building blocks for complex workflows and pipelines, providing a flexible interface for various job types including API calls, AI processing, data transformations, and system integrations.

### **User Personas & Use Cases**
- **Automation Engineers**: Create and configure jobs for automated workflows
- **Developers**: Build integrations and custom script executions
- **Business Users**: Set up data exports, notifications, and business process automations
- **System Administrators**: Monitor job execution and manage system resources

### **Key Requirements & Constraints**
- **Multi-tenant Support**: Jobs must be isolated by organization
- **40+ Job Types**: Support for shell, API, AI, database, and integration jobs
- **Real-time Testing**: Jobs must be testable before deployment
- **Version Control**: Track job configuration changes
- **Resource Management**: Limit concurrent job executions per organization
- **Security**: Credential isolation and permission-based access
- **Distributed Execution**: Jobs execute in dedicated `worker` and `mission` pods (Mach 3)
- **Asynchronous Forge**: Complex agent synthesis is offloaded to the `forge` service

### **Success Metrics**
- Job execution success rate > 95%
- Job configuration time < 5 minutes average
- Test execution time < 30 seconds
- Zero credential exposure between organizations

---

## **User Interface Documentation**

### **Screens & Navigation**

#### **Main Jobs List (`/jobs`)**
- **Purpose**: Browse, search, filter, and manage all jobs
- **Key Features**:
  - Search by job name, type, or description
  - Filter by job type, status, last run status
  - Bulk actions (delete, add to collections)
  - Quick actions (run, edit, copy, delete)
  - View switch (grid vs list)
  - Export functionality

#### **Job Detail Page (`/jobs/:id`)**
- **Purpose**: Complete job configuration and management
- **Key Features**:
  - Job configuration form (type-specific)
  - Test job functionality
  - Execution history and logs
  - Job metrics and analytics
  - Knowledge asset attachments
  - Collection management
  - Publishing and sharing controls

#### **Create Job Dialog**
- **Purpose**: Quick job creation wizard
- **Key Features**:
  - Job type selection with descriptions
  - Basic configuration (name, description)
  - Template selection
  - Import from existing jobs

### **Component Hierarchy**

```
client/src/features/jobs/
├── pages/
│   └── Jobs.tsx - Main container and state management
├── components/
│   ├── JobDetail.tsx - Individual job view and editing
│   ├── CreateJobDialog.tsx - Job creation wizard
│   ├── JobTestDialog.tsx - Job testing interface
│   ├── JobConfigEditor.tsx - Dynamic job configuration form
│   ├── CollectionsList.tsx - Job collections management
│   ├── AddToCollectionDialog.tsx - Collection assignment
│   ├── tabs/
│   │   ├── JobOverviewTab.tsx - Basic job info
│   │   ├── JobPublishTab.tsx - Publishing controls
│   │   ├── JobSchemasTab.tsx - Input/output schemas
│   │   ├── JobReactiveTab.tsx - Reactive triggers
│   │   └── JobImpactTab.tsx - Impact analysis
│   └── config/
│       ├── [JobType]JobConfig.tsx - Type-specific configurations
│       └── JobConfigCards.tsx - Configuration cards
└── hooks/
    ├── useJobData.ts - Job data fetching
    └── useJobMutations.ts - Job mutations
```

### **User Interactions**

#### **Job Creation Flow (Mach 3 Async)**
1. Click "Create Job" button → Opens CreateJobDialog
2. Select job type → Shows type-specific template
3. Fill basic info (name, description)
4. Configure job-specific parameters
5. **Forge Synthesis (Agents Only)**: For complex AI agents, the job enters the **Asynchronous Forge Queue**.
   - The UI displays a "Synthesizing" state.
   - The `forge` service generates the agent definitions and tools.
   - If `requireReview` is enabled, the job enters a `pending_review` state.
6. **HIL Review (Optional)**: User approves or rejects the synthesized definition in the Decision Inbox.
7. Save/Finalize → Job becomes available for execution.

#### **Job Testing Flow**
1. Click "Test Job" → Opens JobTestDialog
2. Override input parameters (optional)
3. Execute test job
4. View real-time execution logs
5. Review test results and outputs
6. Apply test results to configuration

#### **Job Management Actions**
- **Run**: Execute job immediately with current configuration
- **Edit**: Open job configuration for modification
- **Copy**: Create duplicate job with same configuration
- **Delete**: Remove job (with confirmation)
- **Add to Collection**: Assign job to collections for organization

---

## **API Documentation**

### **Core Job Endpoints**

#### **GET /api/jobs**
- **Purpose**: List jobs for current organization
- **Query Parameters**:
  - `search`: Search term for name/description
  - `type`: Filter by job type
  - `status`: Filter by job status
  - `limit`: Pagination limit
  - `offset`: Pagination offset
- **Response**: `{ jobs: Job[], total: number }`
- **Authentication**: Required (user must be logged in)

#### **POST /api/jobs**
- **Purpose**: Create new job
- **Request Body**: `InsertJob` with type-specific configuration
- **Response**: `Job` (created job with ID)
- **Authentication**: Required
- **Validation**: Job type validation, credential validation

#### **GET /api/jobs/:id**
- **Purpose**: Get specific job details
- **Response**: `Job` with full configuration
- **Authentication**: Required (job must belong to user's org)

#### **PUT /api/jobs/:id**
- **Purpose**: Update job configuration
- **Request Body**: Partial `InsertJob` fields
- **Response**: Updated `Job`
- **Authentication**: Required (user must have edit permissions)

#### **DELETE /api/jobs/:id**
- **Purpose**: Delete job
- **Response**: Success message
- **Authentication**: Required (user must have delete permissions)

#### **POST /api/jobs/:id/test**
- **Purpose**: Test job execution
- **Request Body**: Test parameters (overrides)
- **Response**: Test execution results and logs
- **Authentication**: Required

#### **POST /api/jobs/:id/copy**
- **Purpose**: Create duplicate job
- **Request Body**: `{ name?: string, description?: string }`
- **Response**: New `Job` (duplicate)
- **Authentication**: Required

#### **POST /api/jobs/:id/run**
- **Purpose**: Execute job immediately
- **Request Body**: Runtime parameters
- **Response**: Job execution ID and status
- **Note**: Handled by the `mission` or `worker` role depending on job type.
- **Authentication**: Required

### **Request/Response Schemas**

#### **Job Schema**
```typescript
interface Job {
  id: number;
  name: string;
  description?: string;
  type: JobType;
  config: JobConfig; // Type-specific configuration
  credentialId?: number;
  isActive: boolean;
  organizationId: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt?: Date;
  lastRunStatus?: string;
}
```

#### **Job Types (40+ types)**
- `shell`: Execute shell commands
- `api` / `curl`: HTTP API requests
- `python`: Execute Python scripts
- `ai_api_call`: AI/LLM API calls
- `ai_agent`: ReAct-style AI agents
- `transformer`: Data transformation
- `repeater`: Array iteration
- `iterator`: Conditional loops
- `decision`: Conditional branching
- `sql_query`: Database queries
- `openapi`: OpenAPI spec execution
- `airflow_dag_run`: Airflow DAG triggers
- `human_approval`: Human-in-the-loop
- `slack_post`: Slack notifications
- `email_send`: Email sending
- `folder_import`: File/folder imports
- `file_export`: Data export
- `selenium`: Browser automation
- `node_script`: Node.js execution
- `git_op`: Git operations
- `reranker`: Document reranking
- And 20+ more...

### **Error Handling & Status Codes**

#### **Common Error Responses**
- `400 Bad Request`: Invalid job configuration
- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: No permissions for job
- `404 Not Found`: Job doesn't exist
- `422 Unprocessable Entity`: Validation errors
- `500 Internal Server Error`: Execution failures

#### **Job Execution Statuses**
- `pending`: Waiting to execute
- `running`: Currently executing
- `success`: Completed successfully
- `error`: Failed with error
- `timeout`: Timed out
- `cancelled`: User cancelled

---

## **Component Architecture**

### **State Management Patterns**

#### **Global State (React Query)**
```typescript
// Job list query
useQuery<Job[]>({
  queryKey: ['/api/jobs'],
  queryFn: fetchJobs
});

// Single job query
useQuery<Job>({
  queryKey: ['/api/jobs', id],
  queryFn: () => fetchJob(id)
});

// Mutations
useMutation({
  mutationFn: createJob,
  onSuccess: () => queryClient.invalidateQueries(['/api/jobs'])
});
```

#### **Local State (useState)**
```typescript
const [searchQuery, setSearchQuery] = useState('');
const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
const [testJobId, setTestJobId] = useState<number | null>(null);
```

### **Key Component Interfaces**

#### **Jobs.tsx Main Component**
```typescript
interface JobsProps {
  // No direct props - gets data from URL params and context
}

// Internal state
- searchQuery: string
- selectedJobIds: Set<number>
- isCreateDialogOpen: boolean
- isTestDialogOpen: boolean
- testJobId: number | null
- activeTab: 'jobs' | 'collections'
```

#### **JobTestDialog Component**
```typescript
interface JobTestDialogProps {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: TestResult) => void;
}
```

### **Custom Hooks**

#### **useJobTypes**
```typescript
// Returns available job types with metadata
const { jobTypes, isLoading } = useJobTypes();
```

#### **useJobTest**
```typescript
// Handles job testing with real-time updates
const { testJob, isTesting, testResult, error } = useJobTest(jobId);
```

---

## **Integration Points**

### **External Services**
- **AI Providers**: OpenAI, Anthropic, Google Gemini
- **Databases**: PostgreSQL, MySQL, MS SQL Server, Snowflake
- **Cloud Services**: AWS S3, Google Drive, Confluence
- **Communication**: Gmail, Slack, SendGrid
- **Version Control**: Git operations

### **Database Dependencies**
- **jobs table**: Main job storage
- **job_executions table**: Execution history
- **credentials table**: Job credentials reference
- **organizations table**: Multi-tenancy
- **users table**: Job ownership

### **Message Queue Usage (Mach 3)**
- **job_execution_queue**: Queue for heavy job execution shared by `worker` pods.
- **job_test_queue**: Isolated queue for real-time testing to avoid blocking production runs.
- **forge_queue**: Dedicated queue for the `forge` service to handle AI synthesis missions.
- **notification_queue**: Job completion and status update events.

- **Internal Service Dependencies**
- **Pipeline Service**: Jobs can be used in pipelines (orchestrated by `mission` pods).
- **Scheduler Service**: Scheduled job execution.
- **Knowledge Service**: RAG asset integration.
- **Forge Service**: Handles asynchronous synthesis for AI agents.
- **Monitoring Service**: Job metrics and alerts.
- **Auth Service**: Permission checking.

---

## **Error Handling & Edge Cases**

### **Validation Rules**

#### **Job Configuration Validation**
- **Required Fields**: Name is required and unique within org
- **Type Validation**: Configuration must match job type schema
- **Credential Validation**: Referenced credentials must exist and be accessible
- **Size Limits**: Configuration size limited to prevent memory issues
- **Security**: No SQL injection or XSS in configuration fields

#### **Job Execution Validation**
- **Resource Limits**: Check org execution quotas
- **Concurrent Limits**: Prevent org from exceeding concurrent job limits
- **Credential Expiry**: Check if credentials are still valid
- **Dependency Health**: Verify external services are accessible

### **Fallback Behaviors**

#### **Test Failures**
- Show detailed error messages with stack traces
- Provide suggestions for common issues
- Allow test re-run with modified parameters
- Save test results for debugging

#### **Execution Failures**
- Log detailed error information
- Send failure notifications
- Create alerts for repeated failures
- Queue retry attempts if configured

### **Recovery Mechanisms**

#### **Network Failures**
- Automatic retry with exponential backoff
- Fallback to alternative endpoints if configured
- Timeout handling and connection pooling

#### **Service Degradation**
- Graceful degradation when external services unavailable
- Queue jobs for later execution
- User notifications about service status

### **User Feedback Patterns**

#### **Success Feedback**
- Toast notifications for successful operations
- Real-time progress updates for long-running operations
- Success badges and status indicators

#### **Error Feedback**
- Detailed error messages in modals
- Form validation with inline error messages
- Error logs with export functionality
- Help documentation links for common issues

---

## **Performance Considerations**

### **Critical Paths**
- **Job List Loading**: Must load < 2 seconds with pagination
- **Job Configuration**: Form rendering must be < 1 second
- **Job Testing**: Test execution must be < 30 seconds for simple jobs
- **Bulk Operations**: Handling 1000+ jobs without UI freezing

### **Bottlenecks & Optimizations**
- **Large Configuration Objects**: Some job configs are >50KB
- **Test Execution**: Real-time log streaming can be slow
- **Search Performance**: Full-text search across job names/descriptions
- **Memory Usage**: Large job lists cause browser memory issues

### **Memory & CPU Usage**
- **Job Configuration Objects**: Optimized JSON parsing
- **React Re-renders**: Memoized components to prevent unnecessary renders
- **Real-time Updates**: Debounced search and filter inputs
- **Image/Asset Loading**: Lazy loading for job icons and previews

### **Network Request Patterns**
- **Batch API Calls**: Combine multiple job status checks
- **Pagination**: Implement proper pagination for job lists
- **Caching**: Cache job configurations and metadata
- **Optimistic Updates**: Update UI immediately, rollback on error

---

## **Security & Permissions**

### **Access Control**
- **Job Ownership**: Users can only access jobs in their organization
- **Edit Permissions**: Based on user roles (admin, editor, viewer)
- **Credential Access**: Jobs can only use credentials from same org
- **API Rate Limits**: Per-organization limits on job execution

### **Data Protection**
- **Credential Isolation**: Encrypted storage, never exposed in UI
- **Configuration Sanitization**: Remove sensitive data from logs
- **Input Validation**: Prevent injection attacks in job configurations
- **Audit Logging**: Track all job modifications and executions

### **Input Validation**
- **Schema Validation**: All job configs validated against Zod schemas
- **Size Limits**: Prevent DOS via large configuration objects
- **File Upload Limits**: Restrict file sizes for job attachments
- **Command Injection**: Sanitize shell commands and SQL queries

### **Audit Requirements**
- **Configuration Changes**: Log all job modifications
- **Execution History**: Track who ran jobs and when
- **Access Logs**: Record all job access attempts
- **Failure Auditing**: Detailed logs for security incidents

---

## **Testing Requirements**

### **Unit Tests**
- **Job Configuration Validation**: Test all 40+ job types
- **Form Validation**: Test all form inputs and validation rules
- **Utility Functions**: Test helper functions and formatters
- **Error Handling**: Test error scenarios and recovery

### **Integration Tests**
- **API Endpoints**: Test all job CRUD operations
- **Job Execution**: Test actual job execution with real services
- **Credential Integration**: Test credential usage and validation
- **Cross-Feature Integration**: Test jobs within pipelines

### **E2E Tests**
- **Job Creation Flow**: Complete job creation wizard
- **Job Testing Flow**: Test job configuration and execution
- **Job Management Flow**: Edit, copy, delete operations
- **Bulk Operations**: Test selection and bulk actions

### **Performance Tests**
- **Large Job Lists**: Performance with 1000+ jobs
- **Complex Configurations**: Handle large job configuration objects
- **Concurrent Users**: Multiple users managing jobs simultaneously
- **Memory Usage**: Long session performance and memory leaks

---

## **Migration Considerations**

### **Breaking Changes**
- **Component Refactoring**: Large components will be split (Jobs.tsx, CredentialDetail.tsx)
- **State Management**: Moving from local state to centralized patterns
- **API Changes**: Possible endpoint reorganization for better patterns
- **Type Safety**: Strengthening TypeScript types and interfaces

### **Data Migration**
- **Job Configuration Format**: Possible schema evolution for better validation
- **Credential References**: May need to update credential association patterns
- **Organization Association**: Ensuring proper multi-tenancy boundaries

### **Backward Compatibility**
- **API Versioning**: Maintain backward compatibility for external integrations
- **Job Configuration**: Support existing job configurations during transition
- **URL Structure**: Maintain existing URL patterns for bookmarks
- **Export/Import**: Preserve existing job export formats

### **Deployment Dependencies**
- **Database Schema**: May need schema migrations for improved indexing
- **Service Dependencies**: Ensure all external service integrations maintained
- **Feature Flags**: Use feature flags for gradual rollout
- **Monitoring**: Enhanced monitoring during transition period

---

## **Current Issues & Technical Debt**

### **Known Bugs**
- **Test Dialog Memory Leak**: Real-time log updates cause memory issues
- **Search Performance**: Slow search with large job lists (>500)
- **Form State**: Complex form state becomes unsynchronized
- **Bulk Select**: Selection state lost during pagination

### **Performance Issues**
- **Initial Load**: Job list takes 3-5 seconds with 1000+ jobs
- **Filter Lag**: Search and filter have 500ms+ delay
- **Memory Growth**: Browser memory grows linearly with session duration
- **Bundle Size**: Job-related components contribute 2MB to bundle

### **Code Quality Issues**
- **Jobs.tsx (707 lines)**: Monolithic component with multiple responsibilities
- **CredentialDetail.tsx (1,297 lines)**: Massive component handling 10+ credential types
- **JobConfigEditor**: Complex conditional rendering logic
- **Duplicate Code**: Similar patterns across job configuration forms

### **Technical Debt**
- **Form Validation**: Inconsistent validation patterns across job types
- **Error Handling**: Different error handling approaches
- **State Management**: Mixed patterns (useState, React Query, Context)
- **Testing**: Low test coverage for job configuration logic

---

## **Documentation References**

### **Related Documents**
- [02-pipelines-system.md](./02-pipelines-system.md) - Jobs in pipeline context
- [05-auth-system.md](./05-auth-system.md) - User permissions and access control
- [06-credentials-system.md](./06-credentials-system.md) - Job credential integration
- [13-api-architecture.md](./13-api-architecture.md) - Complete API documentation

### **External Documentation**
- [React Query Documentation](https://tanstack.com/query/latest) - State management
- [Wouter Router](https://github.com/molefrog/wouter) - Routing
- [Radix UI](https://www.radix-ui.com/) - Component library
- [Drizzle ORM](https://orm.drizzle.team/) - Database schemas

### **Important Code Comments**
- Job type validation logic in shared/schema/jobs/types.ts
- Test execution logic in server/routes/jobs.ts
- Configuration schemas in shared/schema/jobs/config-*.ts
- Security middleware in server/services/security.ts

### **Wiki/Confluence Links**
- Job Type Specifications - Detailed requirements for each job type
- Integration Guidelines - How to add new job types
- Performance Benchmarks - Current performance metrics and targets