---
id: browser-automation-and-playwright-standards
title: Headless Browser Automation, Playwright & Visual Replay Standards
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: AGENT_PRIMARY
category: 05-component-and-tooling-guides
autonomy_level: L2-L4
version: 1.0.0
tags: [playwright, browser-automation, selenium, trycua, web-scraping, testing, visual-replay, stealth]
summary: Operational standards for managing headless browser pools, stealth navigation, resilient element locators, visual snapshot diffing, and deterministic session replay.
verification_status: verified
applies_when:
  - Performing automated web extraction, UI interaction, form filling, or synthetic testing
  - Managing Playwright, Selenium, or Trycua browser automation job executors
  - Debugging DOM layout shifts, anti-bot challenges, and visual snapshot regressions
do_not_use_when:
  - Direct REST/GraphQL API endpoints exist for the target data source
required_tools:
  - trycua_navigate
  - trycua_click
  - trycua_type_text
  - trycua_screenshot
  - vision_describe_screenshot
preconditions:
  - Chromium/WebKit browser binary installed and sandbox kernel flags verified
  - Target URL is reachable without network firewall egress blocking
approval_requirements:
  - Form submissions involving financial payments or legal agreements require HIL approval
success_checks:
  - DOM elements resolved using resilient user-facing accessibility locators (ARIA labels, text)
  - Full-page screenshot and action trace recorded upon step failure
stop_conditions:
  - Cloudflare / CAPTCHA challenge encountered that cannot be solved or loop timeout > 30s
escalation:
  - Trigger FormAgent HIL intervention to request human CAPTCHA solve or credentials
implementation_evidence:
  - server/domain/jobs/executors/
  - server/domain/testing/
---

# Headless Browser Automation & Visual Replay Standards `[🤖 AGENT]`

> **Audience:** `🤖 Agent Executable & Automation Engineer` &nbsp;|&nbsp; **Classification:** Component Standard & Execution Runbook

---

## 1. Browser Lifecycle & Worker Pool Architecture `[🧑 Human]`

Launching a full browser process per task creates severe memory overhead. Oddjob implements a pooled context architecture with disposable incognito sessions:

```mermaid
graph TD
    JobQueue["Automation Job Queue"]

    subgraph BrowserPool["Managed Chromium Browser Daemon (Warm Pool)"]
        Daemon["Persistent Chromium Process (Daemon)"]
        Context1["Ephemeral Browser Context 1 (Isolated Cookies/Storage)"]
        Context2["Ephemeral Browser Context 2 (Isolated Cookies/Storage)"]
        Context3["Ephemeral Browser Context 3 (Isolated Cookies/Storage)"]
    end

    subgraph ArtifactPipeline["Trace & Visual Replay Pipeline"]
        Screenshots["DOM Screenshots (WebP)"]
        Video["Video Replay Stream"]
        Har["Network HAR Log"]
    end

    JobQueue --> Context1 & Context2 & Context3
    Context1 & Context2 & Context3 --> ArtifactPipeline
```

---

## 2. Resilient Locator Hierarchy Invariants `[🤖 Agent Reference]`

Agents must NEVER use brittle, generated CSS selectors like `#main > div:nth-child(3) > button.btn-primary-2x`.

### Locator Priority Tier:
1. **Tier 1 (Best): Accessibility Roles & ARIA**:
   - `page.getByRole('button', { name: 'Submit Application' })`
   - `page.getByLabel('Email Address')`
2. **Tier 2: Visible User Text**:
   - `page.getByText('Confirm & Pay')`
3. **Tier 3: Test IDs**:
   - `page.getByTestId('checkout-btn')`
4. **Tier 4 (Forbidden): Brittle Structural Selectors**:
   - Direct XPaths `/html/body/div[2]/form/input[1]` or index-based CSS paths are strictly banned.

---

## 3. Stealth Evasion & Anti-Bot Invariants `[🧑 Human]`

When interacting with external web targets:
- **Mask WebDriver Flags**: Set `navigator.webdriver = false` and pass standard user-agent strings.
- **Human-Like Input Jitter**: Introduce natural randomized typing delays ($30\text{ms}–90\text{ms}$ per keystroke) rather than instant programmatic value injection.
- **Viewport Normalization**: Always launch standard 1920x1080 desktop or 390x844 mobile viewports with valid device scale factors.

---

## 4. Visual Snapshot Diffing & Failure Triage `[🤖 Agent Reference]`

When a step fails:
1. **Capture Full Page Snapshot**: Generate `.webp` visual screenshot and capture current DOM tree HTML.
2. **Log Network HAR Trace**: Record all pending, failed (4xx/5xx), or CORS-blocked network requests.
3. **Pass to Vision Model**: Invoke `vision_describe_screenshot` to diagnose if the page is displaying a modal, cookie consent overlay, or CAPTCHA blocking the target element.
