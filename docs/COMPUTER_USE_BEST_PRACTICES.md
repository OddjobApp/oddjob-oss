# Best Practices for Agents Leveraging Computer Use & Human Takeover

This guide outlines architectural, operational, and safety standards for agents operating in Oddjob’s Computer Use runtime (TryCUA, containerized XFCE/Ubuntu, noVNC, and browser automation).

---

## 1. Dual-Control & Human Takeover (HITL)

### 1.1 The "Yield on Anomaly" Rule
- **Never guess in high-entropy states:** If unexpected modals, CAPTCHAs, 2FA challenges, or session timeouts occur, the agent should transition to `needs_confirmation` or `paused` rather than repeatedly attempting blind clicks.
- **Yielding to User:** The agent must trigger `yield_to_user` or post an approval gate pod (`request_governance_approval` or action item) containing:
  1. The target application and window context.
  2. The specific barrier encountered (e.g., "OAuth OTP prompt" or "Account Verification").
  3. Desired post-takeover recovery checkpoint.

### 1.2 Interactive Takeover Ergonomics
- When a human engages **[🎮 Take Over]**:
  - The agent's action execution loop must immediately pause to prevent race conditions or input collisions.
  - The live viewport enters direct low-latency interactive mode.
  - The agent transitions to passive observation mode, capturing the human interaction trajectory for learning and context continuity.

---

## 2. Playwright Recording & Skill Distillation (Demonstration-to-Code)

A core capability of dual-control takeover is converting manual human intervention into reusable, repeatable skills.

### 2.1 Workflow Trajectory Recording
1. **Event Capture:** When the user takes over, attach an event listener / proxy logger (via Playwright CDP or container X11 event hooks) recording:
   - Target selectors (prefer resilient data attributes, ARIA roles, or semantic labels over brittle absolute XPaths).
   - Coordinates `(x, y)` normalized to viewport dimensions.
   - Text inputs, keystrokes, and navigation URLs.
2. **Trajectory Sanitization:**
   - Automatically redact secrets, authorization tokens, passwords, and PII from the trace before persistence.
   - Separate ambient mouse hover/scroll jitter from intentional action triggers.

### 2.2 Skill Packaging & Promotion
- Convert the recorded trajectory into an executable Oddjob Agent Tool or Playwright action script.
- Register the distilled workflow via the **Upskilling Orchestrator** (`upskilling-orchestrator.service.ts`):
  - **Golden Sample Creation:** Add the trajectory to the agent's fine-tuning or few-shot example set.
  - **Canary Benchmark:** Validate the synthesized script in a headless sandbox before promoting it to autonomous production capabilities.

---

## 3. Vision Grounding & Coordinate Precision

### 3.1 Resolution & Coordinate Normalization
- Always ground perception against a standard container resolution (e.g., `1280x800` or `1920x1080`).
- Ensure all model vision output coordinates `(x, y)` scale proportionally with the actual viewport:
  $$\text{Target}_X = \frac{x_{\text{model}}}{W_{\text{spec}}} \times W_{\text{actual}}$$
- Add visual target confirmation (bounding box overlays and crosshairs) in the UI before executing destructive clicks.

### 3.2 Multi-Modal Verification (Observe → Plan → Act → Verify)
- **Pre-action Inspection:** Check window title and foreground process ID.
- **Post-action Diffing:** Capture an immediate subsequent screenshot or DOM snapshot to confirm UI mutation before proceeding to the next step. If no change is detected after an intended click, back off and retry with alternate selector grounding.

---

## 4. Operational Safety & Blast Radius Control

### 4.1 Sandboxing & Isolation
- All computer use sessions run in ephemeral Docker/K8s sandboxes (`cua-xfce-desktop-*`).
- No direct host filesystem mounts or host network access.
- Clipboards must be mediated through explicit pass-through controls to prevent credential leaks.

### 4.2 Governance & High-Risk Gate Actions
- Actions marked `destructive` (e.g., "Delete Database", "Drop Table", "Purge Bucket", "Push to Production") strictly require HITL confirmation via `ComputerUseStudio` Action Approval buttons before execution.
- Export audit trails with full screenshot timelines, forensic timestamps, and decision rationales.
