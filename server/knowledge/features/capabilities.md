# Capabilities: Model, Catalog, and Lifecycle

## Overview

A capability is a versioned, machine-readable contract for a discrete outcome that Oddjob can perform. It describes the outcome independently of the agents, apps, jobs, tools, connectors, models, and infrastructure used to implement it. The Capabilities domain is intended to make those outcomes discoverable, composable, governable, measurable, and releasable throughout their lifecycle.

For example, **Extract structured invoice rows from a PDF** is a capability. OCR, document parsing, an extraction agent, an output schema, and approval policies are implementation details and dependencies of that capability.

This document defines the deeper product model for capabilities and distinguishes it from the currently implemented synchronization foundation.

## Capability versus implementation

A capability answers **what outcome can the platform produce?** An implementation answers **how is that outcome produced?**

| Concept | Meaning | Example |
| --- | --- | --- |
| Capability | Stable, invocable outcome contract | Extract invoice rows |
| Agent | Reasoning actor that may provide a capability | Accounts Payable Agent |
| Tool | Atomic operation used by an implementation | PDF text extraction |
| Job or workflow | Orchestration of one or more capabilities | Process supplier invoice |
| App | User-facing experience that exposes capabilities | Invoice Operations Console |
| Connector | External-system integration | NetSuite |
| Policy | Authorization or constraint applied at invocation | Approval required above $10,000 |

A capability may have multiple implementations. An agent, app, or workflow may provide multiple capabilities. Capability identity therefore must not be derived from a particular implementation.

## Capability hierarchy

Capabilities compose from atomic operations into higher-order business outcomes.

```text
Process supplier invoice
|- Read document
|- Extract invoice fields
|- Validate supplier
|- Detect duplicate invoice
|- Request approval
`- Post approved invoice to accounting system
```

The catalog should represent these relationships explicitly so discovery can return either an atomic capability or a complete outcome. Composition edges should express requirements such as `depends_on`, `composes`, `implemented_by`, `exposed_by`, `governed_by`, and `evaluated_by`.

## Capability contract

Every capability has a stable `capability_id`, an independently versioned manifest schema, and a semantic capability version.

### Identity and ownership

- Stable identifier and display name
- Category and description
- Owning team or accountable individual
- Lifecycle state and support tier
- Tags, aliases, and business vocabulary

### Invocation contract

- Typed input schema, required fields, defaults, and examples
- Typed output schema and examples
- Preconditions and invocation constraints
- Supported synchronous, asynchronous, or streaming modes
- Idempotency and retry expectations
- Compatibility guarantees

### Implementation mapping

- Providing agents, jobs, workflows, tools, apps, and connectors
- Deployment or runtime environment
- Required models, credentials, datasets, and services
- Dependency and composition relationships
- Fallback or alternative implementations

### Governance and safety

- Risk profile
- Required roles, permissions, and organization policies
- Guardrails and prohibited uses
- Human approval or review requirements
- Data classification, retention, and residency constraints
- Audit requirements and expected side effects

### Operational characteristics

- Availability and deployment state
- Health of required dependencies
- Expected latency, throughput, and cost
- Reliability and quality objectives
- Rate limits and concurrency constraints
- Known limitations and failure modes

### Evidence and provenance

- Source manifest and implementation locations
- Generated documentation and content fingerprint
- Tests, evaluation suites, and evaluation runs
- Invocation volume, success rate, latency, and cost
- Policy decisions and approvals
- Change-register entries and releases

## Current manifest schema

The synchronization foundation currently validates these fields:

- `schema_version`: version of the manifest contract; currently `1`.
- `capability_version`: semantic version of externally observable behavior.
- `capability_id`: stable lowercase identifier.
- `metadata`: display name, category, description, and owner.
- `technical_spec`: typed input and output maps.
- `documentation_meta`: summary, business use cases, and guardrails.
- `runtime_context`: risk profile, execution environment, and dependencies.

Legacy manifests without explicit version fields normalize to schema `1` and capability version `1.0.0`.

The richer implementation, governance, operational, evidence, and relationship fields described above are the target catalog model. They must be introduced through future schema versions rather than inserted into schema `1` payloads, which are strictly validated.

## Capability catalog

The primary Capabilities experience should be a catalog of individual outcome contracts, not only architectural documentation about the Capabilities module.

The catalog should support:

- Search by natural language, identifier, owner, category, implementation, and business outcome
- Filters for lifecycle state, readiness, risk, environment, organization, and version
- Grouping by domain, business process, and composition hierarchy
- Coverage counts for defined, implemented, deployed, authorized, healthy, and evaluated capabilities
- Comparison of implementations and versions
- Direct navigation to evidence, changes, and releases

Each catalog entry should present a concise readiness summary: what it does, its current version, who owns it, what implements it, where it is available, whether the caller is authorized, and whether evidence supports production use.

## Capability profile

An individual capability profile should contain:

1. **Overview** - purpose, owner, category, lifecycle state, version, and supported use cases.
2. **Contract** - input/output schemas, examples, preconditions, side effects, and compatibility.
3. **Implementations** - agents, tools, jobs, apps, connectors, models, and runtime environments.
4. **Composition** - upstream requirements, downstream consumers, and higher-order outcomes.
5. **Governance** - permissions, policies, risk, guardrails, approvals, and audit behavior.
6. **Operations** - availability, deployments, dependency health, latency, reliability, cost, and limits.
7. **Evidence** - tests, evaluations, invocation metrics, incidents, and known failure modes.
8. **History** - manifest revisions, semantic versions, documentation changes, and releases.

## Readiness model

Readiness is multi-dimensional. A single `active` flag cannot explain whether a capability is actually usable.

| Dimension | Question |
| --- | --- |
| Defined | Does a valid capability contract exist? |
| Implemented | Is at least one implementation mapped to the contract? |
| Deployed | Is an implementation available in the target environment? |
| Authorized | May the current organization and actor invoke it? |
| Healthy | Are the implementation and dependencies operational? |
| Evaluated | Has it met the required quality and safety thresholds? |
| Released | Is this version included in a published platform release? |

The UI should expose each dimension and derive an overall readiness result with explicit reasons. Examples include `Ready`, `Review required`, `Dependency unavailable`, `Missing evaluation`, `Unauthorized`, and `Deprecated`.

## Lifecycle

A capability progresses through explicit lifecycle states:

```text
Proposed -> Defined -> Implemented -> Evaluated -> Released -> Deprecated -> Retired
```

- **Proposed**: an identified platform need without a validated contract.
- **Defined**: a validated manifest exists.
- **Implemented**: at least one implementation satisfies the contract.
- **Evaluated**: required functional, quality, and safety evaluations pass.
- **Released**: a version is included in published release notes and is available to its intended consumers.
- **Deprecated**: consumers should migrate to a replacement or later version.
- **Retired**: the capability is no longer invocable.

High- and Critical-risk transitions require explicit review. Lifecycle transitions should be auditable and organization-scoped.

## Versioning

`schema_version` versions the shape of the manifest. `capability_version` versions externally observable capability behavior. Internal `revision` records every applied synchronization change.

Semantic version guidance:

- **Major**: incompatible input/output behavior, removed behavior, or materially changed safety guarantees.
- **Minor**: backward-compatible new behavior, optional inputs, additional outputs, or new supported use cases.
- **Patch**: compatible fixes, reliability improvements, or documentation corrections with no contract break.

A release should reference exact capability versions. Capability changes should remain traceable from manifest revision to change-register entry and published platform release.

## Discovery and selection

Discovery should combine semantic relevance with operational eligibility. A capability is not a valid routing candidate merely because its description matches a request.

Selection should consider:

- Input and output compatibility
- Actor and organization authorization
- Risk and approval requirements
- Deployment and dependency health
- Evaluation status and observed reliability
- Cost and latency constraints
- Version compatibility
- Preferred and fallback implementations

Discovery results should explain why a capability matched and why it is or is not currently invocable.

## Gap analysis

The catalog should continuously identify incomplete or contradictory states:

- Required business outcomes with no defined capability
- Manifests with no mapped implementation
- Implementations with no capability manifest
- Deployed capabilities without passing evaluations
- Capabilities blocked by policy, credentials, or unhealthy dependencies
- Duplicate or substantially overlapping capabilities
- Deprecated versions with active consumers
- Behavioral changes without an appropriate semantic-version increment
- Released capability versions whose documentation or evidence is stale

These gaps should appear as actionable findings with an owner, severity, evidence, and recommended remediation.

## Evolution-driven capability discovery

Evolution converts repeated unmet outcomes and reliability signals into durable, organization-scoped capability proposals. A proposal is explicitly non-executable and cannot appear as an available capability until an authorized reviewer promotes it.

The proposal lifecycle is:

```text
Evolution evidence -> Proposed -> Promoted
                                `-> Rejected
```

Every proposal records its classification (`missing`, `enhancement`, `composition`, or `retirement`), confidence, source evidence, similar registered capabilities, rationale, reviewer, and optional draft manifest. Promotion validates the manifest and runs it through the existing code-to-documentation pipeline, which generates documentation, updates semantic discovery, publishes a change-register entry, and commits synchronization state.

The current Evolution discovery pass converts Sentinel reliability candidates into idempotent enhancement proposals. Knowledge synthesis, tool coverage, mission repetition, learning failures, and successful compositions can submit evidence through the same proposal API.

Relevant API operations:

- `GET /api/evolution/capability-proposals`: list organization-scoped proposals.
- `POST /api/evolution/capability-proposals/discover`: scan Evolution signals and create or update proposals.
- `POST /api/evolution/capability-proposals`: submit a proposal from another evidence producer.
- `POST /api/evolution/capability-proposals/:id/promote`: approve and promote a valid manifest.
- `POST /api/evolution/capability-proposals/:id/reject`: reject with a required review note.

Copilot and MCP expose proposals through `discover_capability_proposals`, separately from `discover_capabilities`, and label them `not_executable_pending_review`.

## Synchronization foundation implemented today

The current Capabilities domain provides the management foundation for the broader model:

### Code to documentation

`POST /api/capabilities/sync/code-to-docs` validates a manifest, detects behavioral or documentation drift, compiles Markdown, writes the capability document, refreshes semantic discovery, publishes a Documentation change, and commits synchronization state.

### Documentation to registry

`POST /api/capabilities/sync/docs-to-code` ingests Markdown beneath the configured capability documentation root. Files outside that root and non-Markdown files are rejected. High- and Critical-risk documentation-authored changes return `review_required` and are not activated automatically.

### Status

`GET /api/capabilities/sync/status` returns capability version, schema version, internal revision, source, risk profile, hashes, and last update time for the current organization.

### Change classification

- `new`: no prior synchronization state exists.
- `behavioral`: inputs, outputs, guardrails, risk, category, or execution environment changed.
- `documentation`: descriptive content, ownership, use cases, dependencies, schema version, or capability version changed without behavioral drift.
- `none`: behavioral and complete content hashes match.

Behavioral and documentation changes refresh generated documentation and semantic discovery. Only identical content is skipped.

### Change register and releases

Applied capability changes are published to the Documentation change register with capability version and internal revision. Release drafts can include those entries. Publishing requires a unique semantic release version.

### Security and configuration

Mutation endpoints require organization-admin or super-admin access. Documentation ingestion resolves symlinks and confines reads to `ACDD_DOCS_SUBDIR`. Automatic triggers and Git writes are disabled by default and configured through the `ACDD_*` variables in `.env.example`.

### Presentation Crew & Document Layout Engine
- **4-Agent Creative Pipeline (`orchestrateCreativeCrew`)**: Information Architect (block AST sculpting), Data Storyteller (card grid & metric extraction), Art Director (theme & image synthesis), and Brand Guardian (WCAG contrast & HIL gate enforcement).
- **Supported Formats**: Presentation Decks (`presentation_deck`), Executive Briefs (`executive_brief`), Technical Whitepapers (`whitepaper`), and Promotional Media (`magazine_ad`).

### CREW Room Group Intelligence
- **Consensus Metrics Engine (`calculateConsensusMetrics`)**: Turn-by-turn semantic consensus and agreement scoring with conflict phrase detection and convergence threshold checks.
- **Belief State Extraction (`extractBeliefState`)**: Real-time extraction of verified facts, active hypotheses, and open operational constraints across agent turns.
- **Speaker Triage & Anti-Repetition**: Token-based agent relevance matching combined with containment-based restatement scoring to eliminate redundant turns.

### Causal Spatial Decision Intelligence
- **Composite Impact Evaluation (`evaluateCausalSpatialImpact`)**: Combines sector/jurisdiction business asset matching with Uber H3 spatial hex overlaps to calculate enterprise blast radius scores and severity multipliers (Critical: 3.0x, High: 2.0x, Medium: 1.5x).
- **Automated Mitigation Actions**: Escalates critical events to human-in-the-loop review and isolates affected dependent operational cycles.

### Canary Health Monitoring & Automated Rollback
- **Canary Health Evaluation (`evaluateCanaryHealth`)**: Monitors error rates and p99 latency SLOs during staging deployments.
- **Zero-Downtime Rollback State Machine (`enforceCanaryGate`)**: Executes automatic rollbacks to prior developmental stages if error rate exceeds 5% or latency breaches 1500ms.

### Autonomous Delta Snapshots
- **Content-Addressed Hashing (`computeContentHash`)**: Deterministic SHA-256 state fingerprinting.
- **Structured Delta Compression (`computeDeltaSnapshot`)**: Key-level JSON diffing yielding >75% storage savings.
- **Portable Migration Bundles (`createPortableBundle`, `importPortableBundle`)**: Verifiable cross-environment state migration with cryptographic checksums.

### Task Learning & Autonomous Skill Parameterization Engine
- **Universal Execution Step Normalization (`adaptGenericStepsToRecordedSteps`, `createSkillFromSteps`)**: Converts heterogeneous agent action streams (`goto`, `click`, `type`, `press`, `wait`, `select`) into sanitized `RecordedStep` sequences with zero-leak secret redaction (passwords, OTPs, payments).
- **Bi-directional Knowledge Garden Bridge (`curateNavigationalGuide`, `findNavigationalGuide`)**: Bridges human demonstrations and agent-learned skills directly into the enterprise knowledge graph, allowing subsequent RAG and navigational routing to recall active skills before falling back to manual exploration.
- **In-Chat Teach-a-Task Flow (`/teach`)**: Exposes slash-command driven recording initiation directly in CREW Chat (`CrewComposer.tsx`), dispatching `oddjob:open-teach-task` to mount the live desktop in Teach Mode without administrative friction.
- **Visual CAPTCHA & 2FA HIL Challenge Solver**: Resolves SWOT W7 by rendering visual security challenge screenshots inline within `InlineApprovalCard.tsx`, capturing user solutions, and injecting `{ solution }` into `modifiedOutput` on approval.
- **Socratic Parameter Ambiguity Engine (`GoodQuestionEngine.synthesizeSkillParameterQuestion`)**: Computes variable entropy $\Delta H$ based on goal token overlap, semantic target attributes, and input types. Automatically converts high-confidence inputs ($\Delta H \le 0.60$) into `{{variable}}` templates, and synthesizes interactive FormAgent UI cards for ambiguous candidates ($\Delta H > 0.60$).
- **Runtime Dynamic Zod Schema Compiler (`buildRuntimeInputSchema`)**: Dynamically compiles and enforces typed runtime validation schemas with automatic coercion for numeric, date, and string skill inputs prior to Playwright replay.

## Delivery boundary

The current release implements manifest validation, bidirectional synchronization, semantic indexing, drift detection, documentation generation, organization-scoped state, review gating, change-register publication, release-note integration, CREW Room belief telemetry, causal-spatial decision intelligence, canary health rollbacks, autonomous delta snapshots, and task learning with Socratic parameterization.

The catalog UI, expanded schema, implementation mapping, capability graph, multi-dimensional readiness, evidence aggregation, lifecycle transitions, and automated gap analysis remain product capabilities to build. This document is the governing specification for that deeper layer.
