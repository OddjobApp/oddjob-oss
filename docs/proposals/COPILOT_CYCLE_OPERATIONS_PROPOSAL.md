# Copilot for Cycles and Missions

**Status:** Builder integration delivered; advanced proposal automation and live external delivery remain follow-on work  
**Owner:** Product, Operations, and AI Platform  
**Scope:** Cycles, missions, pipeline outputs, Workbench apps, and Form Agents

## Decision

Make Oddjob Copilot the contextual operational partner for a Cycle. Copilot will propose and explain work, dependencies, updates, and recovery actions. It will never silently change executable behavior, authorize access, stage a Cycle, activate a Cycle, or send an external update.

Form Agents, Workbench apps, and pipeline outputs are first-class dependency sources. A Cycle phase must show the resulting typed mapping in the builder, regardless of whether Copilot or a person created it.

## Problem

Cycles orchestrate work across missions, apps, human decisions, and pipelines. Today, authors must know where each dependency is created and manually reconstruct that context. Operators receive raw execution signals rather than a decision-ready explanation of what changed, what is blocked, and what to do next.

## Product outcome

An author can describe an outcome such as “run a weekly account-risk review,” and Copilot can produce a reviewed Cycle draft that:

- uses an intake Form Agent for account context;
- maps the submission into a research or scoring phase;
- uses a Workbench app for an operator review;
- triggers or consumes pipeline outputs;
- inserts an approval milestone when a governed decision is needed;
- produces role-appropriate updates while it runs.

## User experience

### Design-time Copilot

Within the Cycle Builder, Copilot provides contextual suggestions, not a parallel configuration model.

| Context | Copilot action | Author control |
|---|---|---|
| Empty Cycle | Propose phases, groups, dependencies, and success criteria | Accept all, accept individual changes, or edit manually |
| Selected phase | Recommend Form Agents, Workbench apps, pipeline outputs, agent capabilities, and required fields | Explicitly map a source to a phase input |
| Missing input | Explain the gap and propose an existing source or a new Form Agent | Approve the proposed dependency |
| Milestone | Propose an approval form, evidence requirements, and decision audience | Confirm gate behavior and policy |
| Invalid draft | Explain structural problems and offer a safe repair plan | Apply each repair explicitly |

The builder has a compact **Copilot: collect an input** panel when a phase is selected. It lists matching Form Agents with the target phase, required fields, and a **Map input** action. The same card pattern applies to Workbench apps and pipeline artifacts.

### Staging-time Copilot

Before staging, Copilot produces a readiness brief:

```text
Ready: 8 of 10 dependencies resolved
Needs action: connect Customer Review app; select Sales dataset
Governance: one approval Form Agent required before Publish
Impact: Publish cannot start until approval submission validates
```

It must cite each source mapping and distinguish a missing configuration from a runtime value that will be collected later.

### Run-time Copilot

Copilot turns mission and Cycle events into structured updates:

| Audience | Content |
|---|---|
| Operator | Phase progress, blockers, late dependencies, retries, cost, and next action |
| Approver | Decision summary, evidence, selected Form Agent, impact of each outcome |
| Stakeholder | Plain-language outcome, progress, risks, decisions needed, and links |
| Executive | Objective, completion, material risk, forecast, and requested decision |

Updates appear in the Cycle timeline and Copilot Updates view. Delivery to Slack, email, or another external surface is governed by a notification policy or explicit approval.

### Offline-owner notification policy

If the assigned Cycle owner is unavailable, the update policy may route a material update to their configured **Slack** destination or **AgentMail** address. Delivery is based on an explicit escalation policy, not inferred presence alone.

```text
Cycle event → severity and policy evaluation → owner is unavailable
  → Slack direct message or channel alert
  → AgentMail summary when Slack is unavailable or policy requires email
  → escalation contact after the configured acknowledgement window
```

Each policy defines allowed event types, severity threshold, quiet hours, delivery order, acknowledgement window, escalation recipient, and whether the message contains a deep link only or a summary with evidence. Slack and AgentMail connections must be configured and authorized for the organization before they can be selected. Copilot drafts the update; the policy determines whether delivery is automatic or approval-gated.

### Retrospective Copilot

At Cycle completion, Copilot compares expected and actual duration, spend, quality, and dependency waits. It proposes a new builder draft rather than editing the completed or active Cycle.

## Dependency contract

Each dependency has an explicit source and target.

```text
Form Agent submission  ─┐
Workbench app output    ├─> Cycle phase input ─> Mission execution
Pipeline output         ┘
```

The canonical Cycle builder resource model supports these types:

- `form_agent`
- `workbench_app`
- `pipeline_output`

An executable phase may additionally define an **app step**: the Workbench app to open, invoke headlessly, or review for output before the phase can complete. This is distinct from consuming an app's output as a resource.

Each binding contains a provider and stable external reference. A data edge maps the resource to a named phase input. The mapping, not Copilot prose, is the executable source of truth.

## Copilot request contract

Every Copilot request from the builder includes only the minimum contextual data:

- Cycle objective, phase summary, selected phase, and current validation state;
- available dependency metadata (name, ID, fields/outputs, access readiness);
- unresolved inputs and existing mappings;
- current organization scope and relevant policy flags.

Never include secret values, credential material, form submission answers not needed for the task, or unrestricted organization data.

Copilot responds with a typed proposal:

```ts
type CycleCopilotProposal = {
  summary: string;
  suggestions: Array<{
    kind: "form_agent" | "workbench_app" | "pipeline_output" | "phase" | "dependency" | "update";
    rationale: string;
    targetPhaseId?: string;
    proposedMapping?: unknown;
    confidence: number;
    risks?: string[];
  }>;
};
```

Only an explicit user action applies a proposed mapping.

## Safety and governance

- Copilot is advisory by default.
- Mapping a dependency requires author confirmation.
- Credential selection and permission elevation occur in staging with existing authorization checks.
- Staging and activation remain explicit user actions.
- Generated external updates require notification-policy permission or user approval.
- Every applied Copilot proposal records source, timestamp, prompt summary, model configuration, and before/after mapping for audit.

## Implementation plan

### Delivered in this increment

- Extended the canonical Cycle resource schema with `form_agent`, `workbench_app`, and `pipeline_output` types.
- Added Cycle Builder logic to discover available Form Agents through `/api/form-agents`.
- Added typed mapping behavior: a selected Form Agent creates a resource, phase input, and data edge in the persisted builder draft.
- Added a contextual Copilot request payload for dependency recommendations and mapping review.
- Added a canonical, governed notification-policy contract for offline-owner escalation through Slack and AgentMail.
- Rendered Form Agent, Workbench app, and pipeline-output mapping surfaces in the Data view.
- Added published Workbench deployment and pipeline-output catalogs.
- Added organization-scoped optimistic draft persistence and exact-revision readiness.
- Added App Forge publishing return with automatic governed app binding and readiness rerun.
- Added runtime Workbench app steps, Cycle Manager completion controls, durable output persistence, dependency resumption, and worker-start recovery.

### Next increment

1. Add a typed AI proposal endpoint backed by the selected Copilot engine.
2. Add structural before/after diff review and proposal audit records.
3. Add an in-product Copilot Updates inbox with acknowledgement state.
4. Verify governed Slack and AgentMail delivery using valid organization credentials.
5. Add post-run retrospective proposals and sanitized template creation.

### Later increment

1. Add multi-user collaboration and review comments.
2. Add policy-aware simulation, failure injection, and cost forecasting.
3. Add reusable nested Cycle patterns and organization template sharing.

## Success measures

- Time from a Cycle objective to a valid draft.
- Percent of required inputs resolved before staging.
- Percent of Copilot proposals accepted, modified, or rejected.
- Time spent blocked on missing human input.
- Update usefulness rating by operators and stakeholders.
- Zero unapproved dependency, credential, staging, activation, or external-message changes.
