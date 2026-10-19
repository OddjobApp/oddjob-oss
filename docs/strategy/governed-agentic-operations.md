# Governed Agentic Operations

Oddjob should lead with one category:

```text
Governed Agentic Operations Engine
```

Oddjob plans, executes, governs, replays, and improves autonomous work across agents, tools, generated apps, knowledge, and computer-use sessions.

## Positioning

For technical operations teams that need agents to do real work safely, Oddjob is the system of record for governed autonomous work.

Oddjob is not best introduced as:

- a generic chatbot,
- a simple no-code automation builder,
- a single-model agent demo,
- or an RPA-only desktop recorder.

Lead with:

- durable missions,
- human approvals,
- replayable actions,
- generated internal apps,
- knowledge-grounded execution,
- and computer-use fallback when APIs are unavailable.

## Buyer-Facing Pillars

### Missions

Long-running autonomous work. Missions turn messy operational goals into trackable work units that can pause, resume, delegate, and report progress.

### Forge

Generated internal apps. Forge creates the durable interfaces that recurring operational work needs.

### Knowledge

Grounded memory and context. Knowledge gives missions and agents trusted source material, reusable memory, and graph context.

### Control

Governance, approval, replay, and computer use. Control makes autonomous work inspectable and safe.

## First Three Demos

### Governed Support Triage

Shows that Oddjob can handle a real operational queue without letting agents act recklessly.

The demo should create a mission, retrieve support policy context, propose an external response, and pause for approval.

### Generate An Internal Ops App

Shows that Oddjob can create the app needed to operate recurring work.

The demo should generate a small internal console, run validation, and expose deployment readiness.

### Computer Use With Replay

Shows that Oddjob can operate GUI software when no API exists.

The demo should create a Trycua computer-use task, propose an action, wait for confirmation, execute, verify, and store replay steps.

## Operating Rule

Every new capability should answer at least one of these questions:

- Does it help Oddjob complete longer-running work?
- Does it make autonomous action safer?
- Does it improve replay, audit, or explainability?
- Does it help convert recurring work into a durable app?
- Does it improve grounding from organizational knowledge?

If not, it is probably a distraction from the category.

## Machine-Readable Source

The canonical capability manifest lives in:

```text
shared/product/oddjob-capability-manifest.ts
```

The authenticated API surface is:

```text
GET /api/system/capabilities
```

Validate it with:

```bash
npm run smoke:capabilities
```
