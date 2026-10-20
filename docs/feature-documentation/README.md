# Oddjob Feature Documentation

This directory collects feature workflows, UI behavior, and implementation references. Start with the [documentation index](../README.md) for installation and a first mission. Individual references may describe different stages of the implementation; check prerequisites, maturity notes, and the current code before relying on a behavior. **Technical specifications** (routes, API, schemas) are maintained in [`docs/specs/`](../specs/).

## **Documentation Purpose**

- **Feature Preservation**: Ensure all current functionality is maintained during refactoring
- **Reference Guide**: Complete understanding of existing implementation
- **Testing Foundation**: Basis for validation tests post-refactoring
- **Knowledge Transfer**: Enable team members to understand complex interactions

## **Specs vs Feature Docs**

| Source | Content |
|--------|---------|
| **Specs** (`docs/specs/`) | Routes, API endpoints, config schemas, data models |
| **Feature Docs** (this folder) | Component hierarchy, user flows, integration points, error handling |

For API and data-model references, see the [specs directory](../specs/); verify routes against their current implementation.

## **Documentation Standards**

Each feature document follows a standardized structure covering:
1. Feature Overview & Business Value
2. User Interface & Interactions
3. API Endpoints & Data Flow
4. Component Architecture
5. Integration Points
6. Error Handling & Edge Cases
7. Performance Considerations
8. Security & Permissions

## **Feature Areas**

### **Core Features**
- [01-jobs-system.md](./core-features/01-jobs-system.md) - Job creation, configuration, execution → JOB_TYPES_SPEC
- [02-pipelines-system.md](./core-features/02-pipelines-system.md) - Pipeline creation, execution, management
- [03-knowledge-system.md](./core-features/03-knowledge-system.md) - Knowledge store, RAG, documents
- [04-scheduling-system.md](./core-features/04-scheduling-system.md) - Schedules, cron, scheduled jobs → SCHEDULES_SPEC
- [05-missions-system.md](./core-features/05-missions-system.md) - Missions, blackboard, checkpoints, resume conditions → MISSIONS_SPEC
- [06-worker-architecture.md](./core-features/06-worker-architecture.md) - BullMQ worker types, entrypoints, horizontal scaling, queue health
- [07-openapi-auth-introspection.md](./core-features/07-openapi-auth-introspection.md) - OpenAPI securitySchemes introspection for Bearer/Basic/ApiKey/OAuth2
- [08-template-instantiation.md](./core-features/08-template-instantiation.md) - Template gallery, parameter substitution, one-click pipeline deployment, MCP tools
- [signal-studio.md](./signal-studio.md) - Signal Studio: Layer 0 event harvesting, universal ingress webhooks, visual JSONPath schema mapping, spatial Uber H3 telemetry, and modular industry packs

### **Integration Features**
- Authentication, users, and permissions — dedicated feature guide planned; see [security boundaries](../SECURITY_BOUNDARIES.md).
- Credentials and API keys — see [keys and credentials](../developer-guides/KEYS_AND_CREDENTIALS.md).
- Decision Inbox and human-in-the-loop — see [governance guides](../platform/03-human-in-the-loop-governance/).
- [08-agentmail.md](./integration-features/08-agentmail.md) - AgentMail connector: inbound/outbound email, HIL approvals by reply, MCP tools
- 09-notifications-system.md - Alerts and notifications *(Planned)*
- [10-confluence-gdrive-sync.md](./integration-features/10-confluence-gdrive-sync.md) - Confluence full pagination, Google Drive fix, configurable caps
- [Dynamic SaaS schemas](./integration-features/11-dynamic-saas-schemas.md)
- [Live HTTP connector](./integration-features/12-live-http-connector.md)

### **Admin Features**
- [09-admin-dashboard.md](./admin-features/09-admin-dashboard.md) - Admin interface and controls
- 10-system-monitoring.md - Observability → OBSERVABILITY_SPEC *(Planned — spec exists)*
- 11-audit-logging.md - Audit trails *(Planned)*
- 12-organization-mgmt.md - Multi-tenancy *(Planned)*

### **Additional Feature Areas** (Specs Available)
- **Platform features index** → [features/README](../features/README.md) — Evolution Engine, Transference Engine, mission intelligence, reliability systems
- **SaaS** → SaaS_INTEGRATIONS_SPEC — Connectors, sync, workflows
- **Forms** → FORMS_SPEC — Form Builder, form-driven agents
- **Decision Inbox** → HUMAN_APPROVAL_SPEC, HIL_2_ACCOUNTABILITY_SPEC — HIL approvals, Shadow Diff, Edit & Approve
- **Predictive AI** → PREDICTIVE_AI_SPEC — Failure prediction, monitoring
- **Agent Analytics** → AGENT_MEMORY_ANALYTICS_SPEC — Agent memory, analytics
- **AI Agent Enhancements** → AI_AGENT_ENHANCEMENTS_SPEC — Memory sharing, tool recommendations, confidence, streaming plans, fallback | Feature Doc
- **Transference Engine** → [TRANSFERENCE_ENGINE](../features/TRANSFERENCE_ENGINE.md) — Shadow-to-active LLM call replacement via local Python handlers (TE-101)
- **Workgroups** → WORKGROUPS_SPEC — Workgroups, missions, pre-creation dependency validation
- **MCP** → MCP_SPEC — Model Context Protocol tokens
- **Public Agent** → PUBLIC_AGENT_SPEC — Agent deployment (`/a/:slug`)
- **Forensic Analysis** → FORENSIC_ANALYSIS_SPEC — Pipeline run comparison
- **Template Gallery** → TEMPLATE_GALLERY_SPEC — Templates, wizard

### **Vertical Apps & Cycle Blueprints**
- [cycle-blueprint-builder.md](./cycle-blueprint-builder.md) - Visual Cycle authoring across Timeline, Flow, and Data with governed apps, Form Agents, pipeline outputs, readiness, and runtime recovery.
- [copilot-cycle-operations.md](./copilot-cycle-operations.md) - Contextual Cycle assistance, dependency recommendations, approvals, updates, and governed notification policy.
- [budgetmaster-sawm.md](./budgetmaster-sawm.md) - BudgetMaster (Sovereign Algorithmic Wealth Matrix): personal-finance cycle blueprint (10 datasets, 3 agents, 4 HIL forms, 7 missions, 6 schedules) + Workbench and Advisor apps → [Cycle YAML](../../server/cycles/budgetmaster.cycle.yaml)

### **Technical Foundations**
- 13-api-architecture.md - API design and endpoints *(Planned)*
- 14-frontend-components.md - Component architecture *(Planned)*
- 15-state-management.md - Data flow and state *(Planned)*
- 16-security-model.md - Security and permissions *(Planned)*

### **Documentation Status**
- Linked entries above have dedicated feature documents.
- Entries marked **Planned** describe documentation still to be written, not a guarantee about feature availability.
- See [blueprint maturity](../guides/blueprint-maturity.md) for template readiness and limitations.
- **Archive/Proposals**: Historical; may not reflect current implementation. See [docs/archive](../archive/) and [docs/proposals](../proposals/) for archived designs.

## **Usage During Refactoring**

1. **Before Changes**: Review feature documentation to understand all requirements
2. **During Development**: Reference specific integration points and error cases
3. **After Implementation**: Use as checklist to verify all functionality works
4. **Testing**: Create test cases based on documented behaviors

## **Version Control**

- Update a feature reference alongside behavior or prerequisite changes.
- Use Git history for prior versions; put superseded designs in the archive or history directories.
- Keep proposed behavior clearly labeled until its runtime path is implemented and verified.

---

**Maintenance**: Treat these as feature references, not release certification. The [system architecture](../SYSTEM_ARCHITECTURE.md) explains runtime boundaries and the [contribution guide](../../CONTRIBUTING.md) defines verification.
