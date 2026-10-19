# Pipelines System Documentation

> **Spec References:** [MASTER_INTELLIGENT_AUTOMATION_SPEC](../../specs/MASTER_INTELLIGENT_AUTOMATION_SPEC.md) (control flow), [TEMPLATE_GALLERY_SPEC](../../specs/TEMPLATE_GALLERY_SPEC.md), [FORENSIC_ANALYSIS_SPEC](../../specs/FORENSIC_ANALYSIS_SPEC.md).

## **Feature Overview**

### **Purpose & Business Value**
The Pipelines System enables users to orchestrate complex automated workflows by connecting multiple jobs into logical sequences with conditional logic, variable passing, and sophisticated triggering mechanisms. It transforms individual job executions into comprehensive business process automation, supporting real-time monitoring, error handling, and performance analytics.

### **User Personas & Use Cases**
- **Process Engineers**: Design and implement complex business workflows
- **DevOps Engineers**: Automate deployment and infrastructure management
- **Data Engineers**: Create data processing and ETL pipelines
- **Business Analysts**: Model business processes with automated decision points
- **System Administrators**: Monitor and maintain pipeline execution

### **Key Requirements & Constraints**
- **Visual Pipeline Builder**: Drag-and-drop interface for workflow creation
- **40+ Job Types**: Support all job types within pipeline steps
- **Conditional Logic**: Support for branching, loops, and decision points
- **Variable Interpolation**: Pass data between pipeline steps
- **Multi-Trigger Support**: Manual, scheduled, webhook, and event triggers
- **Real-time Monitoring**: Live execution tracking and logs
- **Version Control**: Track pipeline changes and rollback capabilities
- **Budget Management**: Cost tracking and limits per pipeline

### **Success Metrics**
- Pipeline execution success rate > 98%
- Average pipeline design time < 15 minutes
- Real-time monitoring latency < 2 seconds
- Pipeline recovery time < 5 minutes

---

## **User Interface Documentation**

### **Screens & Navigation**

#### **Pipeline List (`/pipelines`)**
- **Purpose**: Browse, search, and manage all pipelines
- **Key Features**:
  - Pipeline cards with status indicators
  - Search and filter by name, type, status
  - Quick actions (run, edit, clone, archive)
  - Execution history summary
  - Template gallery access
  - Budget tracking display

#### **Pipeline Editor (`/pipelines/:id`)**
- **Purpose**: Visual pipeline creation and editing
- **Key Features**:
  - Drag-and-drop canvas for pipeline design
  - Step configuration panels
  - Variable management interface
  - Real-time collaboration (planned)
  - Pipeline validation and testing
  - Execution preview and debugging

#### **Pipeline Execution Detail (`/pipelines/:id/executions/:executionId`)**
- **Purpose**: Detailed view of specific pipeline execution
- **Key Features**:
  - Step-by-step execution timeline
  - Input/output data inspection
  - Error analysis and debugging tools
  - Performance metrics and timing
  - Retry and re-run capabilities
  - Execution logs and artifacts

#### **Template Gallery (`/pipelines/templates`)**
- **Purpose**: Browse and use pre-built pipeline templates
- **Key Features**:
  - Categorized template library
  - Template preview and documentation
  - One-click pipeline creation
  - Custom template creation
  - Template sharing and rating system

#### **Forensic Analysis (`/pipelines/forensic`)**
- **Purpose**: Compare and analyze pipeline executions
- **Key Features**:
  - Side-by-side execution comparison
  - Performance regression detection
  - Data flow analysis
  - Error pattern identification
  - Export analysis reports

### **Component Hierarchy**

```
PipelinesPage/
├── Pipelines.tsx (65 lines) - Main routing container
├── PipelineList/ - Pipeline management interface
│   ├── index.tsx - Main list component
│   ├── PipelineCard.tsx - Individual pipeline cards
│   ├── PipelineStatus.tsx - Status indicators
│   └── PipelineActions.tsx - Action buttons and dropdowns
├── PipelineEditor/ - Visual editor components
│   ├── index.tsx - Main editor container
│   ├── PipelineCanvas.tsx - Drag-and-drop canvas
│   ├── StepConfigurator.tsx - Step configuration panel
│   ├── VariableManager.tsx - Pipeline variables
│   ├── TriggerConfigurator.tsx - Trigger settings
│   └── PipelineValidator.tsx - Validation and testing
├── PipelineExecution/ - Execution monitoring
│   ├── ExecutionDetail.tsx - Detailed execution view
│   ├── ExecutionTimeline.tsx - Timeline visualization
│   ├── StepExecution.tsx - Individual step status
│   └── ExecutionLogs.tsx - Real-time logs
└── Templates/
    ├── TemplateGallery.tsx - Template browser
    ├── TemplateCard.tsx - Individual template display
    └── TemplateWizard.tsx - Template creation wizard
```

### **User Interactions**

#### **Pipeline Creation Flow**
1. Navigate to `/pipelines` → Click "Create Pipeline"
2. Choose template or start from scratch
3. Configure pipeline basics (name, description, triggers)
4. Drag jobs onto canvas to create steps
5. Connect steps with data flow arrows
6. Configure step parameters and conditions
7. Set up variable mappings between steps
8. Test pipeline execution
9. Save and activate pipeline

#### **Pipeline Execution Flow**
1. Select pipeline → Click "Run" or trigger automatically
2. Monitor real-time execution progress
3. View step-by-step execution details
4. Analyze results and handle any errors
5. Review execution logs and artifacts
6. Compare with previous executions if needed

#### **Pipeline Management Actions**
- **Edit**: Open pipeline editor for modifications
- **Clone**: Create duplicate with same configuration
- **Archive**: Deactivate and hide from active list
- **Delete**: Permanent removal (with confirmation)
- **Export**: Download pipeline configuration
- **Import**: Upload pipeline from file

---

## **API Documentation**

### **Core Pipeline Endpoints**

#### **GET /api/pipelines**
- **Purpose**: List pipelines for current organization
- **Query Parameters**:
  - `search`: Search term for name/description
  - `status`: Filter by status (active, draft, archived)
  - `triggerType`: Filter by trigger type
  - `limit`: Pagination limit
  - `offset`: Pagination offset
- **Response**: `{ pipelines: Pipeline[], total: number }`
- **Authentication**: Required

#### **POST /api/pipelines**
- **Purpose**: Create new pipeline
- **Request Body**: `InsertPipeline` with full configuration
- **Response**: `Pipeline` (created with ID)
- **Validation**: Name uniqueness, step configuration validation

#### **GET /api/pipelines/:id**
- **Purpose**: Get specific pipeline with full details
- **Response**: `Pipeline` with steps and configuration
- **Authentication**: Required (pipeline must belong to user's org)

#### **PUT /api/pipelines/:id**
- **Purpose**: Update pipeline configuration
- **Request Body**: Partial `InsertPipeline` fields
- **Response**: Updated `Pipeline`
- **Side Effects**: Creates new version automatically

#### **DELETE /api/pipelines/:id**
- **Purpose**: Delete pipeline
- **Response**: Success message
- **Soft Delete**: Marks as deleted for audit trail

#### **POST /api/pipelines/:id/execute**
- **Purpose**: Execute pipeline immediately
- **Request Body**: `{ input?: any, variables?: Record<string, any> }`
- **Response**: `{ executionId: number, status: string }`

#### **GET /api/pipelines/:id/executions**
- **Purpose**: List pipeline executions
- **Query Parameters**: Pagination, status filters, date range
- **Response**: `{ executions: PipelineExecution[], total: number }`

#### **GET /api/pipelines/:id/executions/:executionId**
- **Purpose**: Get detailed execution information
- **Response**: `PipelineExecution` with step details and logs

#### **POST /api/pipelines/:id/copy**
- **Purpose**: Create duplicate pipeline
- **Request Body**: `{ name?: string, description?: string }`
- **Response**: New `Pipeline` (duplicate)

#### **GET /api/pipelines/templates**
- **Purpose**: Get available pipeline templates
- **Response**: `{ templates: PipelineTemplate[] }`

#### **POST /api/pipelines/:id/validate**
- **Purpose**: Validate pipeline configuration
- **Request Body**: Pipeline configuration
- **Response**: `{ valid: boolean, errors: ValidationError[] }`

### **Pipeline Step Management**

#### **POST /api/pipelines/:id/steps**
- **Purpose**: Add step to pipeline
- **Request Body**: `InsertPipelineStep`
- **Response**: Created `PipelineStep`

#### **PUT /api/pipelines/:id/steps/:stepId**
- **Purpose**: Update step configuration
- **Request Body**: Partial step configuration
- **Response**: Updated `PipelineStep`

#### **DELETE /api/pipelines/:id/steps/:stepId**
- **Purpose**: Remove step from pipeline
- **Response**: Success message

### **Request/Response Schemas**

#### **Pipeline Schema**
```typescript
interface Pipeline {
  id: number;
  name: string;
  description?: string;
  triggerType: PipelineTriggerType; // 'manual' | 'schedule' | 'webhook' | 'event'
  triggerCredentialId?: number;
  labels?: Record<string, any>;
  isActive: boolean;
  organizationId: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  currentVersion: number;
  monthlyBudgetUsd?: number;
  enableKnowledgeGraph: boolean;
  knowledgeGraphConfig?: PipelineKnowledgeGraphConfig;
  lifecycleStatus: 'active' | 'draft' | 'archived';
  steps: PipelineStep[]; // All steps in pipeline
}
```

#### **Pipeline Step Schema**
```typescript
interface PipelineStep {
  id: number;
  pipelineId: number;
  orderId: number;
  jobId: number;
  name: string;
  description?: string;
  config: Record<string, any>; // Job-specific config overrides
  condition?: string; // Conditional execution expression
  onFailure: 'stop' | 'continue' | 'retry';
  retryConfig?: {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
  };
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

#### **Pipeline Execution Schema**
```typescript
interface PipelineExecution {
  id: number;
  pipelineId: number;
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  triggeredBy: string;
  triggeredAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  input?: any;
  output?: any;
  variables: Record<string, any>;
  error?: string;
  stepExecutions: PipelineStepExecution[];
  cost?: {
    estimatedCost: number;
    actualCost: number;
    currency: string;
  };
}
```

### **Error Handling & Status Codes**

#### **Pipeline Validation Errors**
- `INVALID_STEP_CONFIGURATION`: Step configuration doesn't match job type
- `CIRCULAR_DEPENDENCY`: Steps have circular dependencies
- `MISSING_REQUIRED_INPUT`: Required input not provided
- `INVALID_CONDITION_EXPRESSION`: Conditional logic syntax error
- `VARIABLE_NOT_FOUND`: Referenced variable doesn't exist

#### **Execution Errors**
- `STEP_EXECUTION_FAILED`: Individual step failed
- `TIMEOUT`: Pipeline exceeded maximum execution time
- `BUDGET_EXCEEDED`: Pipeline exceeded cost budget
- `RESOURCE_LIMIT_EXCEEDED`: Too many concurrent executions
- `EXTERNAL_SERVICE_ERROR`: Third-party service unavailable

---

## **Component Architecture**

### **State Management Patterns**

#### **Pipeline Editor State**
```typescript
const PipelineEditor = () => {
  // Pipeline configuration
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  
  // UI state
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  
  // Validation state
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isSaving, setIsSaving] = useState(false);
};
```

#### **React Query Integration**
```typescript
// Pipeline data
const { data: pipeline, isLoading, error } = useQuery({
  queryKey: ['/api/pipelines', id],
  queryFn: () => fetchPipeline(id),
  enabled: !!id
});

// Mutations
const createMutation = useMutation({
  mutationFn: createPipeline,
  onSuccess: (newPipeline) => {
    queryClient.invalidateQueries(['/api/pipelines']);
    navigate(`/pipelines/${newPipeline.id}`);
  }
});

const executeMutation = useMutation({
  mutationFn: executePipeline,
  onSuccess: (execution) => {
    navigate(`/pipelines/${execution.pipelineId}/executions/${execution.id}`);
  }
});
```

### **Key Component Interfaces**

#### **PipelineCanvas Component**
```typescript
interface PipelineCanvasProps {
  steps: PipelineStep[];
  connections: Connection[];
  onStepAdd: (stepType: JobType, position: Point) => void;
  onStepUpdate: (stepId: string, updates: Partial<PipelineStep>) => void;
  onConnectionCreate: (from: string, to: string) => void;
  onConnectionDelete: (connectionId: string) => void;
  selectedStepId?: string;
  onStepSelect: (stepId: string) => void;
}
```

#### **StepConfigurator Component**
```typescript
interface StepConfiguratorProps {
  step: PipelineStep | null;
  job: Job | null;
  variables: PipelineVariable[];
  onStepUpdate: (updates: Partial<PipelineStep>) => void;
  onClose: () => void;
}
```

### **Custom Hooks**

#### **usePipelineValidation**
```typescript
const usePipelineValidation = (pipeline: Pipeline, steps: PipelineStep[]) => {
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isValid, setIsValid] = useState(false);
  
  const validatePipeline = useCallback(() => {
    const validationErrors = validatePipelineStructure(pipeline, steps);
    setErrors(validationErrors);
    setIsValid(validationErrors.length === 0);
  }, [pipeline, steps]);
  
  return { errors, isValid, validatePipeline };
};
```

#### **usePipelineExecution**
```typescript
const usePipelineExecution = (pipelineId: number) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecution, setCurrentExecution] = useState<PipelineExecution | null>(null);
  
  const executePipeline = useCallback(async (input?: any) => {
    setIsExecuting(true);
    try {
      const execution = await executePipelineMutation.mutateAsync({
        pipelineId,
        input
      });
      setCurrentExecution(execution);
    } finally {
      setIsExecuting(false);
    }
  }, [pipelineId]);
  
  return { isExecuting, currentExecution, executePipeline };
};
```

---

## **Integration Points**

### **External Services**
- **AI Providers**: OpenAI, Anthropic, Google Gemini for AI steps
- **Databases**: PostgreSQL, MySQL, MS SQL Server for SQL steps
- **Cloud Storage**: AWS S3, Google Drive for file operations
- **Communication**: Slack, Gmail, SendGrid for notification steps
- **Webhook Services**: Custom webhook endpoints for event triggers
- **Monitoring**: External monitoring services for pipeline health

### **Database Dependencies**
- **pipelines table**: Main pipeline storage
- **pipeline_steps table**: Individual step configurations
- **pipeline_executions table**: Execution history
- **pipeline_step_executions table**: Step execution details
- **pipeline_triggers table**: Trigger configurations
- **organizations table**: Multi-tenancy boundaries
- **jobs table**: Reference to job definitions

### **Message Queue Usage**
- **pipeline_execution_queue**: Queue for pipeline execution
- **step_execution_queue**: Queue for individual step execution
- **notification_queue**: Pipeline status notifications
- **monitoring_queue**: Metrics and health monitoring

### **Internal Service Dependencies**
- **Jobs Service**: Access to job definitions and execution
- **Scheduler Service**: Scheduled pipeline execution
- **Knowledge Service**: Pipeline knowledge graph integration
- **Monitoring Service**: Pipeline metrics and alerting
- **Auth Service**: Permission checking and user context
- **Notification Service**: Pipeline status updates

---

## **Error Handling & Edge Cases**

### **Pipeline Validation Rules**

#### **Structural Validation**
- **Step Dependencies**: All steps must have valid dependencies
- **Circular Dependencies**: No circular step references allowed
- **Entry Points**: Pipeline must have valid trigger configuration
- **Exit Points**: Pipeline must have at least one terminal step
- **Variable References**: All variable references must be resolvable

#### **Configuration Validation**
- **Job Configuration**: Each step's config must match job type schema
- **Credential Access**: Steps can only use accessible credentials
- **Budget Limits**: Pipeline budget must be within organization limits
- **Step Limits**: Pipeline cannot exceed maximum step count
- **Timeout Limits**: Pipeline timeout must be reasonable

### **Execution Error Handling**

#### **Step Failures**
```typescript
enum StepFailureAction {
  STOP_PIPELINE = 'stop',           // Stop entire pipeline
  CONTINUE_PIPELINE = 'continue',     // Continue to next step
  RETRY_STEP = 'retry',               // Retry the failed step
  BRANCH_TO_ALTERNATIVE = 'branch'    // Execute alternative step
}

interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}
```

#### **Pipeline Recovery**
- **Automatic Retries**: Configured retry logic for failed steps
- **Manual Recovery**: User intervention for critical failures
- **Partial Success**: Continue successful steps despite failures
- **Rollback**: Undo completed steps on critical failures
- **Alternative Paths**: Execute alternative step configurations

### **Performance Edge Cases**

#### **Large Pipeline Handling**
- **Step Pagination**: Render large pipelines in chunks
- **Virtual Scrolling**: Handle many steps in canvas
- **Lazy Loading**: Load step configurations on demand
- **Memory Management**: Cleanup unused step data

#### **Concurrent Execution**
- **Resource Limits**: Enforce organization-wide limits
- **Queue Management**: Prioritize critical pipelines
- **Isolation**: Prevent pipeline interference
- **Fair Scheduling**: Balance resource allocation

---

## **Performance Considerations**

### **Critical Paths**
- **Pipeline Loading**: Must load complex pipelines < 3 seconds
- **Canvas Rendering**: Must support 100+ steps without lag
- **Execution Monitoring**: Real-time updates < 1 second latency
- **Validation**: Pipeline validation < 2 seconds
- **Template Browsing**: Template loading < 1 second

### **Bottlenecks & Optimizations**
- **Complex Canvas**: Visual rendering of 50+ steps causes lag
- **Validation Logic**: Complex dependency checking is CPU-intensive
- **Real-time Updates**: WebSocket connection management overhead
- **Large Configurations**: Pipeline configs > 100KB cause memory issues
- **Concurrent Editing**: Multiple users editing same pipeline

### **Memory & CPU Usage**
- **Step Objects**: Optimize step data structures
- **Canvas Rendering**: Use virtual DOM diffing
- **Validation Caching**: Cache validation results
- **Component Memoization**: Prevent unnecessary re-renders
- **Garbage Collection**: Cleanup unused connections and data

### **Network Request Patterns**
- **Batch Operations**: Combine multiple step updates
- **WebSocket Usage**: Real-time execution updates
- **Optimistic Updates**: Update UI immediately, rollback on error
- **Debounced Saves**: Auto-save with debouncing
- **Compression**: Compress large pipeline configurations

---

## **Security & Permissions**

### **Access Control**
- **Pipeline Ownership**: Users can only access pipelines in their organization
- **Role-based Permissions**: Different access levels (viewer, editor, admin)
- **Execution Permissions**: Separate permissions for running pipelines
- **Cross-org Sharing**: Limited sharing capabilities between organizations
- **Template Access**: Public vs private template visibility

### **Data Protection**
- **Credential Isolation**: Steps can only use org credentials
- **Input Sanitization**: Clean all pipeline inputs and variables
- **Log Redaction**: Remove sensitive data from execution logs
- **Encryption**: Encrypt sensitive pipeline configurations
- **Audit Trail**: Track all pipeline modifications and executions

### **Security Validation**
- **Injection Prevention**: Prevent code injection in step configurations
- **Resource Limits**: Prevent resource exhaustion attacks
- **Network Access**: Control external network access from pipeline steps
- **File Access**: Restrict file system access to designated areas
- **API Rate Limiting**: Prevent abuse through webhook triggers

---

## **Testing Requirements**

### **Unit Tests**
- **Pipeline Validation**: Test all validation rules and edge cases
- **Step Configuration**: Test job configuration integration
- **Variable Resolution**: Test variable interpolation and scoping
- **Conditional Logic**: Test branching and decision logic
- **Canvas Rendering**: Test step rendering and connection logic

### **Integration Tests**
- **Pipeline Execution**: Test complete pipeline execution flows
- **Step Dependencies**: Test step ordering and dependencies
- **Error Handling**: Test failure recovery and retry logic
- **Webhook Triggers**: Test external webhook integration
- **Database Transactions**: Test pipeline state consistency

### **E2E Tests**
- **Pipeline Creation**: Complete pipeline design workflow
- **Template Usage**: Template selection and customization
- **Execution Monitoring**: Real-time execution tracking
- **Error Scenarios**: Handling of various failure conditions
- **Performance Testing**: Large pipeline performance

---

## **Current Issues & Technical Debt**

### **Known Bugs**
- **Canvas Performance**: Lag with 50+ steps due to rendering complexity
- **Auto-save Issues**: Race conditions with multiple rapid saves
- **Variable Resolution**: Complex variable references not always resolved correctly
- **Connection Display**: Visual connections break during canvas zoom

### **Performance Issues**
- **Initial Load**: Large pipelines take 5+ seconds to load
- **Validation Time**: Complex pipeline validation takes 10+ seconds
- **Memory Leaks**: Canvas component causes memory growth during long sessions
- **Bundle Size**: Pipeline editor components add 3MB to bundle

### **Code Quality Issues**
- **Monolithic Components**: Pipeline editor > 1000 lines
- **Complex State**: Multiple state management patterns mixed
- **Duplicate Code**: Similar logic across step configurators
- **Inconsistent Patterns**: Different approaches for similar features

---

## **Documentation References**

### **Related Documents**
- [01-jobs-system.md](./01-jobs-system.md) - Job definitions and configurations
- [03-knowledge-system.md](./03-knowledge-system.md) - Pipeline knowledge integration
- [05-auth-system.md](./05-auth-system.md) - User permissions and access control
- [13-api-architecture.md](./13-api-architecture.md) - Complete API documentation

### **External Documentation**
- [React Flow](https://reactflow.dev/) - Pipeline visualization library
- [Dagre](https://github.com/dagrejs/dagre) - Layout algorithms
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) - Real-time communication

### **Important Code Locations**
- Pipeline schemas in shared/schema/pipelines/
- Pipeline validation logic in server/routes/pipelines.ts
- Canvas rendering in client/src/components/pipelines/
- Step execution logic in server/services/pipeline-executor.ts