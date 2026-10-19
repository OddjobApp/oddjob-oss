# Developer Experience: Local Dev Stack & CLI

**Feature ID:** `developer-experience`  
**Pillar:** Cross-Pillar (Missions, Forge, Knowledge, Control)  
**Maturity Target:** Foundation → Maturing  
**Addresses Hardening Focus:** "first-mission-demo-path" readiness check  

## Overview

The Developer Experience (DX) initiative provides developers with tooling to work with Oddjob locally and programmatically. It consists of two main components:

1. **Local Development Stack**: A complete Oddjob environment in Docker for local development and testing
2. **Mission CLI**: A command-line interface for managing missions programmatically

### Positioning

For developers building on Oddjob, these tools provide:

- **Local Development**: Full Oddjob stack running locally with hot reload and debugging
- **Testing Framework**: Mission testing with fixtures and knowledge store seeding
- **Programmatic Control**: CLI for mission management, automation, and CI/CD integration
- **Developer Onboarding**: Lower barrier to entry with standardized local environment

### Buyer Value

"Developers can iterate quickly with a local Oddjob stack, test missions with realistic fixtures, and integrate mission workflows into CI/CD pipelines using a robust CLI."

## Part 1: Local Development Stack

### User Stories

#### As a Developer
- I want to run the full Oddjob stack locally so I can develop without touching production
- I want hot reload so I can see changes immediately
- I want to debug missions locally so I can step through execution
- I want to seed the knowledge store with test data so I can test RAG functionality

#### As a QA Engineer
- I want to run missions with fixtures so I can test edge cases
- I want to reset the database between tests so tests are isolated
- I want to capture mission logs locally so I can debug failures
- I want to simulate different organizations so I can test multi-tenant behavior

#### As a Platform Engineer
- I want to configure the local stack with environment variables so I can match production settings
- I want to monitor resource usage locally so I can optimize performance
- I want to export local data to production so I can promote working configurations
- I want to run smoke tests locally so I can validate changes before deployment

### Technical Architecture

#### Docker Compose Configuration

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: oddjob-postgres-dev
    environment:
      POSTGRES_DB: oddjob_dev
      POSTGRES_USER: oddjob
      POSTGRES_PASSWORD: oddjob_dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./server/migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U oddjob"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Redis
  redis:
    image: redis:7-alpine
    container_name: oddjob-redis-dev
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Qdrant Vector Database
  qdrant:
    image: qdrant/qdrant:latest
    container_name: oddjob-qdrant-dev
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334
      QDRANT__LOG_LEVEL: DEBUG

  # Oddjob Server (with hot reload)
  server:
    build:
      context: ./server
      dockerfile: Dockerfile.dev
    container_name: oddjob-server-dev
    ports:
      - "5000:5000"
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://oddjob:oddjob_dev_password@postgres:5432/oddjob_dev
      REDIS_URL: redis://redis:6379
      QDRANT_URL: http://qdrant:6333
      QDRANT_API_KEY: ""
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      INTERNAL_RPC_KEY: dev-rpc-key
      INTERNAL_URL: http://server:5000
      ENABLED_WORKERS: ai,extraction,browser,mission,schedules,cycles
    volumes:
      - ./server:/app/server
      - /app/server/node_modules
      - ./shared:/app/shared
      - ./blueprints:/app/blueprints
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      qdrant:
        condition: service_started
    command: npm run dev:watch

  # Oddjob Client (with hot reload)
  client:
    build:
      context: ./client
      dockerfile: Dockerfile.dev
    container_name: oddjob-client-dev
    ports:
      - "3000:3000"
    environment:
      VITE_API_URL: http://localhost:5000
    volumes:
      - ./client:/app/client
      - /app/client/node_modules
      - ./packages:/app/packages
    depends_on:
      - server
    command: npm run dev

  # Trycua (Computer Use) - Optional
  trycua:
    image: ghcr.io/your-org/trycua:latest
    container_name: oddjob-trycua-dev
    ports:
      - "8080:8080"
    environment:
      TRYCUA_API_KEY: dev-trycua-key
    volumes:
      - ./external/cua:/app/cua
    profiles:
      - trycua

volumes:
  postgres_data:
  redis_data:
  qdrant_data:
```

#### Development Tooling

```typescript
// cli/src/dev/stack.ts
interface DevStackConfig {
  environment: "local" | "staging" | "production";
  services: {
    postgres: boolean;
    redis: boolean;
    qdrant: boolean;
    server: boolean;
    client: boolean;
    trycua: boolean;
  };
  debug: {
    enabled: boolean;
    port: number;
  };
  hotReload: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

class DevStackManager {
  async up(config: DevStackConfig): Promise<void> {
    // Start Docker Compose services
    // Wait for health checks
    // Run migrations
    // Seed initial data
  }

  async down(): Promise<void> {
    // Stop all services
    // Preserve volumes by default
  }

  async reset(): Promise<void> {
    // Stop services
    // Remove volumes
    // Start fresh
  }

  async logs(service?: string): Promise<void> {
    // Stream logs from specific service or all
  }

  async status(): Promise<ServiceStatus[]> {
    // Check health of all services
  }

  async debug(port: number): Promise<void> {
    // Attach debugger to server
  }
}
```

#### Testing Framework

```typescript
// cli/src/test/mission-tester.ts
interface MissionTestFixture {
  id: string;
  name: string;
  description: string;
  setup: {
    knowledgeDocuments: KnowledgeDocument[];
    databaseSeed: DatabaseSeed;
    environmentVariables: Record<string, string>;
  };
  mission: {
    prompt: string;
    context: MissionContext;
    expectedOutcomes: ExpectedOutcome[];
  };
  assertions: Assertion[];
}

interface ExpectedOutcome {
  type: "agent_response" | "tool_call" | "app_generated" | "approval_needed";
  matcher: Matcher;
}

interface Assertion {
  type: "response_contains" | "tool_called" | "no_errors" | "approval_triggered";
  value?: any;
  path?: string; // JSON path for nested assertions
}

class MissionTester {
  async loadFixture(fixturePath: string): Promise<MissionTestFixture> {
    // Load fixture from file
  }

  async setupFixture(fixture: MissionTestFixture): Promise<void> {
    // Seed knowledge store
    // Seed database
    // Set environment variables
  }

  async runMission(fixture: MissionTestFixture): Promise<MissionTestResult> {
    // Create mission
    // Execute mission
    // Capture logs
    // Wait for completion
  }

  async assertResults(result: MissionTestResult, fixture: MissionTestFixture): Promise<AssertionResult[]> {
    // Run assertions against results
  }

  async teardownFixture(fixture: MissionTestFixture): Promise<void> {
    // Clean up knowledge store
    // Clean up database
    // Reset environment
  }

  async runTestSuite(fixturePaths: string[]): Promise<TestSuiteResult> {
    // Run multiple fixtures
    // Aggregate results
    // Generate report
  }
}
```

#### Knowledge Store Seeding

```typescript
// cli/src/test/knowledge-seeder.ts
interface KnowledgeSeedConfig {
  documents: KnowledgeDocument[];
  topics: KnowledgeTopic[];
  embeddings?: {
    model: string;
    batchSize: number;
  };
}

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  sourceType: "text" | "upload" | "link";
  metadata: Record<string, any>;
}

interface KnowledgeTopic {
  id: string;
  name: string;
  description: string;
  documentIds: string[];
}

class KnowledgeSeeder {
  async seed(config: KnowledgeSeedConfig): Promise<void> {
    // Create documents
    // Create topics
    // Assign documents to topics
    // Generate embeddings if configured
  }

  async fromDirectory(directory: string): Promise<KnowledgeSeedConfig> {
    // Scan directory for markdown/text files
    // Auto-create topics based on directory structure
    // Return seed config
  }

  async fromJSON(jsonPath: string): Promise<KnowledgeSeedConfig> {
    // Load seed config from JSON file
  }

  async reset(): Promise<void> {
    // Clear all knowledge store data
  }

  async export(): Promise<KnowledgeSeedConfig> {
    // Export current knowledge store to config
  }
}
```

### Fixture Structure

```yaml
# fixtures/missions/support-triage.yaml
id: "support-triage-golden-path"
name: "Governed Support Triage - Golden Path"
description: "Tests the complete support triage workflow with knowledge grounding and approvals"

setup:
  knowledgeDocuments:
    - id: "support-policy-v1"
      title: "Support Policy v1.0"
      content: |
        # Support Policy
        
        ## Tier 1 Issues
        - Response time: < 2 hours
        - Resolution time: < 24 hours
        
        ## Tier 2 Issues
        - Response time: < 4 hours
        - Resolution time: < 48 hours
      sourceType: "text"
      metadata:
        version: "1.0"
        category: "policy"
  
  topics:
    - id: "support-policies"
      name: "Support Policies"
      description: "All support-related policies and procedures"
      documentIds: ["support-policy-v1"]
  
  databaseSeed:
    users:
      - id: "test-user-1"
        email: "developer@example.com"
        role: "developer"
    organizations:
      - id: 1
        name: "Test Organization"
  
  environmentVariables:
    GEMINI_API_KEY: "${GEMINI_API_KEY}"
    APPROVAL_REQUIRED: "true"

mission:
  prompt: "A customer has reported a critical issue with their deployment. The error message is 'Connection timeout to database'. Please triage this issue according to our support policy."
  context:
    organizationId: 1
    userId: "test-user-1"
    mode: "plan"
  
  expectedOutcomes:
    - type: "knowledge_retrieval"
      matcher:
        sourceId: "support-policy-v1"
    - type: "approval_needed"
      matcher:
        action: "external_communication"
    - type: "agent_response"
      matcher:
        contains: "Tier 1"

assertions:
  - type: "knowledge_retrieval"
    path: "evidence.sourceId"
    value: "support-policy-v1"
  - type: "approval_triggered"
    path: "status"
    value: "needs_approval"
  - type: "response_contains"
    value: "Tier 1"
  - type: "no_errors"
```

### CLI Commands

```bash
# Stack Management
oddjob dev up                    # Start local development stack
oddjob dev up --services postgres redis  # Start specific services
oddjob dev down                  # Stop local development stack
oddjob dev reset                 # Reset stack (remove volumes)
oddjob dev logs [service]        # View logs
oddjob dev status                # Check service health
oddjob dev debug --port 9229     # Attach debugger

# Testing
oddjob test mission <fixture>     # Run single mission test
oddjob test suite <directory>    # Run test suite
oddjob test watch <directory>    # Watch for fixture changes
oddjob test coverage             # Generate test coverage report

# Knowledge Seeding
oddjob seed knowledge <config>   # Seed knowledge store from config
oddjob seed knowledge ./docs     # Seed from directory
oddjob seed knowledge --reset    # Reset knowledge store
oddjob seed knowledge --export    # Export current knowledge

# Utilities
oddjob dev migrate               # Run database migrations
oddjob dev seed-db               # Seed database with test data
oddjob dev shell                 # Open shell in server container
oddjob dev doctor                # Diagnose development environment
```

## Part 2: Mission CLI

### User Stories

#### As a DevOps Engineer
- I want to create missions from the CLI so I can automate mission creation
- I want to list and filter missions so I can monitor mission status
- I want to pause/resume missions so I can control execution
- I want to integrate mission management into CI/CD pipelines

#### As a Platform Engineer
- I want to perform bulk operations on missions so I can manage at scale
- I want to export mission data so I can analyze patterns
- I want to script mission workflows so I can build automation
- I want to validate mission configurations before deployment

#### As a Developer
- I want to debug missions from the CLI so I can troubleshoot issues
- I want to view mission logs so I can understand execution
- I want to replay missions so I can test fixes
- I want to compare mission runs so I can identify regressions

### Technical Architecture

#### CLI Structure

```typescript
// cli/src/commands/mission.ts
interface MissionCommandOptions {
  format: "json" | "table" | "yaml";
  output?: string;
  verbose: boolean;
  dryRun: boolean;
}

class MissionCLI {
  // Mission CRUD
  async create(options: {
    prompt: string;
    context?: MissionContext;
    config?: MissionConfig;
  }): Promise<Mission>;

  async list(filters: {
    status?: MissionStatus;
    organizationId?: number;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Mission[]>;

  async get(missionId: string): Promise<Mission>;

  async update(missionId: string, updates: Partial<Mission>): Promise<Mission>;

  async delete(missionId: string): Promise<void>;

  // Mission Control
  async start(missionId: string): Promise<void>;
  async pause(missionId: string): Promise<void>;
  async resume(missionId: string): Promise<void>;
  async cancel(missionId: string): Promise<void>;
  async retry(missionId: string): Promise<void>;

  // Mission Inspection
  async logs(missionId: string, options: {
    tail?: number;
    follow?: boolean;
    since?: Date;
  }): Promise<MissionLog[]>;

  async status(missionId: string): Promise<MissionStatus>;

  async history(missionId: string): Promise<MissionRun[]>;

  async compare(runId1: string, runId2: string): Promise<ComparisonResult>;

  // Bulk Operations
  async bulkCreate(configs: MissionConfig[]): Promise<BulkResult>;
  async bulkPause(filters: MissionFilter): Promise<BulkResult>;
  async bulkResume(filters: MissionFilter): Promise<BulkResult>;
  async bulkCancel(filters: MissionFilter): Promise<BulkResult>;

  // Export/Import
  async export(missionId: string, format: "json" | "yaml"): Promise<string>;
  async import(data: string, format: "json" | "yaml"): Promise<Mission>;

  // Validation
  async validate(config: MissionConfig): Promise<ValidationResult>;
  async dryRun(config: MissionConfig): Promise<DryRunResult>;
}
```

#### Command Interface

```bash
# Mission CRUD
oddjob mission create \
  --prompt "Investigate the database connection timeout issue" \
  --context organizationId=1,userId=user-123 \
  --config mode=plan,requireApproval=true

oddjob mission list \
  --status running \
  --organization 1 \
  --limit 10 \
  --format table

oddjob mission get <mission-id> \
  --format json

oddjob mission update <mission-id> \
  --priority high \
  --tags urgent,database

oddjob mission delete <mission-id> \
  --confirm

# Mission Control
oddjob mission start <mission-id>
oddjob mission pause <mission-id>
oddjob mission resume <mission-id>
oddjob mission cancel <mission-id> \
  --reason "No longer needed"
oddjob mission retry <mission-id>

# Mission Inspection
oddjob mission logs <mission-id> \
  --tail 100 \
  --follow

oddjob mission status <mission-id>

oddjob mission history <mission-id> \
  --limit 5

oddjob mission compare <run-id-1> <run-id-2>

# Bulk Operations
oddjob mission bulk-pause \
  --status running \
  --organization 1

oddjob mission bulk-resume \
  --status paused \
  --tag urgent

oddjob mission bulk-cancel \
  --status failed \
  --older-than 24h

# Export/Import
oddjob mission export <mission-id> \
  --format json \
  --output mission.json

oddjob mission import mission.json \
  --format json

# Validation
oddjob mission validate mission-config.json

oddjob mission dry-run mission-config.json
```

#### Configuration Files

```yaml
# oddjob.config.yaml
cli:
  apiUrl: http://localhost:5000
  apiKey: ${ODDJOB_API_KEY}
  defaultOrganization: 1
  defaultFormat: table

missions:
  defaultMode: plan
  defaultPriority: normal
  requireApproval: true
  timeout: 3600

output:
  color: true
  timestamp: true
  logLevel: info
```

```json
// mission-config.json
{
  "prompt": "Investigate the database connection timeout issue",
  "context": {
    "organizationId": 1,
    "userId": "user-123",
    "mode": "plan"
  },
  "config": {
    "priority": "high",
    "tags": ["urgent", "database"],
    "requireApproval": true,
    "knowledgeAttachments": [
      {
        "type": "topic",
        "id": "database-policies"
      }
    ]
  }
}
```

### CI/CD Integration

#### GitHub Actions Example

```yaml
# .github/workflows/mission-test.yml
name: Mission Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-missions:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install Oddjob CLI
        run: npm install -g @oddjob/cli
      
      - name: Start Dev Stack
        run: oddjob dev up --services postgres redis qdrant
      
      - name: Run Migrations
        run: oddjob dev migrate
      
      - name: Seed Knowledge Store
        run: oddjob seed knowledge ./fixtures/knowledge
      
      - name: Run Mission Tests
        run: oddjob test suite ./fixtures/missions
      
      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test-results/
```

#### Jenkins Pipeline Example

```groovy
// Jenkinsfile
pipeline {
    agent any
    
    environment {
        ODDJOB_API_URL = 'http://localhost:5000'
        GEMINI_API_KEY = credentials('gemini-api-key')
    }
    
    stages {
        stage('Setup') {
            steps {
                sh 'git checkout'
                sh 'npm install'
                sh 'npm install -g @oddjob/cli'
            }
        }
        
        stage('Start Stack') {
            steps {
                sh 'oddjob dev up'
                sh 'oddjob dev migrate'
            }
        }
        
        stage('Seed Knowledge') {
            steps {
                sh 'oddjob seed knowledge ./fixtures/knowledge'
            }
        }
        
        stage('Test Missions') {
            steps {
                sh 'oddjob test suite ./fixtures/missions --format json > results.json'
            }
        }
        
        stage('Validate Results') {
            steps {
                script {
                    def results = readJSON file: 'results.json'
                    if (results.failed > 0) {
                        error("Mission tests failed: ${results.failed} failures")
                    }
                }
            }
        }
    }
    
    post {
        always {
            sh 'oddjob dev down'
        }
    }
}
```

### Implementation Phases

#### Phase 1: Local Dev Stack (Weeks 1-6)

**Goal:** Basic Docker Compose stack with hot reload

**Deliverables:**
- Docker Compose configuration for all services
- Development Dockerfiles for server and client
- Hot reload configuration
- Basic CLI commands (up, down, logs, status)
- Database migration runner

**Success Criteria:**
- Can start full stack with `oddjob dev up`
- Changes to server/client code reflect immediately
- Can view logs from all services
- Database migrations run automatically

#### Phase 2: Testing Framework (Weeks 7-10)

**Goal:** Mission testing with fixtures and knowledge seeding

**Deliverables:**
- Mission test runner
- Fixture format and loader
- Knowledge store seeder
- Assertion framework
- Test result reporting

**Success Criteria:**
- Can run single mission test with fixture
- Can seed knowledge store from config/directory
- Assertions validate mission outcomes
- Test results include pass/fail status and details

#### Phase 3: Mission CLI (Weeks 11-14)

**Goal:** Full mission management from CLI

**Deliverables:**
- Mission CRUD commands
- Mission control commands (start, pause, resume, cancel)
- Mission inspection commands (logs, status, history)
- Bulk operations
- Export/import functionality

**Success Criteria:**
- Can create, list, get, update, delete missions
- Can control mission execution
- Can view mission logs and status
- Can perform bulk operations on missions

#### Phase 4: CI/CD Integration (Weeks 15-16)

**Goal:** Production-ready CI/CD integration

**Deliverables:**
- CI/CD examples (GitHub Actions, Jenkins)
- Configuration file support
- Validation and dry-run commands
- Test result artifacts
- Documentation and examples

**Success Criteria:**
- Can run mission tests in CI/CD pipeline
- Can validate mission configurations
- Can export test results as artifacts
- Documentation covers common CI/CD scenarios

## Success Metrics

### Adoption Metrics
- Number of developers using local dev stack
- Frequency of local development sessions
- Number of mission tests created
- CLI command usage frequency

### Quality Metrics
- Test pass rate for mission tests
- Time to run full test suite
- Number of bugs caught by local testing vs production
- Developer satisfaction with DX tools

### Productivity Metrics
- Time from idea to working mission (local vs production)
- Number of missions created via CLI vs UI
- CI/CD pipeline success rate
- Developer onboarding time reduction

## Security & Privacy

### API Authentication
- CLI uses API keys for authentication
- API keys stored securely in OS keychain
- Support for environment variables and config files

### Data Isolation
- Local stack uses isolated databases
- Test fixtures use test organizations
- Knowledge seeding respects organization boundaries

### Audit Trail
- CLI commands logged for audit purposes
- Mission actions tracked with user attribution
- Bulk operations require confirmation

## Dependencies

### Internal Dependencies
- Oddjob Server (for API endpoints)
- Oddjob Client (for local development)
- Knowledge Store (for seeding)
- Mission Service (for management)

### External Dependencies
- Docker & Docker Compose (for local stack)
- Node.js (for CLI runtime)
- Commander.js (for CLI framework)
- Chalk (for CLI output formatting)
- Inquirer.js (for interactive prompts)

## Open Questions

1. **CLI Distribution**: Should CLI be distributed via npm, Homebrew, or both?
2. **Configuration Management**: Should support multiple configuration profiles?
3. **Test Parallelization**: Should mission tests run in parallel?
4. **Remote Debugging**: Should support remote debugging of production missions?
5. **Secrets Management**: How should CLI handle secrets for CI/CD?

## Future Enhancements

1. **GUI Wrapper**: Electron-based GUI for local development
2. **Mission Recorder**: Record UI actions to generate mission fixtures
3. **Performance Profiling**: Profile mission execution locally
4. **Mission Diff**: Visual diff between mission runs
5. **Template Generator**: Generate mission templates from examples
