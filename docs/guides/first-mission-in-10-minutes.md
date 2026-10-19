# First Mission In 10 Minutes

This walkthrough is the first evaluator path for Oddjob's governed agentic operations story.

The goal is not to show every subsystem. The goal is to prove the core promise quickly:

```text
Oddjob can turn an operational request into governed, replayable work.
```

## Before You Start

Use a development organization with:

- one authenticated user,
- Knowledge Store available,
- approvals enabled,
- and Trycua enabled if you want to run the computer-use demo.

Validate the product capability manifest:

```bash
npm run smoke:capabilities
```

Execute the seeded golden-path contract:

```bash
npm run smoke:golden-path
```

This deterministic contract check validates the seeded fixture and re-evaluates the
shared autonomy policy, confirming that the external commitment in the scenario still
classifies as `review` at `high` risk with the required policy flag. It is a genuine
regression guard on the governance model.

It needs no production credentials because it does not execute a mission. The approval
record, timeline, and replay evidence it prints are derived from the fixture, not from a
live run. Use `npm run smoke:golden-path:fixture` when you only need to validate
fixture structure.

To see a governed mission run end to end, follow Path A below.

For an automated, database-backed execution of Path A, run:

```bash
npm run demo:golden-path
```

Unlike the smoke check, this command writes isolated demo data to the configured
development database. It creates a mission and run, stores and reads grounding
documents, opens an approval request, pauses and resumes the run, completes it, and
reads the checkpoint timeline back from the database. It refuses to run when
`NODE_ENV=production`. Remove its mission data with
`npm run demo:golden-path -- --cleanup`.

## Path A: Governed Support Triage

Use this when showing Oddjob to operations, support, or AI transformation teams.

### Setup

1. Add a short support policy document to Knowledge Store.
2. Use the seeded fixture at `fixtures/golden-path/governed-support-triage.json` or create a support issue fixture:

```text
Customer cannot complete payment after three retries. They ask whether support can manually retry the transaction.
```

3. Create a governed mission:

```text
Classify this support issue, retrieve relevant policy, propose the safest response, and request approval before sending anything externally.
```

### Expected Outcome

- The mission identifies the issue class.
- The result cites the support policy source.
- The proposed external response pauses for approval.
- The timeline shows the agent proposal and the human decision.

### Success Criteria

- First mission created in under 10 minutes.
- Approval decision is visible.
- The user can explain why the agent did not act autonomously.

## Path B: Computer Use With Replay

Use this when showing GUI automation with governance.

### Setup

1. Enable Trycua for the organization.
2. Create a Trycua session.
3. Create a computer-use task with confirmation required:

```http
POST /api/integrations/trycua/computer-use/tasks
```

Example intent:

```json
{
  "sessionId": "<session-id>",
  "task": "Click the safe test target after confirmation",
  "action": "click",
  "target": { "x": 120, "y": 180, "label": "safe test target" },
  "requireConfirmation": true
}
```

4. Confirm or reject the task:

```http
POST /api/integrations/trycua/computer-use/tasks/<task-id>/confirm
```

### Expected Outcome

- The task starts in a reviewable state before execution.
- The proposed action is recorded.
- Confirmation executes the action.
- Verification observation is stored.
- Replay shows the step trail.

### Success Criteria

- Replay contains observation, plan, action result, and verification.
- Sensitive text is redacted.
- Rejection cancels the task without executing.

## Path C: Generate An Internal Ops App

Use this when showing the App Forge wedge.

### Setup

Create an App Forge request:

```text
Build a small internal request portal for support escalations with status, priority, owner, notes, and approval history.
```

### Expected Outcome

- Forge produces a development plan.
- The generated app has a usable first screen.
- QA and publish readiness are visible before deployment.

### Success Criteria

- The app can be inspected before publish.
- The publish step is governed.
- QA results are visible to the evaluator.

## What To Avoid In The First Demo

- Do not start with prediction intelligence.
- Do not explain every internal pod.
- Do not lead with architecture diagrams.
- Do not require production credentials.

The first demo should feel like:

```text
I gave Oddjob work. It grounded itself, proposed safe action, waited when needed, and left an audit trail.
```
