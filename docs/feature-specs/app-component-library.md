# App Component Library

**Feature ID:** `app-component-library`  
**Pillar:** Forge  
**Maturity Target:** Foundation → Maturing  
**Addresses Hardening Focus:** "template gallery for repeatable demos"  

## Overview

The App Component Library is a curated collection of reusable UI components, patterns, and blueprints that accelerate the App Forge workflow. It provides teams with pre-built, tested components for common operational patterns, reducing the time from concept to deployed internal app.

### Positioning

For teams using App Forge to generate internal tools, the Component Library provides:

- **Reusable UI Components**: Pre-built form layouts, data tables, approval workflows, status dashboards
- **Operational Patterns**: Domain-specific blueprints (DevOps, Security, Finance, Support)
- **Template Gallery**: Repeatable demo configurations that showcase Oddjob capabilities
- **Version Control**: Track component evolution and enable safe rollbacks

### Buyer Value

"Instead of starting from a blank canvas every time, teams can assemble internal apps from proven components that match their operational domain, reducing development time and ensuring consistency across the organization."

## User Stories

### As a Forge User
- I want to browse a gallery of pre-built components so I can quickly find what I need for my app
- I want to preview components before using them so I understand their behavior
- I want to filter components by domain (DevOps, Security, Finance) so I find relevant options
- I want to see component usage examples so I know how to integrate them

### As a Forge Developer
- I want to contribute custom components to the library so my team can reuse them
- I want to version my components so I can iterate safely
- I want to see usage analytics for my components so I understand their adoption
- I want to test components in isolation before publishing so I ensure quality

### As an Administrator
- I want to approve components before they're available to the organization so I maintain quality standards
- I want to set component visibility (org-wide, team-specific) so I control access
- I want to audit component usage so I understand what's being built
- I want to deprecate components gracefully so I can phase out outdated patterns

## Technical Architecture

### Component Model

```typescript
interface ComponentLibraryItem {
  id: string;
  name: string;
  description: string;
  category: ComponentCategory;
  domain: ComponentDomain;
  version: string;
  status: "draft" | "pending_review" | "approved" | "deprecated";
  
  // Component definition
  definition: ComponentDefinition;
  
  // Metadata
  author: {
    userId: string;
    organizationId: number;
    createdAt: Date;
    updatedAt: Date;
  };
  
  // Governance
  visibility: "private" | "team" | "organization" | "public";
  approvalStatus?: {
    approvedBy: string;
    approvedAt: Date;
    comments?: string;
  };
  
  // Usage analytics
  usage: {
    totalUses: number;
    lastUsedAt?: Date;
    organizations: number;
  };
  
  // Dependencies
  dependencies?: string[]; // IDs of other components this depends on
}

type ComponentCategory = 
  | "ui_component"      // Reusable UI elements (buttons, forms, tables)
  | "layout_pattern"    // Page layouts (dashboard, detail view, list view)
  | "workflow"          // Multi-step workflows (approval, review, onboarding)
  | "data_integration"  // Data source connectors (API, database, webhook)
  | "blueprint"         // Complete app blueprints for specific domains;

type ComponentDomain =
  | "general"
  | "devops"
  | "security"
  | "finance"
  | "support"
  | "hr"
  | "sales"
  | "custom";

interface ComponentDefinition {
  // UI components
  ui?: {
    framework: "react" | "vue" | "svelte";
    code: string; // Component source code
    props: ComponentProp[];
    slots?: ComponentSlot[];
    examples: ComponentExample[];
  };
  
  // Layout patterns
  layout?: {
    structure: LayoutStructure;
    configurableAreas: ConfigurableArea[];
    responsiveBehavior: ResponsiveBehavior;
  };
  
  // Workflows
  workflow?: {
    steps: WorkflowStep[];
    transitions: WorkflowTransition[];
    approvalGates: ApprovalGate[];
    dataFlow: DataFlowDefinition;
  };
  
  // Data integrations
  integration?: {
    type: "api" | "database" | "webhook" | "file";
    schema: IntegrationSchema;
    authentication: AuthConfig;
    rateLimits?: RateLimitConfig;
  };
  
  // Blueprints
  blueprint?: {
    appStructure: AppStructure;
    defaultPages: PageDefinition[];
    dataModels: DataModel[];
    missions: MissionTemplate[];
  };
}
```

### Storage Model

Components are stored in the database with the following schema:

```sql
CREATE TABLE component_library_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  domain VARCHAR(50) NOT NULL DEFAULT 'general',
  version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  
  -- Component definition (JSONB)
  definition JSONB NOT NULL,
  
  -- Authorship
  author_user_id UUID NOT NULL,
  organization_id INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Governance
  visibility VARCHAR(50) NOT NULL DEFAULT 'private',
  approval_status JSONB,
  
  -- Usage analytics
  total_uses INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  organization_count INTEGER DEFAULT 0,
  
  -- Dependencies
  dependencies TEXT[], -- Array of component IDs
  
  -- Indexes
  CONSTRAINT fk_author FOREIGN KEY (author_user_id) REFERENCES users(id),
  CONSTRAINT fk_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE INDEX idx_component_library_category ON component_library_items(category);
CREATE INDEX idx_component_library_domain ON component_library_items(domain);
CREATE INDEX idx_component_library_status ON component_library_items(status);
CREATE INDEX idx_component_library_visibility ON component_library_items(visibility);
CREATE INDEX idx_component_library_org ON component_library_items(organization_id);
```

### API Design

#### Component CRUD

```typescript
// List components
GET /api/component-library
Query params:
  - category?: ComponentCategory
  - domain?: ComponentDomain
  - status?: string
  - visibility?: string
  - search?: string
  - page?: number
  - limit?: number

Response: {
  items: ComponentLibraryItem[];
  total: number;
  page: number;
  limit: number;
}

// Get single component
GET /api/component-library/:id
Response: ComponentLibraryItem

// Create component
POST /api/component-library
Body: {
  name: string;
  description: string;
  category: ComponentCategory;
  domain: ComponentDomain;
  definition: ComponentDefinition;
  visibility?: string;
}
Response: ComponentLibraryItem

// Update component
PATCH /api/component-library/:id
Body: Partial<{
  name: string;
  description: string;
  definition: ComponentDefinition;
  visibility: string;
}>
Response: ComponentLibraryItem

// Delete component
DELETE /api/component-library/:id
Response: { success: true }
```

#### Component Governance

```typescript
// Submit for approval
POST /api/component-library/:id/submit-for-review
Response: ComponentLibraryItem

// Approve component
POST /api/component-library/:id/approve
Body: {
  comments?: string;
}
Response: ComponentLibraryItem

// Reject component
POST /api/component-library/:id/reject
Body: {
  comments: string;
}
Response: ComponentLibraryItem

// Deprecate component
POST /api/component-library/:id/deprecate
Body: {
  reason: string;
  replacementComponentId?: string;
}
Response: ComponentLibraryItem
```

#### Component Usage

```typescript
// Record component usage (internal API, called by Forge)
POST /api/component-library/:id/usage
Body: {
  appId?: number; // If used in an app
  missionId?: string; // If used in a mission
  context: Record<string, any>;
}
Response: { success: true }

// Get component usage analytics
GET /api/component-library/:id/analytics
Response: {
  totalUses: number;
  usesByTime: { date: string; count: number }[];
  usesByOrganization: { orgId: number; orgName: string; count: number }[];
  topApps: { appId: number; appName: string; count: number }[];
}
```

#### Component Preview

```typescript
// Generate component preview
POST /api/component-library/:id/preview
Body: {
  props?: Record<string, any>;
  theme?: string;
}
Response: {
  html: string;
  css: string;
  js: string;
}

// Get component examples
GET /api/component-library/:id/examples
Response: ComponentExample[]
```

### UI/UX Design

#### Component Gallery

**Location:** `/forge/components`

**Layout:**
- Left sidebar: Category and domain filters
- Main area: Grid of component cards
- Top bar: Search, sort, view toggle (grid/list)

**Component Card:**
- Thumbnail preview
- Component name and description
- Domain badge
- Version and status indicators
- Usage count
- Author info
- Action buttons: Preview, Use, Favorite

**Filter Options:**
- Category: UI Components, Layout Patterns, Workflows, Data Integrations, Blueprints
- Domain: General, DevOps, Security, Finance, Support, HR, Sales, Custom
- Status: All, Approved, Draft, Pending Review
- Visibility: My Components, Team, Organization, Public

#### Component Detail View

**Sections:**
1. **Header**: Name, description, version, status, author
2. **Preview**: Interactive component preview with configurable props
3. **Code**: Source code viewer with syntax highlighting
4. **Documentation**: Usage guide, props reference, examples
5. **Version History**: List of versions with changelog
6. **Usage Analytics**: Charts showing usage over time, by organization
7. **Dependencies**: List of dependent components
8. **Related Components**: Similar components suggestions

#### Component Editor

**For component authors:**

- **Code Editor**: Monaco-based editor with syntax highlighting
- **Props Editor**: Visual editor for component props
- **Preview Panel**: Live preview with prop controls
- **Validation**: Real-time linting and type checking
- **Version Control**: Create new versions, view diff
- **Publish Flow**: Submit for review, add comments

#### Integration with App Forge

**In the Forge planning phase:**
- Suggest components based on natural language description
- Show component gallery alongside generated code
- Allow component selection before generation

**In the Forge builder phase:**
- Drag-and-drop components onto canvas
- Configure component props visually
- See component dependencies and conflicts

**In the Forge QA phase:**
- Validate component usage against best practices
- Check for deprecated components
- Suggest component updates

## Implementation Phases

### Phase 1: Foundation (Weeks 1-4)

**Goal:** Basic component storage and retrieval

**Deliverables:**
- Database schema for component library
- CRUD API endpoints
- Basic component gallery UI
- Component detail view
- Component preview endpoint

**Success Criteria:**
- Can create, view, and delete components
- Component gallery renders with filtering
- Preview endpoint returns renderable HTML/CSS/JS

### Phase 2: Governance & Versioning (Weeks 5-8)

**Goal:** Approval workflow and version control

**Deliverables:**
- Approval workflow (submit, approve, reject)
- Component versioning
- Visibility controls (private, team, org, public)
- Component deprecation flow
- Audit log for component changes

**Success Criteria:**
- Components require approval before org-wide visibility
- Can view component history and restore previous versions
- Deprecated components show warning but remain usable

### Phase 3: Forge Integration (Weeks 9-12)

**Goal:** Deep integration with App Forge workflow

**Deliverables:**
- Component suggestions in Forge planning
- Component gallery in Forge builder
- Drag-and-drop component placement
- Component validation in Forge QA
- Usage tracking from Forge

**Success Criteria:**
- Forge suggests relevant components based on app description
- Can drag components onto Forge canvas
- QA validates component usage and suggests improvements

### Phase 4: Advanced Features (Weeks 13-16)

**Goal:** Analytics, marketplace, and advanced patterns

**Deliverables:**
- Component usage analytics dashboard
- Component marketplace (public components)
- Blueprint templates for domains
- Workflow components with approval gates
- Data integration components

**Success Criteria:**
- Can view component usage analytics
- Can browse and use public marketplace components
- Domain-specific blueprints available (DevOps, Security, Finance)

## Pre-Built Component Catalog

### UI Components

**Form Components:**
- `ApprovalForm`: Multi-step approval workflow with comments
- `DataEntryForm`: Validated data entry with field-level validation
- `FilterPanel`: Collapsible filter panel for data tables
- `SearchBar`: Debounced search with suggestions

**Data Display:**
- `DataTable`: Sortable, filterable data table with pagination
- `StatusBadge`: Color-coded status indicators
- `Timeline`: Vertical timeline for events/history
- `MetricCard`: Key metric display with trend indicator

**Layout Components:**
- `DashboardLayout`: 3-column dashboard with sidebar
- `DetailViewLayout`: Master-detail view with sidebar navigation
- `SplitView`: Resizable split-pane layout
- `EmptyState`: Empty state with call-to-action

### Layout Patterns

**Page Templates:**
- `ListPage`: Standard list page with filters, table, pagination
- `DetailPage`: Detail view with header, tabs, related items
- `CreatePage`: Form-based create page with validation
- `EditPage`: Edit page with change tracking

**Workflows:**
- `ApprovalWorkflow`: Multi-step approval with parallel/sequential gates
- `ReviewWorkflow`: Document review with comments and revisions
- `OnboardingWorkflow`: Multi-step onboarding with progress tracking

### Domain-Specific Blueprints

**DevOps:**
- `DeploymentDashboard`: Deployment status and history
- `IncidentResponsePage`: Incident triage and resolution tracking
- `ServiceHealthPage`: Service health metrics and alerts

**Security:**
- `VulnerabilityReportPage`: Security vulnerability tracking
- `AccessRequestPage`: Access request and approval workflow
- `AuditLogPage`: Audit log viewer with filters

**Finance:**
- `ExpenseReportPage`: Expense submission and approval
- `BudgetTrackerPage`: Budget tracking with variance analysis
- `InvoiceProcessingPage`: Invoice processing workflow

**Support:**
- `TicketQueuePage`: Support ticket queue with SLA tracking
- `KnowledgeBasePage`: Knowledge base article management
- `CustomerProfilePage`: Customer 360 view with interaction history

## Success Metrics

### Adoption Metrics
- Number of components created per organization
- Component usage rate (components used per app built)
- Time-to-app reduction (before vs after component library)
- Component reuse rate (same component used across multiple apps)

### Quality Metrics
- Component approval rate (submitted vs approved)
- Component deprecation rate (components deprecated over time)
- Bug rate for component-based apps vs custom apps
- User satisfaction with components (rating system)

### Governance Metrics
- Average time from submission to approval
- Number of components by visibility level
- Component usage by domain (which domains are most active)
- Marketplace component adoption rate

## Security & Privacy

### Access Control
- Component visibility respects organization boundaries
- Private components only visible to author
- Team components visible to team members
- Organization components visible to all org members
- Public components visible to all users

### Code Safety
- Component code is sandboxed during preview
- No arbitrary code execution in component definitions
- Component dependencies are validated for security
- Rate limiting on component preview endpoint

### Audit Trail
- All component changes logged with user and timestamp
- Approval decisions recorded with rationale
- Component usage tracked for audit purposes
- Deprecation events logged with reason

## Dependencies

### Internal Dependencies
- App Forge (for integration)
- Knowledge Store (for component documentation)
- Approval Routes (for governance)
- User/Organization services (for access control)

### External Dependencies
- Monaco Editor (for code editing)
- React/Vue/Svelte (for component rendering)
- Chart.js (for analytics visualization)
- Marked (for markdown rendering in docs)

## Open Questions

1. **Component Pricing**: Should public marketplace components have pricing?
2. **Component Certification**: Should there be a "certified" badge for high-quality components?
3. **Component Forking**: Should users be able to fork and modify public components?
4. **Component Testing**: Should components require automated tests before approval?
5. **Component Localization**: Should components support i18n out of the box?

## Future Enhancements

1. **AI-Powered Component Suggestions**: Use ML to suggest components based on app context
2. **Component Composition**: Allow nesting components to create complex patterns
3. **Component Marketplace**: External component marketplace with revenue sharing
4. **Component Testing Framework**: Automated testing for components
5. **Component Migration Tools**: Tools to migrate apps when components are deprecated
