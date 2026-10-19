# Computer Use — Agent Best Practices

> **Audience:** Agents in Oddjob crew sessions that have access to `trycua_*` tools.
> **Source of truth:** `server/knowledge/features/computer-use.md`, `server/domain/tools/v1/capabilities/trycua-computer-use.ts`

---

## 1. Should I Use Computer Use?

Before opening a desktop session, evaluate the **Tool Selection Hierarchy**. Choose the first option that works:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  1. Direct Tool / MCP Tool / DB Query        Fastest, deterministic      │
├──────────────────────────────────────────────────────────────────────────┤
│  2. Headless HTTP / REST / GraphQL Client    Lightweight, no rendering   │
├──────────────────────────────────────────────────────────────────────────┤
│  3. CLI / Shell Command in Sandbox           File ops, scripts           │
├──────────────────────────────────────────────────────────────────────────┤
│  4. Computer Use (trycua_* tools)            Visual, GUI, legacy, HITL   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Choose Computer Use when:

| Condition | Example |
|-----------|---------|
| No API exists for the service | Legacy SAP GUI, internal ERP portals, carrier shipping dashboards |
| Auth state must persist across browser tabs | SSO session in `/home/cua` profile already logged in |
| Task requires visual verification | CSS layout regression, CAPTCHA solving by human |
| Form requires real DOM events | File pickers, drag-and-drop, multi-step wizard with JS validation |
| A human must take over (HITL) | MFA/OTP prompt, irreversible action requiring explicit approval |
| Demonstrating a workflow to create a skill | Recording a human walkthrough → Playwright skill distillation |

### Do NOT choose Computer Use when:

- A documented API or MCP tool does the same job — it will be 10–100× faster.
- The task is reading or writing files/code — use code edit tools and `git`.
- The task only needs a web page's text content — use `search_web` or headless HTTP fetch.
- Secrets need to be typed — skills redact password fields; raw `trycua_type_text` does not.

---

## 2. Tool Reference

### Session Lifecycle

```
trycua_create_session
       │
       ▼
 trycua_observe / trycua_screenshot   ← Start every loop turn here
       │
       ├──► trycua_click
       ├──► trycua_type_text
       ├──► trycua_key_press
       ├──► trycua_scroll
       ├──► trycua_navigate
       ├──► trycua_find_element
       ├──► trycua_window
       ├──► trycua_file_upload
       ├──► trycua_wait
       │
       ▼
 trycua_screenshot (verify)           ← After every action, confirm the result
       │
  (repeat until goal reached)
       │
       ▼
trycua_end_session                    ← Always call; frees desktop resources
```

### High-Level Task Tool (Preferred for Most Goals)

**`trycua_run_task`** — Give the Gemini loop a plain-language goal. This is the
**preferred entry point** over manual step-by-step control because:
- Automatically checks for and replays matching learned skills first.
- Handles the full Observe → Plan → Act → Verify loop internally.
- Requests governance approval (once per run) automatically.
- Returns a structured result: `status`, `summary`, `pending`, `skillReplay`, `steps`.

```typescript
// Example: run a goal, let Gemini drive
trycua_run_task({
  sessionId,
  task: "Open linkedin.com and list my three newest notifications",
  // skillId: "sk_abc123"  // Optional: pin to a specific approved skill
  // skillInputs: { search_query: "Honolulu" }  // Optional: override skill inputs
  // maxSteps: 20  // Default: 15
})
```

**When to use low-level tools instead of `trycua_run_task`:**
- Fine-grained control is needed at each step (multi-agent coordination where
  each action must be logged individually).
- Debugging a failed skill or anomalous screen state.
- Pre-flight observation before deciding whether to hand control to a human.

### Full Tool Quick Reference

| Tool | Risk | Idempotency | When to use |
|------|------|-------------|-------------|
| `trycua_create_session` | high | none | Start of every Computer Use workflow |
| `trycua_screenshot` | low | read-safe | After every action to verify state |
| `trycua_observe` | low | read-safe | **Prefer over screenshot** for first look; returns clickable regions and text inputs via Gemini Vision OCR |
| `trycua_click` | medium | none | Click UI element by (x, y) coordinate after observe |
| `trycua_type_text` | medium | none | Type into a focused text field; do not use for passwords |
| `trycua_key_press` | medium | none | Keyboard shortcuts, Enter, Tab, Escape |
| `trycua_scroll` | low | none | Scroll vertically or horizontally |
| `trycua_navigate` | medium | none | Navigate browser to URL |
| `trycua_find_element` | low | read-safe | Locate element by label/role before clicking |
| `trycua_window` | medium | none | Switch focus between desktop windows |
| `trycua_file_upload` | high | none | Upload a local file via native dialog |
| `trycua_wait` | low | read-safe | Wait for an expected UI change |
| `trycua_run_task` | high | none | Full autonomous goal execution with Gemini loop |
| `trycua_list_skills` | low | idempotent | Inspect available learned skills before a task |
| `trycua_end_session` | medium | none | **Always call** to release desktop resources |

---

## 3. Core Loop Pattern: Observe → Plan → Act → Verify

**Never act without observing first. Never proceed without verifying.**

```
1. trycua_observe(sessionId)
   → Identify active app, clickable regions, text inputs, visible text.

2. Plan the next atomic action from the observation.
   → Do not plan more than one step ahead without re-observing.

3. Execute one action (click / type / navigate / key_press / scroll).

4. trycua_screenshot(sessionId)  ← Verify the action had the intended effect.
   → If no change: retry with trycua_find_element or alternate coordinates.
   → If unexpected modal/dialog: see §4 (HITL).
   → If error/crash: see §7 (Troubleshooting).

5. Repeat from step 1 until goal is achieved.
```

### Coordinate Precision Rules

- Desktop resolution is **1280×800** by default (`TRYCUA_RESOLUTION`).
- All `(x, y)` values from `trycua_observe` are already in this coordinate space.
- Do not hardcode coordinates — re-observe after every navigation or page load.
- Before any destructive click (Delete, Confirm Purchase, Deploy), screenshot and verify
  the target element's label matches the intent before clicking.

---

## 4. Human-in-the-Loop (HITL) & Dual Control

### When to yield control to the human

The Gemini loop automatically calls `yield_to_user` for:
- Login / OAuth / SSO prompts
- CAPTCHA / reCAPTCHA / hCaptcha
- MFA / 2FA / OTP codes
- Actions where the model's safety policy requires explicit confirmation

**As an agent using `trycua_run_task`**, you will receive this in the result:
```json
{
  "status": "needs_confirmation",
  "pending": "Please log in to LinkedIn. Open the desktop to complete authentication.",
  "viewerUrl": "https://yourapp.com/api/integrations/trycua/desktop/viewer?orgId=..."
}
```

**Your response to the user must include:**
1. What state the desktop is in (e.g., "The browser is showing a LinkedIn login page").
2. The specific barrier (e.g., "OAuth OTP prompt for LinkedIn").
3. Instruction to open the desktop viewer from the Computer Use Studio.
4. What the agent will do automatically once the human confirms.

**Never:**
- Attempt to guess an OTP, solve a CAPTCHA, or click through a security challenge.
- Leave a `needs_confirmation` task without surfacing it to the user.
- Loop more than 2 retries on the same failed action before yielding.

### Resuming after takeover

After the human confirms via the viewer, the task resumes automatically server-side.
When using `trycua_run_task`, poll for the updated task status. Do not restart the
session — resume is handled by the server.

---

## 5. Learned Skills: Check Before Every Task

### Before running a task, always check available skills

```typescript
// 1. Check what active skills exist
const skills = trycua_list_skills({ status: "active" });

// 2. If a matching skill exists, pin it to skip Gemini's discovery phase
trycua_run_task({
  sessionId,
  task: "Search Wikipedia for the population of Tokyo",
  skillId: "sk_wikipedia_search",
  skillInputs: { search_query: "Tokyo" }
});
```

### Skill matching rules
- The task text must name the skill's **site** and contain most of the skill's
  intent keywords for it to auto-match.
- If the task asks for more than the skill covers, Gemini continues from where the
  skill left off.
- If a skill step no longer matches (page redesign, A/B test), the agent falls back
  to the skill's written procedure as guidance text.

### Triggering skill distillation from a HITL session

When `yield_to_user` is called and the human completes an action in the live viewer,
**Oddjob automatically records** the browser session via Playwright CDP. Upon
`POST /confirm`, a draft skill is written from that recording.

**After a successful HITL session, tell the user:**
> "A draft skill has been created from your actions. An admin can review and approve
> it at **Admin → Settings → Computer Use → Learned skills** to make it reusable."

---

## 6. Safety & Governance

### Governance gate (once per run)
- `trycua_run_task` requests a `TRYCUA_AUTONOMOUS_RUN` governance approval once per session.
- If not approved within 30 seconds, the task is blocked.
- Surface this clearly: tell the user to approve the run in the Computer Use Studio.

### Never type secrets with raw tools
- `trycua_type_text` does **not** redact input. Never use it for passwords, tokens, or keys.
- Secrets must flow through **skill secret slots** — these are never recorded or stored.
- If a step requires a credential, the skill pauses and hands control to the user.

### Destructive actions always require HITL confirmation
Do not attempt any of these autonomously — always gate on human approval:
- Deleting records, databases, buckets, or files.
- Pushing to production or deploying infrastructure.
- Sending emails, messages, or social media posts.
- Making purchases, payments, or subscription changes.

### Shopping on Amazon is not a computer-use task
Amazon actively blocks and litigates unauthorized shopping agents, and exposes no
checkout API to third parties — so an agent must never drive a user's amazon.com
session, log in with stored Amazon cookies, or attempt checkout on the desktop.
Use the `amazon_*` tools instead: `amazon_search_products` /
`amazon_get_product` / `amazon_get_variations` / `amazon_compare_products` read
catalog data through the organization's own product-data credential,
`amazon_build_cart` produces a documented Associates cart link the person opens
in their own browser, and `amazon_propose_purchase` files an approval-gated
proposal that re-prices before issuing that link. The human always completes
checkout in their own Amazon session.

### Sandbox isolation
- The desktop runs in an ephemeral Docker container (`oddjob/cua-desktop`).
- No host filesystem mounts; no host network bypass.
- Browser logins in `/home/cua` persist across sessions within the same organization.
- Multiple agents or users from the same org **share one desktop** — avoid concurrent sessions
  that could interfere with each other's state.

---

## 7. Performance & Efficiency

| Practice | Rationale |
|----------|-----------|
| Use `trycua_run_task` over manual step-by-step | Gemini's loop batches perception and action internally |
| Pin a `skillId` when a skill matches | Skips Gemini's planning for known procedures |
| Call `trycua_observe` at the start of each new page | Gets structured clickable regions — fewer misclick retries |
| Use `trycua_find_element` before `trycua_click` | Resilient label/role grounding beats coordinate guessing |
| Set `maxSteps` for complex flows | Default is 15; multi-page workflows may need 25–40 |
| Always call `trycua_end_session` | Prevents idle-timeout sweep from orphaning sessions |

---

## 8. Common Failure Patterns & Fixes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Click lands in wrong place | Page layout shifted after scroll or load | Re-observe after every navigation; never reuse stale coordinates |
| `trycua_run_task` returns `status: "blocked"` | Model's safety policy blocked the action | Inspect `error` field; surface destructive actions to user for HITL |
| Viewer shows "Trycua is not enabled" | Computer Use not enabled for the org | Admin must enable it in **Admin → Settings → Computer Use** |
| Task pauses immediately (`needs_confirmation`) | Governance approval pending | Notify user; prompt them to approve the run in the viewer |
| Skill replay stops mid-way | Page redesign broke a step locator | Re-record the flow; admin re-approves the new draft skill |
| Session goes idle mid-script | No session row for script-run desktops | Set `TRYCUA_CLEANUP_DISABLED=true` for scripts |
| Screenshot shows blank/black screen | Desktop container not yet warm | Call `trycua_wait` (2–5 seconds) then re-screenshot |
| `trycua_observe` output empty or garbled | Accessibility bridge unavailable | Fall back to `trycua_screenshot` + coordinate estimation from the image |

---

## 9. Decision Matrix: Computer Use vs. Alternatives

| Goal | Best Tool | Rationale |
|------|-----------|-----------|
| Query database records | `query_database` / SQL tool | Structured, deterministic, 100× faster |
| Fetch public REST endpoint | `fetch_url` / HTTP tool | Headless, no GUI overhead |
| Read documentation or web content | `search_web` | Lightweight, no visual rendering |
| Edit code or repository files | Code edit tools / `git` | Direct FS mutation, version-controlled |
| Export report from SaaS with no API | **`trycua_run_task`** | Required: login, UI nav, click Export |
| Complete checkout with MFA | **`trycua_run_task` + HITL** | Agent sets up cart; human solves OTP |
| Validate responsive CSS layout | **`trycua_observe` / `trycua_run_task`** | Visual perception + screenshot diffing |
| Fill complex interactive form | **`trycua_run_task`** | Real DOM events, JS validation hooks |
| Demonstrate workflow to create a skill | **HITL recording** | Human drives; Playwright records; admin approves |
| Operate legacy ERP / SAP GUI | **`trycua_run_task`** | No API; desktop-only interface |
