# Computer Use

## Overview
Computer Use lets agents operate a real desktop the way a person does: they see the screen, click, type and browse. Each organization gets its own isolated Linux desktop with a web browser. Gemini decides each action from screenshots, and people can watch or take over through a login-protected viewer. When a person steps in, what they do in the browser can be recorded and turned into a reviewed, reusable **skill**. Approved skills are replayed for matching tasks, with the agent finishing whatever the skill does not cover.

## How it works

| Part | What it is | Where |
|------|------------|-------|
| Desktop | One container per organization (`oddjob-desktop-org-<id>`), built from `oddjob/cua-desktop` (the Cua XFCE desktop plus a recordable Chromium). Created on the organization's first session, stopped after 30 idle minutes, restarted on demand. `/home/cua` is a persistent volume, so browser logins survive. | `org-desktop.service.ts`, `docker/cua-desktop/` |
| Agent loop | Gemini Computer Use (`gemini-3.8-flash` by default) through the Gemini Interactions API. Each turn: screenshot in, actions out (click, type, scroll, key combos, navigate), executed on the desktop, new screenshot back. | `gemini-computer-use.ts` |
| Tasks | A task is a goal in plain language. The loop runs until the model reports the result, a person is needed, or the turn budget (default 15) runs out. Every action is stored as a task step. | `computer-use-task.service.ts` |
| Viewer | The desktop's noVNC viewer, proxied by Oddjob behind login, org membership and a one-use ticket. Interactive: people can log in to sites or finish a step themselves. | `desktop-viewer.ts` |
| Learned skills | Recordings of a person's browser actions, turned into skills with named inputs and secret placeholders, approved by an admin, and replayed by Playwright over the browser's DevTools protocol. | `skill-recorder.ts`, `learned-skills.service.ts` |

### The dual-control cycle
1. A task runs. At a login, a CAPTCHA, or before an irreversible action, the model calls `yield_to_user` and the task pauses (`needs_confirmation`, with a `viewerUrl`).
2. Oddjob starts recording the desktop's browser automatically.
3. The person clicks **Open desktop**, does what is needed, and confirms the task (`POST /computer-use/tasks/:id/confirm`, optionally with a note such as "logged in"). Alternatively, for visual CAPTCHA or 2FA challenges, the user solves the challenge directly in the chat's inline approval card without leaving the window.
4. Recording stops, the task resumes, and a **draft skill** is written from the recording in the background with automatic parameter inference.
5. An admin reviews the draft (steps, inputs, procedure) and approves it.
6. Later tasks whose goal matches the skill replay it first. Replay checks every step; at the first step that no longer matches, or at a secret, the Gemini loop continues from the current screen with the skill's written procedure as guidance.

Recording can also be started:
- By typing `/teach [goal]` directly in CREW Chat (`/teach Extract vendor invoices`).
- By hand from **Admin → Settings → Computer Use → Learned skills → Record**.

## Setup

1. **Docker** must be available to the Oddjob server (the `docker` CLI on its PATH). The desktop image builds itself the first time (`docker build -t oddjob/cua-desktop:latest docker/cua-desktop`, a few minutes).
2. **Environment** (see `.env.example`):
   ```
   TRYCUA_PROVIDER=cua
   TRYCUA_PROVIDER_TYPE=org_desktop      # one desktop per organization
   GEMINI_API_KEY=...                     # or a google_ai credential per org
   TRYCUA_CU_MODEL=gemini-3.8-flash       # optional
   CUA_TELEMETRY_ENABLED=false            # the Cua SDK reports usage to PostHog otherwise
   ```
   Optional: `TRYCUA_DESKTOP_MEMORY_MB` (2048), `TRYCUA_DESKTOP_CPUS` (1), `TRYCUA_DESKTOP_IDLE_MINUTES` (30), `TRYCUA_RESOLUTION` (1280x800), `TRYCUA_SKILLS_AUTOMATCH=false` to only replay skills a task names.
3. **Per organization**: an admin switches on **Enable Trycua** in Admin → Settings → Computer Use. Sessions, the viewer and skills are refused (403) until then.
4. **Database**: migration `0126_computer_use_skills` (`npm run db:migrate`).

For a single shared desktop instead (development), `TRYCUA_PROVIDER_TYPE=local` with `docker compose --profile computer-use up -d cua-desktop`. Skills need `org_desktop`.

## Using it

- **In-Chat Teach Mode**: Type `/teach [task description]` into any CREW room to open the live desktop in Teach Mode and record demonstration workflows.
- **Open desktop**: on the Computer Use settings card and on the Operations session viewer. Opens the organization's desktop in a new tab.
- **Run a task** (REST): create a session (`POST /api/integrations/trycua/sessions`), then `POST /api/integrations/trycua/computer-use/tasks` with `{ sessionId, task }`. Optional: `requireConfirmation` (default `true`: every action waits for `/confirm`), `maxSteps`, `skillId`, `skillInputs`.
- **Agents**: `trycua_run_task` (goal in, result or hand-over out), `trycua_teach_task`, and `trycua_list_skills`, plus the low-level `trycua_*` tools (screenshot, click, type, key press, scroll, navigate).

## Learned skills & Socratic Parameterization

A skill stores:
- **Steps**: page-level actions (navigate, click, fill, select, check, key press) with Playwright-style locators: test id, role and accessible name, label, placeholder, stable id, name attribute, and a CSS path as a last resort.
- **Inputs**: values that change between runs (search terms, recipients, message text), written into steps as `{{input}}`. Compiled dynamically at runtime into typed Zod schemas with number/date coercion via `buildRuntimeInputSchema`.
- **Secret slots**: password, one-time-code and payment fields. Their values are never recorded; replay stops there and the agent hands control to a person.
- **Procedure**: numbered plain-language steps, used when the page has changed.
- **Status**: `draft` → `active` (admin approval) → `archived`. Editing an active skill's steps, inputs or site sends it back to draft. Success and failure counts are kept per skill.

### Parameter Inference & Ambiguity Clarification
- **Heuristic Parameter Extraction (`inferParametersHeuristically`)**: Analyzes goal tokens, field names, and input formats. High-confidence variables ($\Delta H \le 0.60$) are auto-parameterized into `{{input_name}}`.
- **Socratic FormAgent Clarification**: When parameter ambiguity exceeds entropy threshold ($\Delta H > 0.60$), the Good Question Engine generates an inline FormAgent card asking whether the value should be dynamic, constant, or excluded.
- **Knowledge Garden Graph Bridging**: `curateNavigationalGuide` automatically cross-indexes approved computer-use skills into the Knowledge Graph, enabling instant recall on matching semantic queries.

Matching is lexical and deterministic: the goal must name the skill's site, and contain most of the skill's intent (its name, or its example goal without the example values). Goals that ask for more than the skill does still match; the agent finishes the rest.

## Governance and safety
- **Once per run**, a governance approval (`TRYCUA_AUTONOMOUS_RUN`) is requested; unapproved runs are blocked after 30 seconds.
- **Per action**, the task pauses on Gemini's own `safety_decision: require_confirmation` (resumed with the required acknowledgement), on `yield_to_user`, and in supervised mode (`requireConfirmation`, the default) before every action. `blocked` decisions stop the task.
- **The model is instructed** never to type passwords, codes or payment details, never to solve CAPTCHAs or accept terms, and to ask before sending, posting, buying or deleting. Prompt-injection detection is on.
- **Approving a skill** needs an organization admin: a skill acts on whatever accounts are logged in on the desktop.

## Security model
- Desktop ports (computer-server, noVNC, Chromium DevTools) have no authentication of their own. They are published on **127.0.0.1 only**, on ports Docker picks, and desktops share a network with container-to-container traffic disabled.
- The **viewer** checks login, organization **membership** (its own check: the shared org resolver accepts `?orgId=` without one), and that computer use is enabled. Its WebSocket needs a random, single-use ticket issued server-side, bound to the org, user and desktop, valid 60 seconds; the browser's Origin must match the host. Oddjob's cookies are never forwarded to the desktop. noVNC page parameters are allow-listed (this noVNC build would otherwise stream a recording of the session to any `record_url`).
- The Operations **screenshot stream** (`/api/trycua/stream`) needs a ticket from `POST /sessions/:id/stream-ticket`; the org, user and session come from the ticket, never from the client.
- **Recordings** never store password, one-time-code or payment field values, and step rows redact typed text.

## API reference
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/integrations/trycua/desktop/viewer?orgId=` | Open the viewer (redirect with ticket) |
| POST | `/api/integrations/trycua/sessions/:id/stream-ticket` | Ticket for the screenshot stream |
| POST | `/api/integrations/trycua/computer-use/tasks` | Create (and run) a task |
| POST | `/api/integrations/trycua/computer-use/tasks/:id/run` | Run a queued task |
| POST | `/api/integrations/trycua/computer-use/tasks/:id/confirm` | Resume a paused task (`allow`, optional `text`) |
| POST | `/api/integrations/trycua/desktop/recordings` | Start recording |
| POST | `/api/integrations/trycua/desktop/recordings/:id/stop` | Stop recording |
| GET | `/api/integrations/trycua/desktop/recordings` | List recordings (and the running one) |
| DELETE | `/api/integrations/trycua/desktop/recordings/:id` | Discard a recording |
| POST | `/api/integrations/trycua/desktop/recordings/:id/skill` | Draft a skill from a recording |
| GET / PATCH | `/api/integrations/trycua/skills[/:id]` | List, read, edit skills |
| POST | `/api/integrations/trycua/skills/:id/approve` | Approve (admin) |
| POST | `/api/integrations/trycua/skills/:id/archive` | Archive (admin) |

## Verification
Verified live on a development desktop (September 2026):
- Gemini loop: Wikipedia → Honolulu population in 13 turns; answer matched the page.
- Viewer: opened, controlled (click, type), a spent ticket refused, disconnects tracked.
- Skills: a person's Wikipedia search for "Honolulu" recorded, drafted by Gemini with a `search_query` input, approved, matched to "Search Wikipedia for Paris", replayed to the Paris article.
- Full task: governance approved, skill matched and replayed for Tokyo, Gemini finished in 7 turns (12 without the skill).
- Takeover: the agent handed over at a login, the person's login was recorded (password as a secret slot, never stored), the task resumed and succeeded, and a draft skill was written.

## Limits
- **On-screen text can reach the model's words.** Recordings never contain password field values, but the model reads the screen: on a practice site that prints its demo password on the login page, the model repeated it in its hand-over message, which is stored with the task. Real sites do not display passwords.
- **Skills cover web pages only**, in the desktop's Chromium; not native desktop apps.
- **One desktop per organization**: concurrent sessions in the same organization share it and can interfere.
- **Production**: the server needs the Docker CLI, which the server's own container does not have; production needs an orchestrator (Kubernetes, or Cua's cloud) instead.
- **Data at Google**: the Interactions API keeps conversation state, including screenshots, on Google's side.
- **Window focus by title and file upload** are only available on Cua cloud sandboxes.

## Troubleshooting
- *Viewer shows "Trycua is not enabled"*: the viewer uses the organization selected in the app; enable computer use for that organization.
- *A script's desktop stops mid-run*: scripts create no session rows, so the idle sweep sees an idle desktop; set `TRYCUA_CLEANUP_DISABLED=true` in scripts.
- *Published ports return empty replies*: the desktop's computer-server binds 127.0.0.1 by default; the boot command patches it to 0.0.0.0 inside the container (the host side stays loopback-only).
- *Skill replay stops at a step*: the page changed; the task continues with the procedure. Record the flow again and approve the new draft if it keeps happening.
