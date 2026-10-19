# When to Choose Computer Use: Agent Decision Guide

> **See also:** [`computer-use-and-takeover-best-practices.md`](./computer-use-and-takeover-best-practices.md) — full tool reference, lifecycle patterns, HITL playbook, and troubleshooting.

In Oddjob, agents have access to direct APIs, database queries, code execution runtimes, and headless HTTP integrations. **Computer Use** (TryCUA, XFCE desktop, Chromium, and GUI interaction) is a specialized, visual, multi-modal tool that carries higher overhead and governance cost.

This document helps an agent decide **when** to choose Computer Use and **what kind of task** it is suited for.

---

## 1. Tool Selection Hierarchy

Evaluate in order. Use the first option that satisfies the goal:

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

**Rule of thumb:** If an authenticated API endpoint or CLI exists, use it. Choose Computer Use only when the task boundary requires visual perception, complex client-side UI state, legacy systems without APIs, or human-in-the-loop collaboration.

---

## 2. Core Use Cases

### Category A: Legacy & Closed Ecosystems (No Public API)

1. **Legacy Internal Enterprise Portals**
   - Internal intranets, ERPs (SAP GUI, Oracle Forms, internal ASP.NET/JSP portals) with no API surface.
   - Use `trycua_run_task` with a goal that names the site; let Gemini navigate.

2. **Third-Party Vendor Dashboards**
   - SaaS platforms that restrict data export to web portal clicks (ad dashboards, carrier shipping portals, legacy banking/invoice interfaces).
   - First check `trycua_list_skills` for a recorded export flow.

3. **Desktop-Only Native Applications**
   - GUI-only software installed in the Linux desktop (LibreOffice, local database visualizers, media inspectors).
   - Use `trycua_window` to switch focus; `trycua_observe` to identify controls.

---

### Category B: Dynamic Web Applications & Anti-Bot Environments

4. **Heavy Single-Page Applications (SPAs)**
   - Sites with complex client-side rendering (React, Vue, WebGL canvases, Shadow DOM) where raw HTTP requests miss dynamic DOM hydration or client-computed nonces.

5. **Interactive Data Explorers & Canvas Visualizations**
   - Extracting data from interactive canvas charts, maps, or data grids that do not expose raw tabular data over network endpoints.
   - Use `trycua_observe` to identify interactive regions, then `trycua_click` to drill in.

6. **Session-Maintained Browsing**
   - Tasks where session cookies, localStorage, or SSO states are already authenticated and persisted in the desktop's `/home/cua` profile volume.
   - The desktop preserves login state across sessions within the same organization — no re-login needed if a skill already handled it.

---

### Category C: End-to-End QA, Visual Verification & Compliance

7. **Visual Regression & Layout Auditing**
   - Verifying rendered UI layouts across viewport sizes — buttons, banners, typography.
   - Use `trycua_navigate` → `trycua_observe` → `trycua_screenshot` and compare with reference images.

8. **User Journey & Smoke Test Validation**
   - Executing real end-user flows (onboarding wizards, checkout flows, multi-step forms) exactly as a human clicks and types, validating frontend DOM and visual feedback simultaneously.
   - Use `trycua_run_task` with a descriptive end-to-end goal.

9. **Accessibility & Usability Inspection**
   - Inspecting interactive element affordances, focus indicators, modal traps, and contrast compliance from an actual rendered display.
   - `trycua_observe` returns accessibility node data (role, label, bounds) useful for auditing.

---

### Category D: Multi-App Workflows & File Hand-offs

10. **Cross-Application Desktop Data Bridges**
    - Download a CSV/PDF from a browser → locate it in `/home/headless/Downloads` → open in LibreOffice or OCR viewer → extract figures → upload elsewhere.
    - Use `trycua_navigate` to trigger download, `trycua_window` to switch to the file manager, `trycua_find_element` to locate the file.

11. **Interactive File Uploads & Drag-and-Drop**
    - Services requiring desktop drag-and-drop mechanics or native OS file chooser dialogs.
    - Use `trycua_file_upload` for native file chooser dialogs (note: only available on Cua cloud sandboxes for window-focus scenarios).

---

### Category E: Dual-Control Tasks Requiring Human Collaboration (HITL)

12. **MFA, CAPTCHA, and Login Hand-over**
    - Navigate to the authentication checkpoint; `trycua_run_task` will automatically call `yield_to_user` and return `status: "needs_confirmation"`.
    - Surface the `pending` message and viewer URL to the human; after they confirm, the task resumes automatically.

13. **Demonstration & Skill Acquisition**
    - Invoke Computer Use specifically so a human operator can demonstrate a multi-step workflow.
    - Oddjob automatically records the browser session via Playwright CDP during HITL.
    - Upon `POST /confirm`, a draft skill is created and submitted for admin approval.
    - After approval, future `trycua_run_task` calls for matching goals replay the skill automatically.

---

## 3. Red Flags: Do NOT Use Computer Use for These

| Task | Better Alternative |
|------|--------------------|
| Reading public web content | `search_web` tool |
| Calling a REST/GraphQL API | `fetch_url` or HTTP tool |
| Querying a database | `query_database` / SQL tool |
| Editing code or files | Code edit tools / `git` |
| Running a CLI command | Shell tool / sandbox exec |
| Typing a password or secret | Use skill secret slots only; never `trycua_type_text` |

---

## 4. Quick Triage: Does This Need Computer Use?

```
Does a direct API, MCP tool, or DB query satisfy the goal?
  └─ Yes → Use it. Do not open a desktop session.
  └─ No  →
       Is the barrier visual (rendered UI, CAPTCHA, live session state)?
         └─ Yes → Use trycua_run_task (preferred) or low-level trycua_* tools.
         └─ No  →
              Is the barrier an auth flow requiring human input (MFA/OTP)?
                └─ Yes → Use trycua_run_task; it will yield_to_user automatically.
                └─ No  → Re-evaluate: there is likely a non-GUI path available.
```

For the full implementation guide — tool reference, Observe→Plan→Act→Verify loop, HITL playbook, safety rules, and troubleshooting — see [`computer-use-and-takeover-best-practices.md`](./computer-use-and-takeover-best-practices.md).

