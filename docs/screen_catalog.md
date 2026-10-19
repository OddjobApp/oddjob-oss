# Oddjob Screen Catalog & Functional Guide

This document catalogs every user interface in Oddjob, detailing its route, purpose, core components, and functional logic.

---

## 🔐 1. Authentication Layer
**Purpose**: Identity management, security, and onboarding.

````carousel
### Login & Signup (`/auth/login`, `/auth/signup`)
**Functional Goal**: Authenticate users and establish an HTTP-only secure session.
- **Component**: `AuthPage.tsx`
- **Key UI Elements**:
    - **Mode Toggle**: Switches between "Welcome Back" and "Join Oddjob" with smooth transitions.
    - **Form Layer**: Validates credentials via `LoginForm` or `SignupForm`.
    - **Success Redirect**: Automatically pushes users to `/dashboard` upon successful `auth/user` population.

<!-- slide -->

### Recovery Flow (`/auth/forgot-password`, `/auth/reset-password`)
**Functional Goal**: Securely restore access for users who lost their credentials.
- **Components**: `ForgotPassword.tsx`, `ResetPassword.tsx`
- **Logic**:
    - **forgot-password**: Triggers an SMTP event to the user's registered email with a one-time reset link.
    - **reset-password**: Validates the `token` from the URL and allows setting a new password via the `passwordService`.
````

---

## 📊 2. Dashboard & Monitoring
**Purpose**: Real-time observability of costs, alerts, and system status.

````carousel
### Main Dashboard (`/dashboard`)
**Functional Goal**: Provide a 10,000ft view of the agentic workforce.
- **Component**: `DashboardPage.tsx`
- **Key UI Elements**:
    - **Metric Cards**: Displaying active missions, total costs, and success rates.
    - **Event Streams**: Live list of the most recent system activities.
    - **Quick Actions**: "New Mission", "Run Pipeline", and "View Alerts".

<!-- slide -->

### Insights, Cost & ROI Analytics (`/insights`, `/insights/costs`, `/insights/roi`)
**Functional Goal**: Financial transparency and optimization.
- **Component**: `CostDashboard.tsx`, `ROIAnalytics.tsx`
- **Key UI Elements**:
    - **Spending Trends**: Recharts-based area charts showing daily cost fluctuations.
    - **Organization Breakdown**: Costs grouped by department or sub-organization.
    - **Optimization Suggestions**: AI-driven insights on where to reduce agent overhead.
````

---

## 🚀 3. Missions (Operations)
**Purpose**: High-level task orchestration and lifecycle management.

````carousel
### Missions List (`/missions`)
**Functional Goal**: Manage and monitor the entire queue of agentic workgroups.
- **Component**: `MissionsPage.tsx`
- **Key UI Elements**:
    - **Mission Table**: Sortable list of all missions with `StatusBadge` indicators.
    - **Filter Bar**: Multi-select filters for state (Running, Success, Failed) and priority.

<!-- slide -->

### Create Mission (`/missions/new`)
**Functional Goal**: Configure and launch a new workgroup mission.
- **Component**: `CreateMission.tsx`
- **Logic**:
    - **Configuration Wizard**: Collects mission goals, strategy selections, and tool access requirements.
    - **Resource Validation**: Ensures the selected organization has sufficient credits/permissions before launch.

<!-- slide -->

### Mission Run Detail (`/missions/:id/runs/:runId`)
**Functional Goal**: Deep-dive into an individual execution attempt.
- **Component**: `MissionRunDetail.tsx` (117KB)
- **Key UI Elements**:
    - **Log Streamer**: Near-real-time streaming of agent logs and tool calls.
    - **Outcome Visualizer**: Detailed breakdown of the mission's findings or final deliverables.
    - **Forensic Logs**: Advanced debugging for failed steps.
````

---

## 🏗️ 4. Pipelines (Procedural)
**Purpose**: Visual workflow design and precise execution monitoring.

````carousel
### Pipeline Editor (`/pipelines/:id`)
**Functional Goal**: Design complex agentic procedures using a node-based graph.
- **Component**: `PipelineEditor.tsx`
- **Key UI Elements**:
    - **ReactFlow Canvas**: Drag-and-drop workspace for connecting task nodes.
    - **Node Palette**: List of available tools, LLM prompts, and data transformations.
    - **Properties Panel**: Configuring the internal parameters of the selected node.

<!-- slide -->

### Template Gallery & Wizard (`/templates`, `/templates/:id/wizard`)
**Functional Goal**: Quickly instantiate proven workflow patterns.
- **Components**: `TemplateGallery.tsx`, `TemplateWizard.tsx`
- **Key UI Elements**:
    - **Blueprint Cards**: Categorized templates with success ratings and "Cost estimates".
    - **Step-by-Step Setup**: Guided configuration of required variables and environment secrets.

<!-- slide -->

### Executions & Forensics (`/pipelines/:id/executions`, `/knowledge/compare-runs`)
**Functional Goal**: Monitor efficiency and debug failures at scale.
- **Components**: `PipelineExecutions.tsx`, `ForensicAnalysis.tsx`
- **Logic**:
    - **Execution History**: Table of completion states, durations, and costs.
    - **Forensic Comparison**: Side-by-side diff of input/output tokens to identify drift or hallucinations.
````

---

## 🧠 5. Knowledge (Semantic)
**Purpose**: Exploring the "Living Memory" of the agentic organization.

````carousel
### Knowledge Graph (`/knowledge/graph`)
**Functional Goal**: Interactively navigate the relationships between entities.
- **Component**: `KnowledgeGraph.tsx`
- **Key UI Elements**:
    - **Vis-Network Canvas**: Explodable clusters of agents, documents, and tool associations.
    - **Entity Inspector**: Right-sidebar displaying metadata and "Recent Context" for the selected node.

<!-- slide -->

### Knowledge Garden (`/knowledge/garden`)
**Functional Goal**: Browse and search the full repository of ingested documents.
- **Component**: `KnowledgeGarden.tsx`
- **Key UI Elements**:
    - **Source Explorer**: Hierarchical folder view of all RAG sources.
    - **Context Preview**: Text-snippet view showing exactly what the agents are "reading" during missions.

<!-- slide -->

### Dataset Manager (`/datasets`, `/knowledge/datasets`)
**Functional Goal**: Curate data for fine-tuning and model evaluation.
- **Component**: `DatasetManager.tsx`, `FineTuningDatasets.tsx`
- **Key UI Elements**:
    - **Sample List**: High-quality (Agent -> Tool) response pairs.
    - **Export Tools**: Formats for OpenAI, HuggingFace, and custom internal executors.
````

---

## 🛠️ 6. Administration & Platform
**Purpose**: Managing multi-tenancy, credentials, and users.

````carousel
### Organization Management (`/admin/organizations`)
**Functional Goal**: Configure billing, permissions, and structure for a workspace.
- **Component**: `OrganizationsPage.tsx`
- **Key UI Elements**:
    - **Quota Monitor**: Real-time bars for token/credit usage.
    - **Member List**: Invitations, roles (Admin/User), and activity history.

<!-- slide -->

### Credential Registry (`/credentials`)
**Functional Goal**: Securely store and rotate API keys for external tools.
- **Component**: `Credentials.tsx`, `CredentialNew.tsx`
- **Security**: Ensures keys are hashed and only decrypted at the last moment of execution.
- **UI**: List of providers with "Health status" indicators (valid/invalid keys).

<!-- slide -->

### Audit & Events (`/events`, `/observability`)
**Functional Goal**: Forensic logging for security and compliance.
- **Component**: `AuditLog.tsx`, `EventLog.tsx`
- **Key UI Elements**:
    - **Immutable Stream**: List of all destructive actions (Deletes, Config changes).
    - **Trace Visualizer**: Connecting an event back to the user or mission that triggered it.
````

---

## 🚀 7. Specialized AI & Integrated Ecosystem
**Purpose**: Predictive intelligence and external service orchestration.

````carousel
### Predictive Dashboard (`/insights/prediction/dashboard`)
**Functional Goal**: Use historical data to forecast mission outcomes and resource needs.
- **Component**: `PredictiveDashboard.tsx`
- **Key UI Elements**:
    - **Outcome Probabilities**: Percentage-based success forecasts for queued missions.
    - **Resource Optimization**: Suggestions for scaling agent concurrency based on predicted load.

<!-- slide -->

### SaaS Connectors (`/saas`)
**Functional Goal**: Bridge the gap between internal agents and external 3rd-party tools.
- **Component**: `ConnectorsDashboard.tsx`
- **Key UI Elements**:
    - **Integration Cards**: One-click setup for Slack, Discord, JIRA, and GitHub.
    - **Webhook Manager**: Real-time event logging for incoming SaaS signals.
````

---

## ⚖️ 8. Governance & Compliance
**Purpose**: Establishing boundaries and safety protocols for autonomous agents.

````carousel
### Policy Manager (`/governance`)
**Functional Goal**: Define global "Guardrails" that agents cannot violate.
- **Component**: `PolicyManager.tsx`
- **Logic**:
    - **Rule Definition**: Writing declarative policies (e.g., "Max cost per mission: $5.00").
    - **Enforcement Level**: Toggling between "Audit Only" and "Hard Block".

<!-- slide -->

### Policy Visualizer (`/governance/visualizer`)
**Functional Goal**: Observe policy enforcement in context.
- **Component**: `OverrideVisualizer.tsx`
- **Key UI Elements**:
    - **Conflict Map**: Highlighting missions that were paused due to safety constraints.
    - **Human-in-the-Loop (HIL)**: Interface for manual overrides of blocked actions.

<!-- slide -->

### Board Room & Executive Governance (`/governance/board-room`)
**Functional Goal**: High-level approval for mission-critical and high-cost agentic plans.
- **Component**: `BoardRoom.tsx`
- **Key UI Elements**:
    - **Executive Summary**: AI-generated briefing on mission risk and projected ROI.
    - **Budget Gate**: Visual indicator of token salary usage vs. allowance.
    - **Strategic Intervention**: Tools for humans to "Veto" or "Pivot" an agent's strategy mid-mission.
````

---

## 📋 9. Forms & App Marketplace
**Purpose**: Building custom interactive interfaces and deploying pre-packaged solutions.

````carousel
### Form Builder (`/dashboard/forms/builder`)
**Functional Goal**: Create data-collection interfaces for human-agent interaction.
- **Component**: `FormsBuilder.tsx`
- **Key UI Elements**:
    - **Field Palette**: Drag-and-drop inputs, dropdowns, and file uploads.
    - **Logic Canvas**: Connecting form submissions to specific backend mission triggers.

<!-- slide -->

### App Marketplace (`/apps`)
**Functional Goal**: Deploy end-to-end "Oddjob Apps" with one click.
- **Component**: `AppMarketplace.tsx`
- **Key UI Elements**:
    - **Solution Categories**: "Security Scanners", "Content Engines", "Data Analysts".
    - **One-Click Deploy**: Automatic provisioning of required credentials and missions.
````

---

## 🧭 10. Platform Assembly & Guided Walkthroughs
**Purpose**: Component blueprint exploration, rapid interactive onboarding, and global guided navigation across the 5 S.C.O.R.E. dimensions.

````carousel
### Assembly Style Gallery (`/platform-maintenance/components`)
**Functional Goal**: Explore, search, and live-test indexed UI components and assembly blueprints.
- **Component**: `ComponentStyleGallery.tsx`
- **Key UI Elements**:
    - **Component Search & Category Filter**: Live filtering across 208+ indexed React components.
    - **Live Component Preview with Error Boundary**: Isolated sandbox rendering of design system blocks.
    - **Interactive "Live Demo" Action**: Matches canonical tutorial snippets and launches an in-place walkthrough spotlight.
    - **Copy Blueprint Action**: Copies verified code snippet directly to clipboard.

<!-- slide -->

### Interactive Guided Tours (`TutorialHost.tsx`, `TutorialBubble.tsx`)
**Functional Goal**: On-screen step-by-step guidance highlighting active operational elements.
- **Components**: `TutorialHost.tsx`, `TutorialBubble.tsx`, `tutorial-engine.ts`
- **Key UI Elements**:
    - **Spotlight Anchored Bubble**: Auto-flipping, boundary-clamped tooltip targeting `data-tour` / `@behavior` nodes.
    - **Keyboard Accelerator Badges**: `<kbd>⌘K</kbd>` and `<kbd>⌘J</kbd>` badges indicating shortcut triggers.
    - **Pro-Tip Hint Callout**: Actionable hints with amber visual accents explaining control manipulation.
    - **Specs & Gallery Deep-Links**: Direct links to architectural markdown documentation and Component Style Gallery.
    - **URL Auto-Launcher**: Supports `?tutorial=<trackId>` deep-linking with clean `history.replaceState` removal.

<!-- slide -->

### Global Command Palette (`CommandPalette.tsx`, `⌘K`)
**Functional Goal**: Instant navigation, action execution, and guided tour initiation.
- **Component**: `CommandPalette.tsx`
- **Key UI Elements**:
    - **Guided Walkthroughs & Demos Group**: Direct launch for S.C.O.R.E. briefing, Developer App Forge, Spatial Operator, Operator Flight Deck, Enterprise Architect, Builder Pod Mastery, and Full Platform Immersion.
    - **Quick Actions & System Routing**: Keyboard-first access to any screen, app, or tool.
````

---

