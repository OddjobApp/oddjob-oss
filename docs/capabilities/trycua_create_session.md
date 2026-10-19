# 🧩 Create Computer Session

> **Capability ID:** `trycua_create_session`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Computer Use  
> **Owner:** platform  
> **Risk Profile:** High  
> **Execution Environment:** Host

---

## Overview

Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a sessionId that must be passed to all subsequent trycua_* tool calls. People can watch or take over the same desktop from "Open desktop". Always end the session with trycua_end_session when done.

---

## Inputs

| Name | Type |
| --- | --- |
| `os` | `enum` |
| `sandboxName` | `string` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-09-19]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Open a new sandboxed computer session. Returns a sessionId that must be passed to all subsequent trycua_* tool calls. Always end the session with trycua_end_session when done.` → `Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a sessionId that must be passed to all subsequent trycua_* tool calls. People can watch or take over the same desktop from "Open desktop". Always end the session with trycua_end_session when done.`
  - modified `documentation_meta.summary`: `Open a new sandboxed computer session. Returns a sessionId that must be passed to all subsequent trycua_* tool calls. Always end the session with trycua_end_session when done.` → `Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a sessionId that must be passed to all subsequent trycua_* tool calls. People can watch or take over the same desktop from "Open desktop". Always end the session with trycua_end_session when done.`

- **[Auto-Changelog 2026-09-19]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Open a new sandboxed computer session. Returns a sessionId that must be passed to all subsequent trycua_* tool calls. Always end the session with trycua_end_session when done.` → `Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a sessionId that must be passed to all subsequent trycua_* tool calls. People can watch or take over the same desktop from "Open desktop". Always end the session with trycua_end_session when done.`
  - modified `documentation_meta.summary`: `Open a new sandboxed computer session. Returns a sessionId that must be passed to all subsequent trycua_* tool calls. Always end the session with trycua_end_session when done.` → `Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a sessionId that must be passed to all subsequent trycua_* tool calls. People can watch or take over the same desktop from "Open desktop". Always end the session with trycua_end_session when done.`

- **[Auto-Changelog 2026-09-19]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Open a new sandboxed computer session. Returns a sessionId that must be passed to all subsequent trycua_* tool calls. Always end the session with trycua_end_session when done.` → `Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a sessionId that must be passed to all subsequent trycua_* tool calls. People can watch or take over the same desktop from "Open desktop". Always end the session with trycua_end_session when done.`
  - modified `documentation_meta.summary`: `Open a new sandboxed computer session. Returns a sessionId that must be passed to all subsequent trycua_* tool calls. Always end the session with trycua_end_session when done.` → `Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a sessionId that must be passed to all subsequent trycua_* tool calls. People can watch or take over the same desktop from "Open desktop". Always end the session with trycua_end_session when done.`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`
