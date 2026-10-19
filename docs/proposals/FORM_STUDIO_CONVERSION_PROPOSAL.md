# Form Studio Conversion Plan

**Status**: Proposal (revision 2)
**Date**: 2026-09-11
**Branch surveyed**: `refactor/crew-round-context`
**Reference pattern**: the App Forge → App Studio conversion (commit `9adc6e6a6` onward)

Revision 2 adds:
- the authoring workflow (§5);
- multi-page forms and results pages (§6);
- where forms run: stages across cycles, HIL in CREW and the copilot, published agents, instant
  apps, and Project Spaces (§7);
- a renumbered merge sequence (§8);
- the blast radius: every writer, reader, parallel form system and frozen built-app copy, with the
  plan changes and decisions it adds (§12).

---

## 1. Summary

**Goal.** Turn Form Builder into a CREW **Form Studio**. It authors and runs complex forms and form
workflows derived from knowledge-base documents. The benchmark is three specs: executive
succession, conversational compliance, and feature beta validation. Each has typed fields, weighted
scores, hard-stop gates, decision logic with actions, and a sample payload.

**Why this is a merge, not a rewrite.** Oddjob already holds every part, spread across builders
that share no definition, renderer or formula language:
- the Form Studio backend (untracked);
- the form formula engine;
- the calculator builder (`FullStackAssemblyPod`);
- the calculation builder (knowledge-graph calculation nodes);
- pipeline decision nodes and human-approval steps;
- datasets.

**The plan in one sentence.** Make the Form Studio definition the single source of truth, and
`shared/form-expression.ts` the single formula language. Render every form with one renderer, in
every place forms appear. Fold the calculator builder in as Studio's workflow and data layers, and
the calculation builder in as its cross-submission metrics. Route every action through an approval.

---

## 2. Target experience

1. **Mount.** In a CREW room the author asks: *"Build a successor evaluation from the talent
   bench spec."* Form Studio mounts beside the conversation, with the spec attached as a source.
2. **Draft.** The room drafts:
   - stages and pages;
   - fields with types, enums and scales;
   - computed scores and gates;
   - ordered decision rules with their actions;
   - results pages;
   - a test built from the sample payload;
   - an issues list naming what the source leaves undefined or contradicts.
3. **Refine.** The author edits in the Studio, or selects something and asks the room to change it.
   Every change is saved as a revision.
4. **Publish.** A release is created only when tests pass and issues are resolved.
5. **Run in stages.** A cycle runs the form in stages. The candidate completes a self-assessment,
   HR adds data the candidate never sees, and the talent committee reviews the gates. Each stage
   reaches the right person in the Decision Inbox, a CREW room, or an emailed link.
6. **Score and act.** Scores and the decision status update as stages land. Results pages show
   each audience what it may see. Decision actions become approval requests, and an approved
   action starts a pipeline run.
7. **Aggregate.** Cohort figures are calculation nodes over the response dataset. An example is
   the number of "Ready Now" successors for a seat.

---

## 3. Current state (verified 2026-09-11)

| Part | Where | State |
|---|---|---|
| **Forms list** | `modules/forms/pages/Forms.tsx`, `/armory/forms` | Reached only via the Command Palette (`CommandPalette.tsx:481`), the App Forge overview card, and redirects from `/forms` and `/dashboard/forms`; no sidebar entry. Every form shows "Active" because the list doesn't fetch `isArchived`. "Archive" permanently deletes. |
| **Form Builder** | `modules/forms/pages/FormsBuilder.tsx`, `/api/forms` | Saves the whole form with no revision, draft or publish step. Offers 6 of 14 field types. The field editor calls `onUpdate` about every 300 ms per field, even while idle. |
| **Legacy forms API** | `server/routes/hil.ts` | `GET`, `PUT` and `DELETE /api/forms/:id` have no org check. `PUT` writes `req.body` straight into the row. |
| **Form Studio backend** | `shared/form-studio.ts`, `server/domain/pipeline/{core,api}/form-studio.*` | **Untracked.** Nothing calls it, and it has **no list endpoint**. `create` takes only a name. `save` needs the current revision and refuses drafts with structural issues. History is capped at 30 entries inside the row. Publishing returns `/external/forms/:token`, which no router renders. |
| **Formula engine** | `shared/form-expression.ts` | Correct on all three sample payloads. Four defects (Phase 1). |
| **Calculator builder** | `packaged/FullStackAssemblyPod.tsx` | A form → pipeline → dataset → approval model. Its Deploy only posts a chat message, then shows "Deployed to Project" after 600 ms. Its default steps call tools that don't exist. |
| **Calculation builder** | `knowledge/core/calculations/`, `/knowledge/calculations` | Evaluator handles `+ - * / % ^` only. Canvas drops are never saved. |
| **HIL step forms** | `human-approval-executor.ts`, `hil-form-factory.ts`, `ExternalTaskPage.tsx` | A pipeline step shows one whole form (`formId`, or one of 3 hardcoded `HilFormFactory` forms). Answers become that step's output and resume the pipeline. Internal approvers get the Decision Inbox; external ones get an OTP-capable link. |
| **HIL in the copilot and CREW** | `ApprovalDetailDialog.tsx`, `InlineApprovalCard.tsx` | The copilot dialog builds forms on the fly, turns number and email fields into text, and makes every field required. The CREW card can only approve or reject. |
| **Published agents** | `/a/:slug`, `AgentDeploymentPage.tsx` | Markdown replies plus their own `input_request` form (text, number, email, date, location and similar). `FormRenderer` is never loaded there. |
| **Instant-app form block** | `packaged/PlatformFormBlock.tsx` | **Broken everywhere.** It calls `/api/oddjob/forms/:id`: the platform app API keeps forms under `/hil`, not `/forms`, and the chat bridge (`routes.ts:370`) doesn't forward `forms`. |
| **Cycles** | `operational_cycles`, `cycle_blueprints`, `mission_runs` | Missions run in dependency waves; human steps pause missions. Each step's answers are separate, and no response spans steps. |
| **Project Spaces** | `ProjectSpacePage.tsx`, `PROJECT_RESOURCE_TYPES` | 12 tabs, none for forms. `form` is not a project resource type, and forms belong to the whole organization. |

---

## 4. Architecture decisions

**D1: one definition.** `StudioDefinition` version 2:
- **Kept from v1:** fields, pages, reports, sources, issues, tests.
- **New structure:** `stages` (D7), page navigation settings, and field `group`, `scale` and
  `sourceKey`.
- **New logic:** ordered `decisionRules`, typed `actions`, and a response `dataset` binding.
- **New results:** result blocks with an audience (§6).
- **Compatibility:** `fields` stays top-level, so existing readers keep working (HIL steps, the
  instant-app block).

**D2: one authoring language.** Formulas, visibility, gates and decision rules are all
`form-expression`, evaluated by the server with the same code the tests run. Pipelines route on the
evaluated `status`, so authors never write CEL. Calculation nodes adopt the same engine (Phase 7).

**D3: one renderer everywhere.** `StudioRenderer` handles stages, pages, groups, visibility,
computed fields, result blocks, and HTML sanitized with DOMPurify. It serves:
- the Studio preview;
- the public form page;
- the Decision Inbox dialog;
- the CREW stage card;
- the external task page;
- published agents;
- the instant-app form block;
- `render_intake_form`.

**D4: storage.**
- **Definitions** stay as `hil_forms` rows, keeping ids stable.
- **Revisions and releases** move to a `form_studio_revisions` table (D8).
- **Responses** become dataset records carrying a stage ledger, not archived `hil_forms` rows.

**D5: actions are proposals.** Each decision action becomes an approval request. Approval starts
the bound pipeline; rejection is recorded on the response.

**D6: cohort metrics.** Calculation nodes over response datasets, exposed to formulas as read-only
values that carry their row count and as-of time.

**D7: stages and one response per cycle.**
- **What a stage is:** pages, an assignee (role, person or agent), and the earlier answers that
  assignee may see.
- **How responses build:** a response gains one locked stage per submission, and scores and rules
  re-evaluate as each lands.
- **How a cycle runs a stage:** a `human_approval` step carries `{ formId, stageId }`, with the
  response id in the mission context.
- **Fixed questions:** each response keeps the release it started on.

**D8: drafts, revisions and releases.**
- **Revisions.** Every save is a revision. Edits coalesce into one revision per 30 seconds of
  activity; named versions are optional.
- **Drafts.** A draft may be saved with structural issues; only publishing is blocked. Today the
  backend refuses such drafts, which would stop an author mid-formula.
- **Releases.** Publishing creates an immutable release (v1, v2…). Drafts continue past it.

---

## 5. Authoring workflow

### Browse: the Forms library

**Where it lives.** `/armory/forms`, plus a sidebar entry. The same component appears in a Project
Space's Forms tab (§7) and in CREW via `mount_form_studio`.

**Data.** A new `GET /api/form-studio` lists **authored forms only**, never responses or HIL step
instances. It takes filters for project, state, issues and use, plus search.

**Each row shows:**
- name and project;
- state: **Draft**, **Published v3**, or **v3 · draft ahead**;
- last edited (who and when);
- source documents;
- responses;
- stages waiting on someone;
- test and issue status;
- **Used by**: pipeline steps whose `formId` points here, instant apps, and cycles.

**Row actions:**
- Open in Studio.
- Discuss in CREW.
- Duplicate.
- Copy public link.
- View responses.
- Archive, with a confirmation. Archive never deletes; deleting is a separate, admin-only action
  that is refused while the form is in use.

**Legacy forms.** They appear with a **Legacy** badge and open in the Studio through
`asStudioDefinition`. The first save converts them to version 2, and existing pipeline steps keep
working because `fields` stays top-level.

### Create

| Start from | Flow |
|---|---|
| **Blank** | New form → name and project → the Studio opens on Structure with one page |
| **Documents** | New from documents → pick sources (the project's first) and write an instruction → the proposal shows as a diff of stages, pages, fields, scores, rules, results, tests and issues → **Create draft** saves revision 1. Nothing is saved before that. |
| **A conversation** | Ask a CREW room → the Studio mounts → the room's draft arrives as a diff card → **Apply** |
| **An existing form** | Duplicate → a new draft keeping pages, logic and tests, but not releases or responses |

### Edit

**Tabs:**
- **Sources.**
- **Structure:** stages, pages, groups and fields.
- **Logic:** computed fields and decision rules, with a dependency view.
- **Results:** result blocks by audience.
- **Tests.**
- **Preview:** respondent or reviewer, stage by stage.
- **Publish & Responses.**

**Live checks.** Validation and test results update as the author edits, using the same shared
module the server runs.

**Selections.** Selecting a field, page, rule or result sends it to the CREW room with the question
("why is flight risk weighted 15%?").

### Save, undo and conflicts

**Autosave.** Every change saves, coalesced into revisions (D8). The header says **Saved · rev 42**,
**Saving…**, or **Not saved: retrying**. A draft with problems still saves, and the header counts
the issues that block publishing.

**Undo and history.**
- **Undo and redo** follow the revision history. Phase 1 fixes today's two-state flip.
- **History** lists revisions with who, when and a summary, and any revision can be restored as a
  new one.

**Conflicts.** A save made against an old revision is refused (409) and never overwrites. The
author sees what changed, keeps their unsaved edits on top of the latest revision, and resolves
field by field.

**Publishing.**
- **Check first:** Publish runs the tests and issue checks, then lists what the release affects
  (pipeline steps, instant apps, running cycles).
- **Running responses:** they keep the release they started on.
- **Afterwards:** the Studio says **Published v4**, and the library row updates.

---

## 6. Multi-page forms and results pages

### Pages

- **Order.** Pages run in order; `visibleWhen` skips pages that don't apply.
- **Checking.** Each page is checked before moving on, using the shared engine scoped to that page.
  The server checks everything again at submission.
- **Progress.** A progress indicator, back and next, and a review page before submission.
- **Pausing.** Save and resume lets a respondent stop and continue later, from the same link or
  inbox item.
- **Reuse.** The legacy `MultiStepFormWizard.tsx` component is retired: it now serves as a backward-compatible wrapper delegating to `StudioRenderer`, and `FormAgentExecutor.tsx` runs directly on `StudioForm`, providing unified computed fields, strict validation, and multi-page stepper navigation.

### Result blocks

`studio.reports` today is raw HTML with `{{field}}` placeholders. Version 2 replaces it with
structured blocks. Each block binds to fields, shows or hides on answers, is marked **respondent**
or **reviewer**, and can be covered by tests.

| Block | Shows | Example |
|---|---|---|
| **Score** | A value against the spec's bands | Compliance index: 95–100 Fully Compliant, 80–94 Substantially Compliant, 0–79 Flagged |
| **Breakdown** | Dimension scores and weights | Succession: Vision 35% → 93, Talent 25% → 96.05, Resilience 25% → 100 |
| **Status** | The decision outcome and triggered actions | `BINDING_SUSPENDED_REVIEW_REQUIRED`, review approval pending |
| **Gates** | Hard stops, marked pass or fail | Beta: open P0, crash-free below 99.5%, data loss |
| **Grid** | A matrix placement | Succession 9-box |
| **Cohort comparison** | A result against all responses, with row count | Beta PMF ratio against the 40% benchmark and past pilots |
| **Narrative** | Sanitized text with values filled in | A PM's evaluation summary |

**Blocks to reuse:** `PlatformMetricGaugeBlock` and `PlatformStatsCounterBlock` for scores,
`MetricGrid` for breakdowns, `PlatformDatasetChartBlock` for cohorts, and `StatusTimeline` for
status.

**Where results appear:** after submission (respondent blocks), in Publish & Responses per record
(all blocks), and as a CREW card.

---

## 7. Where forms run

| Place | Today | After |
|---|---|---|
| **Cycles** | A step shows one whole form, and answers stay with that step | A step opens the next **stage** of one shared response (D7) |
| **Copilot / Decision Inbox** | A form built on the fly; number and email fields become text | `StudioRenderer` shows the assigned stage and its results |
| **CREW** | Approve or reject only | A stage card filled in the room. The room can pre-fill answers, recording where each came from, and a person confirms. |
| **External people** | `ExternalTaskPage` with the old renderer and OTP | Same link and OTP, rendered by `StudioRenderer` |
| **Published agents** | Markdown plus `input_request`; no form cards; intake submission requires login | `StudioRenderer` for form messages; anonymous submission through the public, rate-limited endpoint |
| **Instant apps** | `PlatformFormBlock` can't load or submit anywhere | Route fixed (Phase 0), then rendered by `StudioRenderer` |
| **Chat calculators** | `render_intake_form` with the forgiving evaluator | Same tool, shared renderer and strict engine |
| **Project Spaces** | No forms tab; `form` is not a resource type | A Forms tab: the project's forms, waiting stages, recent results and response datasets |

---

## 8. Merge sequence

| Phase | Scope | Depends on |
|---|---|---|
| 0 | Stop live defects | None |
| 1 | Engine and definition v2 | None · blocks 2–8 |
| 2 | Knowledge grounding | 1 |
| 3 | Authoring: library, create, Studio, save and publish | 1 |
| 4 | CREW wiring and calculator pod retirement | 3 |
| 5 | Runtime: responses, rules, approvals, renderer adoption | 1, 3 |
| 6 | Stages across cycles | 5 |
| 7 | Calculation engine merge | 1, 5 |
| 8 | Project Spaces Forms tab | 3, 5 |

### Phase 0: stop live defects

**Legacy forms API** (`server/routes/hil.ts`):
- Org-scope `GET`, `PUT` and `DELETE /api/forms/:id` and `PUT /:id/viewed`.
- Allow-list `PUT` fields.
- Make `DELETE` archive, with a confirmation.
- Select `isArchived` and `description` in `listForms`.

**Form Builder:** remove the idle update loop (`FormsBuilder.tsx:611-621`).

**Instant-app form block:** point `PlatformFormBlock` at routes that exist. Either add a `forms`
family to the platform app API and the chat bridge, or call the `/hil` routes.

**Calculation canvas:**
- Stop reporting "Saved locally" when the create request fails.
- Read `calculation.id` from the response.
- Validate input with `createCalculationNodeSchema`.

**Calculator pod:** report Deploy as sent rather than deployed; drop the defaults for tools that
don't exist and the `projectId = 1` default.

**Exit:**
- Cross-org requests return 404.
- An instant-app form loads and submits in chat and in a built app.
- No surface claims a save or deploy that didn't happen.

### Phase 1: engine and definition v2 (blocks Phases 2–8)

**Land the backend.** Commit the untracked backend once its author has finished.

**Fix the engine defects.** Each gets a test that fails before the fix:

| Defect | Where | Fix |
|---|---|---|
| `x / 0` returns 0 | `form-expression.ts:262` | "Division by zero" error in the strict entry points |
| Optional or hidden inputs block submission with "Missing input" | `form-studio.ts:72-75` | Skip computed fields whose inputs are hidden or optional-empty |
| A required checkbox passes unticked | `form-studio.ts:68, 78` | A required boolean must be true |
| Digit-leading spec keys are rejected | `form-studio.ts:3` | Store the original key as `sourceKey` |
| Undo flips between two versions | `form-studio.service.ts:43-48` | Undo along the revision history |

**Definition v2.** Stages, page navigation, result blocks with audiences, decision rules, actions
and dataset binding (D1), migrating v1 on read.

**Revisions and drafts.** Add the `form_studio_revisions` table, and let drafts with structural
issues save (D8).

**Golden tests.**
- **Beta:** S_pilot 72.6442 → `EXTEND_PILOT_PHASE`.
- **Succession:** LRI 96.5625 → `PRIMARY_SUCCESSOR_CERTIFIED`.
- **Compliance:** index 100 → `COMPLIANT_RECORD_CERTIFIED`.

**Exit:** golden and regression tests pass, and `shared/form-studio.ts` has unit coverage.

### Phase 2: knowledge grounding (depends on 1)

**Ingest the three specs.** Their LaTeX is escape-damaged, with zero intact `\times`, `\frac`,
`\text`, `\right` or `\begin` in any of them. Ingestion repairs the sequences or flags the
document.

**Map each spec section:**

| Spec section | Becomes |
|---|---|
| §1 | Fields |
| §2–3 | Groups and scales |
| §4 | Gates |
| §5 | Computed fields |
| §6 | Decision rules and actions |
| §7 | A test |

**Issues pass.** It must at least surface:
- **Beta:** the narrative recommends GA, but the formula gives `EXTEND_PILOT_PHASE`; tier
  thresholds are undefined; four metrics are unused.
- **Compliance:** the WPM target is 120–160, but the penalty starts only above 180; two gates
  appear in no rule.
- **Succession:** the bench gate needs data across candidates, and the 9-box axes are undefined.

**Exit:** each spec generates a definition with those issues listed and tests passing. A reply
that isn't valid JSON returns a 422.

### Phase 3: authoring (depends on 1)

**Library.** The Forms library and `GET /api/form-studio` (§5), with a sidebar entry, Legacy
badges, and Used by.

**Create.** Blank, from documents (proposal diff → Create draft), and duplicate.

**Studio.** A client `client/src/modules/forms/FormStudioPod.tsx` plus a packaged shim; the
registry globs only `./*.tsx`. Its tabs are listed in §5, and `/armory/forms/builder/:id?` opens it
standalone.

**Saving.** Autosave with coalesced revisions, a save-state indicator, history and restore, undo
and redo, conflict resolution on 409, and a publish check with its impact list.

**Renderer.** `StudioRenderer` with page navigation, per-page checks, a review page and result
blocks, used in Preview.

**Exit (E2E):**
- Browse the library, open a legacy form, edit it, and watch autosave.
- Force a conflict from a second session and resolve it without losing either change.
- Publish v1.
- Create a form from documents and publish it.

### Phase 4: CREW wiring (depends on 3)

**Mount and change.** `mount_form_studio`, `isFormStudioRequest`, and `crew-form-studio.service.ts`,
which applies changes at a revision through diff cards and refuses stale ones.

**Calculator pod.** Route the calculator and intake directives (`crew-assembly-directives.ts:89-126`)
to Form Studio, fold `FullStackAssemblyPod` into Logic, Workflow and Data, and retire the pod.

**Rail and cards.** A CREW stage card, and a rail mount with the same props as `AppStudioPod`,
including `onFocusInChat`.

**Surface contract.** Complete all six pieces:
1. the pod;
2. the `TopicArchetype`;
3. the `summarizePodPayload` line;
4. the `mount_builder_pod` list;
5. read tools;
6. the governed write.

**Exit:** a room request mounts the Studio; *"Weight flight risk at 20%"* applies through a diff
card at the current revision.

### Phase 5: runtime (depends on 1 and 3)

**Responses.** Stored as dataset records through `datasetService.addItems`. Decision rules
evaluate at submission, and actions become approval requests that start pipelines when approved.

**Trigger.** A real `form_submitted` pipeline trigger; today `form_submit` is only a default string
(`assembly-tools.ts:637`).

**Public page.** `/external/forms/:token` in the router the path actually reaches, with OTP and
expiry from `securityConfig`, rate limiting, and token rotation.

**Renderer adoption.** `StudioRenderer` goes into `ExternalTaskPage`, `ApprovalDetailDialog`,
published agents (with anonymous submission), `PlatformFormBlock`, and `render_intake_form`.

**Exit:**
- Beta: an open P0 records `GA_LAUNCH_BLOCKED`, and its pipeline runs only after approval.
- An anonymous published-agent visitor completes a form and sees only respondent results.

### Phase 6: stages across cycles (depends on 5)

**Stage steps.** `human_approval` config accepts `{ formId, stageId }`, the response id travels in
mission context between blueprints, and each response is pinned to its release.

**Assignees.** Internal people get the Decision Inbox or a CREW card; external people get the OTP
link. An agent-filled stage records where each answer came from.

**Exit (succession):**
- Candidate self-assessment → HR data (flight risk hidden from the candidate) → committee review.
- The LRI updates after each stage.
- Republishing mid-cycle doesn't change an in-flight response's questions.

### Phase 7: calculation engine merge (depends on 1 and 5)

- Replace `basicEvaluator.evaluateFormula` and the `new Function` path
  (`calculation.service.ts:2111-2145`) with the strict `form-expression` entry points.
- Build cohort metrics over response datasets (D6), and the cohort comparison result block.
- Persist canvas workflow nodes or remove them; their Run button goes through approval.

**Exit:** the succession bench gate computes from real responses, and the existing calculation
suites stay green.

### Phase 8: Project Spaces Forms tab (depends on 3 and 5)

**Resource type.** Add `form` to `PROJECT_RESOURCE_TYPES`; the junction needs no migration.
Unique form names per project would need a `project_id` column, as datasets and knowledge
documents got.

**The tab.** The Forms library scoped to the project, plus stages waiting in its cycles, recent
results and response datasets. Studio's source picker favours the project's documents.

**Exit:** a private project's forms and responses are visible only to its members.

---

## 9. Acceptance scenarios

The beta and succession values were computed with the Form Studio engine and checked by hand. Of
the compliance values, the disclosure score was computed with the engine and the index was checked
by hand.

| Scenario | Expected | Today |
|---|---|---|
| Beta sample payload | S_pilot 72.6442, R_pmf 47.2727 → `EXTEND_PILOT_PHASE` | Matches |
| Beta, 0 survey responses | "Division by zero" error | S_pilot 31.4 → `PIVOT_OR_DEPRECATE` |
| Beta, open P0 | `GA_LAUNCH_BLOCKED` and an approval request | No workflow |
| Succession sample payload | LRI 96.5625 → `PRIMARY_SUCCESSOR_CERTIFIED` | Matches |
| Succession, 1–5 rating entered as 9 | Range error | Accepted; vision score 121 |
| Succession across a cycle | Three stages, one response, LRI updating per stage, flight risk hidden from the candidate | Unsupported |
| Compliance sample payload | Index 100 → `COMPLIANT_RECORD_CERTIFIED` | Matches |
| Compliance, lending page hidden, WPM blank | Submission accepted | Rejected with "Missing input" |
| Compliance, required consent unticked | Submission rejected | Accepted |
| Two authors edit one form | The second save is refused and resolved without losing edits | No revisions in the legacy builder |
| Instant-app form block | Loads and submits in chat and in a built app | Fails in both |
| Published agent visitor | Completes a form anonymously and sees respondent results only | No form rendering |

---

## 10. Decisions needed

1. **Legacy route.** Retire `/armory/forms/builder`? *Recommended: yes; legacy forms open in the
   Studio.*
2. **Chat calculators.** Move `render_intake_form` to the strict engine? *Recommended: yes; a
   silent 0 is how wrong numbers ship.*
3. **Backend ownership.** Who is finishing the untracked backend? It lands before Phase 1.
4. **Revision storage.** A `form_studio_revisions` table? *Recommended: yes.*
5. **Saving drafts with structural issues.** Allow it and block only publishing? *Recommended:
   yes; otherwise an author can't save while writing a formula that names a field they haven't
   added yet.*
6. **Autosave.** Coalesced autosave with optional named versions, or an explicit Save button?
   *Recommended: autosave.*

---

## 11. Risks

- **Concurrent editing of this code.** The Form Studio files were modified while this plan was
  written. Re-read before editing, and commit with `git commit --only -- <paths>`.
- **Existing `formId` consumers.** Pipeline steps and instant apps point at forms by id, so keep
  ids stable and `fields` top-level.
- **Migrations.** Check `migrations/runtime/*.sql` for duplicate numeric prefixes before adding
  tables.
- **Two frontend roots, several routers.** `server/vite.ts` decides which router serves a path.
  `/external*` and `/a/*` reach `login-main.tsx`; `/projects` reaches `OperationsRouting`.
- **Silent surfaces.** A pod missing any of the six surface pieces mounts while the room receives
  nothing. Diff its props against `AppStudioPod`'s.

---

## 12. Blast radius (swept 2026-09-11)

A single pass over every repository text file for each form touchpoint, followed by reads of each
server consumer, plus database checks.
- **Touchpoints swept:** the `hil_forms` table, `/api/forms`, renderer and type imports, the
  formula engine, HIL form configs, intake forms, HIL broadcasts, external and HIL links, the
  instant-app form block, form shortlinks, Form Studio, form tools, and multi-step form UI.
- **Excluded:** migration snapshots, deleted app workspaces, and docs.

### Writers: what creates or overwrites form rows

| Writer | Where | Risk for Studio |
|---|---|---|
| Legacy Form Builder | `FormsBuilder.tsx` → `/api/forms` | Replaced by the Studio |
| HIL step forms | `hil.service.ts` `createForm` | Runtime instance rows mixed into the library |
| Agent input requests | `request_human_input` → form publishing, which exists **twice** (`agents/governor/form-publishing.service.ts`, `governor/core/form-publishing-service.ts`) | Dedupes on name **plus exact schema JSON**, so any Studio edit makes the next agent request create a duplicate form |
| Cycle pauses | `cycle-hil-coordinator.service.ts:60` | A "Resources Required: <milestone>" row per pause |
| Org Forge installs | `org-forge.service.ts:1694-1719`, from the `forms:` blocks of **42 cycle templates** | Matches by name and **overwrites `schema` with `{ fields }`**, so a reinstall silently wipes Studio pages, logic and results |
| Pipeline executor | `pipeline-executor.ts:897-938` | Finds a form **by name**, so renaming it breaks the pipeline |
| Built-app platform API | `apps/platform/hil.controller.ts`, `compliance.controller.ts` | Built apps create forms |
| Behavioral intelligence | `action-dispatcher.service.ts:170` | Actions create forms |
| SDLC tools | `sdlc-tools.ts:445` | Returns the **form id as `approvalId`** |
| Form Studio (untracked) | `form-studio.service.ts` | Stores responses as archived form rows, which the readers below pick up |
| Seeds and scripts | `seed.ts`, `create-hil-infrastructure.ts`, e2e install scripts | Need updating with the schema |

### Readers

| Reader | Reads | Risk |
|---|---|---|
| Mission architect prompt (`mission-execution.service.ts:571`) | **Every** form in the org, unfiltered | Runtime rows and responses flood the planner's form list |
| Strategic planner (`mission-strategic-planner.service.ts:83`) | Active forms' `schema.fields` | Safe while `fields` stays top-level |
| Mission timeline, dependency resolver | `jobs.config.formId` joins | Ids must stay stable |
| System knowledge (`system-knowledge-service.ts:748`) | Non-archived forms into the knowledge graph | Runtime rows enter the graph |
| Resource catalog (`resource-catalog.service.ts:1529`) | Agent actions: view `GET` and submit `PUT /api/forms/:id` | Submit goes through the unscoped raw-body `PUT` and never resumes the pipeline |
| HIL and MCP tools (`list_hil_forms`, `get_hil_form`) | `schema.fields` keys | Safe |
| Human-approval executor, external service | Schema by `formId` | Old renderer ignores v2-only features |
| Job editor form picker (`HumanApprovalJobConfig.tsx:40`) | The `/api/forms` list | Affected by the list change |
| Notification inbox | `/api/forms/notifications` | Must keep working |
| Built-app API (`app-query.service.ts`, `hil.controller.ts`) | Pending forms with schema and config | Rendered by frozen copies |

### Other form systems

**`form_agent` jobs.** The form schema lives in job config.
- **Routes:** `/api/form-agents`, including an AI `extract-fields` endpoint that reads document
  templates. This overlaps Studio generation.
- **Used by:**
  - published-agent manifests (`agent-deployment.service.ts:75-86`), so published agents *do*
    collect form input, through `input_request`;
  - copilot `assistant_form` cards (`agent.service.ts:216`);
  - Cycle Builder inputs;
  - pipeline analytics and input validation;
  - the X-Ray operational guide;
  - the `service-dispatch-pipeline.cycle.yaml` trigger.
- **In the dev database:** 1 job.

**Other shapes:**
- **`HilFormFactory`:** three hardcoded forms.
- **`render_intake_form` / `assistant_form` payloads:** produced by render-tools, crew-tools,
  agent-orchestrator, good-question-engine and critic-service; rendered by `TurnRow`,
  `AgentChatSheet` and `ModularAssemblyPuzzleRail`.

### Built apps with frozen copies

**Deployed apps carrying form code.** Four active deployments (`location-search`,
`service-dispatch`, `rescue-dispatch`, `test-app-slug`) carry their own copies of
`PlatformFormBlock`, `FormRenderer` and `NotificationInbox`, as does the `rescue-dispatch`
blueprint.
- **Pool slots:** warm-1 and warm-2 hold the form block; warm-7 holds the renderer and inbox. New
  apps are created from this pool.
- **What they call:** `/api/forms/notifications`, `/api/oddjob/forms` (already broken) and
  `/api/external/task`.
- **What their copies miss:** v2 pages, visibility and computed rules.

**App generation.** The generator prompt (`forge-prompts.ts:314-316`) tells new apps to import
`FormRenderer` and to use `/api/oddjob/hil`, and `forge-wow.service.ts` counts `PlatformFormBlock`.

**The instant-app HIL block is also broken.** `PlatformHILApprovalBlock` calls
`/api/approval-requests`, and no server route serves that path; only `/api/approvals` exists.

### Notifications

The Slack and Teams HIL broadcast links to `/approvals/<form id>`, and every router redirects
`/approvals/*` to `/assistant/workbench`, dropping the id.

### Data (dev database)

- **References:** no foreign keys point at `hil_forms`. 4 `human_approval` jobs reference form
  ids, none dangling.
- **Rows:** 121 active template forms, 6 completed; 1 `form_agent` job.
- **Links and approvals:** 0 form shortlinks; 65 approval requests on jobs, 0 pending.

### Test coverage

27 test files touch the form stack. **None** cover the legacy forms routes, `FormsBuilder`,
`ExternalTaskPage`, `PlatformFormBlock` rendering, Org Forge form installation, or Form Studio.
The heaviest existing coverage is in:
- `tests/cross-domain/hil-notification.test.ts`;
- `approval-resumption.test.ts`;
- `form-publishing-guards.test.ts`;
- `form-agent-executor.test.ts`;
- `instant-app-tools.test.ts`.

### Plan changes this requires

| Phase | Change |
|---|---|
| 0 | Fix `PlatformHILApprovalBlock`'s route. Make Slack and Teams links open the specific request. Route the resource catalog's submit action through the scoped submit path that resumes pipelines. Make `sdlc-tools` return the approval id. |
| 1 | Add a form `kind` (template, step instance, cycle request, agent request, response) with a backfill, and filter every reader by kind, so the mission planner lists templates only. Merge the two form-publishing services, deduping by form identity rather than schema JSON. |
| 1 | Store a `fields`-only projection with every release for old renderers and frozen built apps. Publishing warns when a v2-only feature would be invisible to a legacy consumer listed in Used by. |
| 3 | Used by includes name references (pipeline `formRef`, Org Forge templates, agent-published names), and renaming a referenced form asks first. The library shows templates by default, with runtime kinds behind a filter. |
| 3 | An Org Forge reinstall never overwrites a Studio-edited form. It creates a draft revision from the template and flags the differences. |
| 5 | Converge `form_agent` onto Studio definitions: the job points at a form id, and `extract-fields` folds into Studio generation. |
| 5 | Regenerate the pre-warmed pool and the `rescue-dispatch` blueprint, and update `forge-prompts.ts`. Keep the routes the four deployed apps call working. |
| All | Add tests for each untested consumer before changing it. |

### Decisions this adds

7. **Template upgrades against Studio edits.** *Recommended:* a template update becomes a draft
   revision the form's owner reviews, never an overwrite.
8. **Frozen built apps.** Patch the deployed apps, or keep legacy routes and the `fields`
   projection stable? *Recommended:* keep them stable, and regenerate the pool and blueprint.
