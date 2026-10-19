# Oddjob Application: Comprehensive Functionality and Use Cases

> **Config Reference:** Job type schemas and configuration options are defined in `shared/schema/jobs/config-*.ts`. See docs/JobTypes.md and JOB_TYPES_SPEC for detailed configuration.

---

## Executive Summary

**Oddjob** is an enterprise-grade workflow automation and orchestration platform designed to help organizations build, schedule, and manage complex data pipelines with integrated AI capabilities, knowledge graph construction, and human-in-the-loop (HIL) workflows. The platform combines the power of modern automation with intelligent data extraction, semantic enrichment, and reactive event-driven architectures to create a comprehensive solution for business process automation and knowledge management.

At its core, Oddjob enables users to:
- **Create and configure diverse job types** from shell scripts to AI-powered agents
- **Build sophisticated multi-step pipelines** with conditional logic and parallel execution
- **Schedule and monitor automated workflows** with real-time alerting
- **Construct knowledge graphs** automatically from pipeline outputs
- **Implement human-in-the-loop approval workflows** for critical decisions
- **Track data mutations and changes** over time with reactive intelligence

---

## Part 1: Job System - The Foundation of Automation

### 1.1 Overview

The job system is the foundational layer of Oddjob. A **Job** represents a single, reusable unit of work that can be executed independently or as part of a larger pipeline. Jobs encapsulate configuration, execution logic, and output handling in a standardized way.

### 1.2 Supported Job Types

Oddjob supports a rich variety of job types, each designed for specific use cases:

#### **Shell Jobs**
Execute arbitrary shell commands with configurable executables, parameters, and working directories. Ideal for:
- Running system scripts
- Executing CLI tools
- File system operations
- Batch processing tasks

```typescript
const shellConfig = {
    executable: "/usr/bin/python",
    parameters: "script.py --input data.json",
    workingDirectory: "/opt/scripts"
};
```

#### **CURL/API Jobs**
Make HTTP requests to external APIs with comprehensive configuration options:
- Support for GET, POST, PUT, PATCH, DELETE methods
- Query parameters and custom headers
- Multiple body formats: JSON, text, form-data, XML
- Authentication types: Bearer tokens, Basic auth
- Credential integration for secure API access

**Use Cases:**
- REST API integrations
- Webhook triggers
- Data fetching from external services
- Third-party service orchestration

#### **Python Jobs**
Execute Python scripts directly within the platform:
- Inline script content
- Requirements management
- Integration with pipeline context

**Use Cases:**
- Data transformation
- Complex business logic
- Machine learning inference
- Custom integrations

#### **AI API Call Jobs**
Integrate with AI/LLM providers for intelligent automation:
- Support for OpenAI, Anthropic (Claude), and Google (Gemini)
- Configurable temperature, max tokens, and system prompts
- User prompt templating with variable substitution
- JSON or text response modes
- **RAG (Retrieval-Augmented Generation)** integration:
  - Query expansion for better retrieval
  - Configurable retrieval settings (k, recency bias, authority bias)
  - Reranking support for improved relevance

**Use Cases:**
- Content generation
- Document summarization
- Data extraction from unstructured text
- Intelligent decision making
- Customer support automation

#### **AI Agent Jobs**
Deploy autonomous AI agents with tool-calling capabilities:
- Goal-driven execution
- Multi-step reasoning with iteration limits
- Tool allowlists for controlled access
- Custom system prompts

**Use Cases:**
- Complex task automation
- Multi-step problem solving
- Research and analysis workflows
- Self-healing systems

#### **Transformer Jobs**
Transform and reshape data between pipeline steps:
- JSONPath-based field mapping
- Value wrapping and extraction
- Field parsing and formatting
- **Entity extraction** for knowledge graph construction:
  - Define entity rules with type, label, and mappings
  - Create relationship rules between entities
  - Auto-create nodes and edges in knowledge graph

**Use Cases:**
- Data normalization
- API response transformation
- Schema migration
- Knowledge graph population

#### **Repeater Jobs**
Iterate over collections and execute nested operations:
- Input source from previous steps
- Nested CURL/API execution for each item
- Configurable iteration limits and error handling
- Sequential or parallel execution modes
- Configurable concurrency for parallel execution

**Use Cases:**
- Batch API calls
- Bulk data processing
- Fan-out operations
- Collection transformations

#### **Iterator Jobs**
Execute other jobs or entire pipelines for each item in a collection:
- `mode`: Run a 'job' or 'pipeline'
- `targetId`: ID of the job or pipeline to run
- `inputArray`: Variable reference to source array (e.g. `{{steps.1.output.items}}`)
- `itemVarName`: Variable name injected for current item
- Output aggregation and concurrency control (1-50)

**Use Cases:**
- Dynamic job chaining
- Recursive pipeline execution
- Complex iteration patterns
- Distributed processing

#### **Decision Jobs**
Implement conditional logic in pipelines:
- `condition`: CEL (Common Expression Language) expression
- `trueStepId`: Step ID when condition is true
- `falseStepId`: Step ID when condition is false
- Step output access for decision making (e.g. `steps.0.output.score > 0.5`)

**Use Cases:**
- Conditional workflow branching
- Quality gates
- Approval workflows
- Error handling logic

#### **Human Approval Jobs**
Pause pipeline execution for human review and approval:
- Configurable form templates
- Assignee email routing
- Timeout handling
- OTP security for external access

**Use Cases:**
- Compliance review workflows
- Content moderation
- Change approval processes
- Quality assurance gates

#### **OpenAPI Jobs**
Execute operations defined in OpenAPI/Swagger specifications:
- Spec-driven parameter configuration
- Operation ID selection
- Automatic credential injection

**Use Cases:**
- Standardized API integrations
- Self-documenting API calls
- Service catalog integration
- Enterprise API governance

#### **Airflow DAG Run Jobs**
Integrate with Apache Airflow for enterprise orchestration:
- DAG triggering with configuration
- Completion waiting
- XCom data fetching
- Timeout and polling configuration

**Use Cases:**
- Enterprise workflow integration
- Legacy system orchestration
- Data pipeline coordination
- Hybrid automation

#### **Slack Post Jobs**
Send messages to Slack channels:
- Channel ID targeting
- Message templating
- Credential-based authentication

**Use Cases:**
- Pipeline notifications
- Alerting workflows
- Team collaboration
- Status updates

#### **Email Send Jobs**
Send emails via SMTP integration:
- To, Subject, Body configuration
- HTML or plain text
- SMTP credential integration

**Use Cases:**
- Report distribution
- Alert notifications
- Customer communications
- Approval requests

#### **SQL Query Jobs**
Execute database queries:
- PostgreSQL support
- List or single result modes
- Secure credential management

**Use Cases:**
- Data extraction
- Report generation
- Database monitoring
- Data validation

#### **Folder Import Jobs**
Import and process files from directories:
- Glob pattern matching
- Recursive directory traversal
- Modes: list only, read content, or ingest to dataset
- Archive extraction
- Post-process actions (move, delete)
- Schema validation and mapping

**Use Cases:**
- Batch file processing
- Data ingestion pipelines
- Document processing
- Legacy system integration

#### **File Export Jobs**
Write output to files:
- Configurable destination paths
- Multiple formats: raw, JSON, CSV
- Conflict handling: overwrite, append, fail, rename
- Encoding options

**Use Cases:**
- Report generation
- Data export
- Backup creation
- Integration file drops

#### **Selenium/Browser Automation Jobs**
Automate web browser interactions using Playwright:
- **Execution Modes:**
  - Local execution (Chromium, Firefox, WebKit)
  - Remote Selenium Grid support
- **Browser Configuration:**
  - Headless or headed modes
  - Custom viewport, user agent, locale, timezone
  - Geolocation spoofing
  - Resource blocking (images, media, fonts)
- **Actions Available:**
  - Navigation: goto, wait for URL/selector/network
  - Interaction: click, type, select, hover, scroll
  - Extraction: text, HTML, JSON, attributes
  - Screenshots and PDF generation
  - JavaScript evaluation
  - File uploads
  - Frame switching
- **Advanced Features:**
  - Proxy configuration
  - HTTP authentication
  - Cookie import/export
  - Video recording
  - HAR file saving

**Use Cases:**
- Web scraping
- Automated testing
- Form submission
- Data extraction from web applications
- RPA (Robotic Process Automation)

#### **Reranker Jobs**
Improve RAG retrieval quality with intelligent reranking:
- Model-based reranking (BAAI/bge-reranker-v2-m3)
- Top-K selection
- Query and document source configuration

**Use Cases:**
- Enhanced search results
- Improved RAG accuracy
- Document relevance scoring

#### **JIRA Sync Jobs**
Sync JIRA projects and issues into the knowledge system:
- `projectKeys`: List of JIRA project keys to sync
- `credentialId`: JIRA credential
- `syncMode`: Full or incremental sync

**Use Cases:**
- Knowledge graph population from JIRA
- Issue tracking integration
- Project metadata sync

#### **Static Response Jobs**
Return static JSON or text for testing or mocking:
- `content`: Static content (supports variable substitution)
- `outputMapping`: Optional output field mapping

**Use Cases:**
- Pipeline testing and mocking
- Placeholder steps
- Constant value injection

#### **Supervisor Jobs**
Orchestrate sub-jobs with retry logic and escalation:
- `subJobs`: List of jobs or pipelines to coordinate
- `retryConfig`: Retry attempts and backoff
- `escalationPath`: Optional escalation on failure

**Use Cases:**
- Multi-step orchestration with resilience
- Retry and escalation workflows
- Job coordination

#### **Form Agent Jobs**
Form-powered AI agent for guided data collection:
- `formSchema`: Form field definitions
- `documentTemplateId`: Reference to document template
- `outputDataset`: Optional dataset for results

**Use Cases:**
- Guided data collection workflows
- Form-driven AI processing
- Structured data capture

---

## Part 2: Pipeline Orchestration - Building Complex Workflows

### 2.1 Pipeline Architecture

Pipelines are the orchestration layer that connects jobs into cohesive workflows. A **Pipeline** consists of:
- **Steps**: Ordered sequence of job executions
- **Flow Control**: Conditional logic and branching
- **Triggers**: Manual, scheduled, or event-driven activation
- **Context**: Shared state and variable resolution

### 2.2 Pipeline Step Configuration

Each pipeline step extends job configuration with orchestration features:

#### **Run Conditions**
- `on_success`: Execute only if previous step succeeded
- `on_failure`: Execute only if previous step failed
- `always`: Execute regardless of previous step status

#### **Failure Actions**
- `Stop Pipeline`: Halt execution on failure
- `Continue to Next`: Proceed despite failure
- `Execute Fallback Job`: Run alternative job on failure

#### **Advanced Flow Control**
- **Parallel Groups**: Execute multiple steps concurrently
- **Wait Duration**: Delay before step execution
- **Condition Expressions**: Custom CEL-based execution gates
- **Decision Nodes**: Logic Gatekeeper modules for complex routing

### 2.3 Decision Node System (Loopbane Protocols)

The Decision Node is a specialized step type for implementing sophisticated conditional logic:

#### **CEL Condition Evaluation**
```cel
steps[0].output.status == "approved" && steps[0].output.score > 0.85
```

#### **Route Configuration**
- True Path: Step ID to execute when condition is true
- False Path: Step ID to execute when condition is false
- Default handling for unexpected states

#### **Safety Policies (Doomsday Clock)**
- TTL (Time-to-Live) for pipeline executions
- Automatic cancellation of runaway workflows
- Loop detection and prevention

### 2.4 Pipeline Triggers

Pipelines can be activated through multiple mechanisms:

#### **Manual Triggers**
- UI-initiated execution
- API-triggered execution
- Parameter injection at runtime

#### **Schedule Triggers**
- Cron-like scheduling patterns
- Timezone-aware execution
- Holiday calendar integration
- Catchup policies for missed runs

#### **Event Triggers**
- Event type pattern matching
- Filter conditions for event selection
- Debounce windows to prevent rapid-fire
- Batch size configuration for event bundling

### 2.5 Pipeline Execution Tracking

The platform provides comprehensive execution visibility:

#### **Execution States**
- `running`: Pipeline currently executing
- `completed`: All steps finished successfully
- `failed`: Execution encountered an error
- `cancelled`: Execution was manually or automatically cancelled

#### **Step Execution Tracking**
- Individual step status
- Output capture (text/JSON)
- Error messages and stack traces
- Execution timestamps
- Trace IDs for distributed tracing

#### **Versioning**
- Pipeline version snapshots
- Version history with descriptions
- Rollback capabilities
- Change attribution

---

## Part 3: Scheduling and Job Management

### 3.1 Schedule Patterns

Oddjob supports flexible scheduling configurations:

#### **Pattern Types**
- Minutely, hourly, daily, weekly
- Custom cron expressions
- Calendar-aware scheduling

#### **Timezone Handling**
- IANA timezone support
- DST-aware scheduling
- Holiday behavior options (skip, move next/prev)

### 3.2 Scheduled Jobs

Scheduled jobs link jobs or pipelines to schedules:

#### **Configuration Options**
- Priority levels (1-3)
- Active/inactive status
- Retry configuration (0-10 retries with configurable delays)
- Maximum concurrent runs
- Queue timeout handling

#### **Alerting Integration**
- Alert on failure
- Alert on success
- Alert on delay (with configurable threshold)

#### **Trigger Types**
- Schedule-based
- Manual
- Webhook-triggered
- API-triggered

### 3.3 Run Locks and Concurrency

The platform manages concurrent execution:

- **Run Locks**: Prevent overlapping executions
- **In-Progress Tracking**: Monitor active runs
- **Queue Management**: Handle pending executions

---

## Part 4: Knowledge Graph and Knowledge Management

### 4.1 Knowledge Store

The Knowledge Store is a curated repository for reusable knowledge:

#### **Knowledge Topics**
- Hierarchical organization with parent-child relationships
- Topic descriptions and metadata
- Privacy controls (global vs. organization-specific)
- Document aggregation by topic

#### **Knowledge Documents**
- Multiple source types: text content, file upload, URL link
- Topic assignments (many-to-many)
- Content type tracking
- File storage integration

#### **Integration with AI Jobs**
- Topic selection for context injection
- Document selection for specific content
- Maximum document limits per topic (`KNOWLEDGE_TOPIC_DOC_LIMIT`)

### 4.2 Knowledge Graph Architecture

The Knowledge Graph provides structured entity and relationship storage:

#### **Knowledge Nodes**
- **Label**: Entity classification (User, Ticket, Feature, Infrastructure)
- **Name**: Human-readable identifier
- **External ID**: Source system identifier for deduplication
- **Data**: Flexible JSONB payload for arbitrary metadata
- **Fingerprint**: Content hash for deduplication
- **Verification Workflow**: staging → verified → rejected states
- **Confidence Scores**: AI extraction confidence (0.00 - 1.00)

#### **Knowledge Edges**
- **Source/Target**: Node connections
- **Relation**: Relationship type (REPORTED, BLOCKED_BY, CAUSED, RELATED_TO)
- **Weight**: Connection strength (1-10)
- **Run Tracking**: Pipeline execution attribution

#### **Idempotency Guarantees**
- Unique constraint on (organizationId, label, externalId)
- Fingerprint-based deduplication
- Update rather than duplicate on re-extraction

### 4.3 Entity Extraction Mechanisms

#### **Method 1: Explicit Knowledge Graph Rules**
JSONPath-based extraction from structured data:
```json
{
  "rules": [{
    "ruleId": "rule-1",
    "entityType": "Ticket",
    "sourceRootPath": "$.issues[*]",
    "entityNamePath": "$.fields.summary",
    "externalIdPath": "$.key"
  }]
}
```

#### **Method 2: Semantic Enrichment**
Automatic extraction using:
- **Regex Patterns**: High-confidence pattern matching (VINs, ticket IDs)
- **AI Extraction**: LLM-based entity extraction with prompts

#### **Method 3: Human-in-the-Loop**
Knowledge creation from form submissions:
- Approval metadata nodes
- Ratings and feedback capture
- Human-verified data points

### 4.4 Knowledge Garden (Verification Workflow)

The Knowledge Garden enables human review of AI-extracted entities:

#### **Staging Area**
- Newly extracted entities await verification
- Confidence scores guide review priority
- Batch review capabilities

#### **Verification Actions**
- **Approve**: Move to verified status
- **Reject**: Mark as rejected (soft delete)
- **Correct**: Edit and approve with corrections

#### **Statistics Dashboard**
- Pending items count
- Verification rate trends
- Confidence distribution

### 4.5 Graph Schema Definitions

Define extraction ontologies per organization:

#### **Entity Mappings**
- Rule-based extraction configuration
- JSONPath selectors for fields
- Data mapping and transformation

#### **Relationship Mappings** (Knowledge Engine 2.0)
- Source key mappings
- Node label assignments
- AI or regex extraction types

### 4.6 RAG Asset Management

Integration with Retrieval-Augmented Generation:

#### **Asset Types**
- PDF documents
- Text content
- Embeddings (vector representations)
- Datasources
- URLs
- Knowledge Topics
- Knowledge Documents

#### **Vector Storage (Qdrant)**
- Automatic embedding generation
- Semantic similarity search
- Chunk management with configurable size/overlap

#### **Selection Types**
- Custom: Per-job asset uploads
- Topic: All documents from a knowledge topic
- Document: Specific knowledge document reference

---

## Part 5: Human-in-the-Loop (HIL) Workflows

### 5.1 HIL Forms

Customizable forms for human interaction within pipelines:

#### **Form Definition**
- Flexible field schema (text, select, checkbox, etc.)
- Required field validation
- Custom labels and descriptions

#### **Theme Configuration**
- Logo customization
- Primary color branding
- Company name display

#### **Security Configuration**
- OTP requirement toggle
- Token expiration settings (hours)
- Secure external access

### 5.2 External Task Access

Enable external stakeholders to participate in workflows:

#### **Token-Based Access**
- UUID trace IDs for unique task identification
- Time-limited access tokens
- No authentication required for external users

#### **OTP Security**
- 6-digit code generation
- Email delivery to assignee
- Code expiration and usage tracking

### 5.3 HIL Integration Points

#### **Pipeline Pausing**
- `waiting_external_input` status
- Automatic notification to assignee
- Timeout handling with configurable durations

#### **Approval Flow**
1. Pipeline reaches Human Approval step
2. Form is rendered for external access
3. Optional OTP verification
4. Assignee reviews context and makes decision
5. Pipeline resumes with approval data

---

## Part 6: Reactive Intelligence and Event System

### 6.1 Event-Driven Architecture

CloudEvents-compliant event system for reactive automation:

#### **Event Structure**
- Event ID (UUID)
- Type (hierarchical: job.changed, pipeline.completed)
- Source (originating entity reference)
- Subject (affected entity)
- Payload (event data)

#### **Event Types**
- Job execution events (success, failure, changed)
- Pipeline execution events
- System events (alerts, security)
- Custom business events

### 6.2 Event Log and Audit

Comprehensive event tracking:

#### **Event Log Table**
- Full event payload storage
- Organization scoping
- Timestamp indexing
- Type and source indexing

#### **Audit Events**
- Category tracking (user, job, pipeline, credential, org)
- Action types (create, update, delete, execute, login, logout)
- Actor attribution
- Reference entity tracking
- Details payload

### 6.3 Webhook Subscriptions

Outbound event delivery to external systems:

#### **Subscription Configuration**
- Event type patterns (glob matching: "ticket.*", "*")
- Target URL configuration
- HTTP method selection (POST, PUT, PATCH)
- Custom headers
- Payload template transformation

#### **Reliability Features**
- Retry configuration (count and delay)
- Timeout settings
- Success/failure tracking
- Last triggered timestamp

### 6.4 Diffing and Change Detection

Reactive Intelligence for tracking data changes:

#### **Diff Service**
- Compare outputs between runs
- Ignore path configuration (timestamps, metadata)
- Change significance calculation
- Added/removed/modified tracking

#### **Snapshot Management**
- Point-in-time data captures
- Label and description metadata
- Primary baseline designation
- Comparison capabilities

#### **Change Detection Settings per Job**
- Enable/disable diffing
- Baseline mode selection (last run, primary snapshot)
- Ignore paths configuration
- Significance threshold (percentage)

---

## Part 7: Integrations and Credentials

### 7.1 Credential Management

Secure storage and rotation of sensitive credentials:

#### **Credential Types**
- API Keys
- Passwords
- OAuth Tokens
- Webhooks
- SSH Keys
- AI Provider credentials
- JIRA integrations
- Airflow connections
- Database connections
- SMTP configurations

#### **Provider-Specific Metadata**
- **OpenAI**: Organization ID, API version
- **Anthropic**: API version
- **Google**: Project ID
- **Midjourney**: Base URL (proxy), mode (fast/relax)
- **JIRA**: Base URL, email
- **Airflow**: Base URL, auth type, username
- **Database**: Host, port, database name, engine
- **SMTP**: Host, port, secure flag, user, from email

#### **Security**
- Each organization's secret stored encrypted (AES-256-GCM) and sealed to its organization; never returned by the API
- Environment variables only for platform-level credentials (and legacy rows outside production); platform secrets can never back a credential
- Jobs and tools load credentials from their own organization or the platform, never another tenant's
- AI is strict BYOK: each organization connects its own Gemini key; production runs no AI on a platform key
- See [AI keys and credentials](../developer-guides/KEYS_AND_CREDENTIALS.md)

### 7.2 OpenAPI/Swagger Integration

Enterprise API specification management:

#### **API Specs**
- Full OpenAPI/Swagger definition storage
- System-level and organization-level specs
- Status lifecycle (draft, testing, published, deprecated)
- Source URL tracking

#### **Organization Access**
- Spec enablement per organization
- Organization-specific settings overrides

### 7.3 External Service Integrations

#### **Qdrant Vector Database**
- Semantic search capabilities
- Embedding storage and retrieval
- Collection management

#### **Redis**
- State tracking for distributed operations
- Caching layer
- Job queue management

#### **Email Service**
- SMTP-based email delivery
- Template support
- Delivery tracking

---

## Part 8: Analytics and Monitoring

### 8.1 Cost Dashboard

Track AI usage and expenditure:

#### **Usage Metrics**
- Token consumption (prompt + completion)
- Provider breakdown (OpenAI, Anthropic, Google)
- Model usage distribution

#### **Cost Tracking**
- Per-execution cost calculation
- Pipeline-level aggregation
- Time-based trending
- Budget management (monthly limits)

### 8.2 Alert System

Proactive notification of system issues:

#### **Alert Categories**
- Job failure
- Job success
- Job delay
- Pipeline failure
- System issues
- Security events

#### **Alert Severity Levels**
- Info
- Warning
- Error
- Critical

#### **Alert Lifecycle**
- Creation
- Acknowledgment
- Resolution
- Suppression (with reason and duration)

### 8.3 Suppression Policies

Control alert fatigue:

#### **Configuration Options**
- Quiet hours enablement
- Severity bypass rules
- User-specific filters
- Never-notify suppression

### 8.4 Analytics Visualization

#### **Sankey Diagrams**
- Entity flow visualization
- Multi-dimensional analysis
- Relationship traversal
- Volume aggregation

#### **Forensic Analysis**
- Time-window comparison
- Mutation detection
- Trend identification
- Anomaly discovery

---

## Part 9: Administration and Security

### 9.1 Organization Management

Multi-tenant architecture:

#### **Organization Features**
- Isolated data and resources
- Suppression policy assignment
- Settings customization

#### **Organization Settings**
- Knowledge Store enablement
- Knowledge Graph enablement
- Allowed agent tools list

### 9.2 User Management

Role-based access control:

#### **User Attributes**
- Username and email
- First and last name
- Default organization assignment
- Quiet hours preferences
- Alert filter customizations

#### **Admin Roles**
- Super Admin: Platform-wide access
- Org Admin: Organization-scoped access

### 9.3 File Storage

Versioned file management:

#### **File Features**
- Name, path, MIME type tracking
- Size and checksum validation
- Description and tag metadata
- Version history with change descriptions
- Soft delete support

---

## Part 10: Use Case Scenarios

### 10.1 JIRA Ticket Analysis Pipeline

**Scenario**: Automatically analyze and categorize JIRA tickets

1. **OpenAPI Job**: Fetch tickets from JIRA REST API
2. **Transformer Job**: Extract ticket entities and metadata
3. **AI API Call Job**: Analyze ticket content and suggest categories
4. **Human Approval Job**: Review AI suggestions
5. **API Job**: Update JIRA ticket with approved categories

**Knowledge Graph Integration**: Create Ticket nodes, User nodes, and REPORTED relationships

### 10.2 Competitive Intelligence System

**Scenario**: Monitor competitor pricing and alert on changes

1. **Selenium Job**: Scrape competitor product pages
2. **Transformer Job**: Normalize pricing data
3. **Decision Job**: Check for significant price changes (>10%)
4. **Slack Post Job**: Alert team on price drops
5. **File Export Job**: Archive historical data

**Reactive Intelligence**: Diff comparison triggers alerts only on meaningful changes

### 10.3 Document Processing and Knowledge Extraction

**Scenario**: Process incoming documents and build knowledge base

1. **Folder Import Job**: Watch directory for new files
2. **AI API Call Job**: Extract key information using RAG
3. **Transformer Job**: Create entities and relationships
4. **Knowledge Graph**: Store extracted entities
5. **Knowledge Garden**: Human review of extractions

**Use Case**: Legal document analysis, research paper processing, compliance documentation

### 10.4 Customer Support Automation

**Scenario**: Intelligent ticket routing and response suggestion

1. **Webhook Trigger**: New support ticket created
2. **AI Agent Job**: Analyze ticket and search knowledge base
3. **Decision Job**: Route based on complexity
4. **Human Approval Job**: Review suggested response
5. **Email Send Job**: Deliver response to customer

**Integration**: Knowledge Store provides context, AI Agent suggests responses

### 10.5 Data Quality Monitoring

**Scenario**: Continuous data quality validation

1. **SQL Query Job**: Extract data samples
2. **Transformer Job**: Apply validation rules
3. **Decision Job**: Check quality thresholds
4. **Alert Path**: Create alerts on quality issues
5. **Snapshot**: Capture baseline for comparison

**Reactive Intelligence**: Track quality trends over time with forensic analysis

### 10.6 Browser-Based RPA Workflow

**Scenario**: Automate web application interactions

1. **Selenium Job**: Navigate to web portal and login
2. **Selenium Job**: Extract data from dashboard
3. **Transformer Job**: Process extracted data
4. **API Job**: Push data to internal system
5. **Slack Post Job**: Report completion

**Features**: Session cookies, HTTP auth, retry on failure, screenshot capture

---

## Conclusion

Oddjob is a comprehensive automation platform that bridges the gap between simple task automation and enterprise-grade workflow orchestration. Its key differentiators include:

- **Diverse Job Types**: From shell scripts to AI agents, supporting any automation need
- **Intelligent Knowledge Management**: Automatic entity extraction and knowledge graph construction
- **Human-in-the-Loop Integration**: Seamless human review in automated workflows
- **Reactive Intelligence**: Change detection and event-driven automation
- **Enterprise Security**: Credential management, audit logging, and multi-tenancy

The platform is designed for organizations that need to automate complex processes while maintaining visibility, control, and the ability to incorporate human judgment at critical decision points.

---

*Document Version: 1.0 (Mach 3 Extended)*  
*Last Updated: April 2026*  
*Total Pages: ~25 (formatted)*

---

## Part 8: Mach 3 Distributed Architecture

### 8.1 Overview

Mach 3 represents the transition of Oddjob from a monolithic service to a highly distributed, role-based architecture. This evolution enables better scaling, isolation of concerns, and specialized resource allocation for different types of workloads.

### 8.2 Service Roles

The system is configured via the `SERVICE_ROLE` environment variable, which determines the active modules and handlers for a given node:

#### **API Role (`SERVICE_ROLE=api`)**
- Primary entry point for the frontend and external users.
- Handles RESTful requests, authentication, and session management.
- Manages the CRUD operations for jobs, pipelines, and knowledge topics.
- Proxies requests to internal services when necessary.

#### **Gateway Role (`SERVICE_ROLE=gateway`)**
- Orchestrates the entry point for ingress traffic and cross-service communication.
- Manages health checks and routing policies.

#### **Worker Role (`SERVICE_ROLE=worker`)**
- Executes background tasks and scheduled syncs.
- Listens to the internal task queues for immediate processing.
- Handles resource-intensive non-interactive workloads.

#### **Mission Role (`SERVICE_ROLE=mission`)**
- The "Brain" of the distributed system.
- Orchestrates complex multi-step pipeline executions.
- Manages the state and context of large-scale agentic missions.
- Communicates with the `worker` pods for specific step executions.

#### **Forge Role (`SERVICE_ROLE=forge`)**
- Dedicated service for "Forging" (synthesizing) new agents and jobs.
- Implements the **Asynchronous Forge Queue**, allowing for long-running AI synthesis without blocking the main API.
- Manages the HIL (Human-In-The-Loop) review loop for newly created agent definitions.

### 8.3 Asynchronous Workflows

The Mach 3 architecture transitions heavy operations to an asynchronous model:

1. **Job Synthesis (The Forge)**: Creating a new agent no longer returns the `appId` synchronously. Instead, it returns a `jobId`, and the user is notified via the Mission Event Bus when the synthesis is complete or requires review.
2. **Distributed Tracing**: All cross-service calls are tracked using W3C Trace Context, enabling end-to-end visibility of a request from the UI through the Mission runner down to the individual Worker.
3. **Forensic Telemetry**: High-fidelity logging captures every state change in the mission lifecycle for audit and debug purposes.
