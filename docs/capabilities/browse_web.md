# 🧩 Browse Web

> **Capability ID:** `browse_web`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Web & Browser  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Visit a URL and extract its text content. Useful for reading documentation, news, or articles. Returns the page title and a text summary.

---

## Inputs

| Name | Type |
| --- | --- |
| `url` | `string` |
| `mode` | `enum` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!WARNING]
> The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.

> [!WARNING]
> When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.

> [!WARNING]
> The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.

> [!WARNING]
> Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `risk_profile`: `Low` → `Medium`
  - added `guardrails`: `—` → `Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.`
  - added `guardrails`: `—` → `The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.`
  - added `guardrails`: `—` → `The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.`
  - added `guardrails`: `—` → `When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `risk_profile`: `Low` → `Medium`
  - added `guardrails`: `—` → `Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.`
  - added `guardrails`: `—` → `The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.`
  - added `guardrails`: `—` → `The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.`
  - added `guardrails`: `—` → `When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `risk_profile`: `Low` → `Medium`
  - added `guardrails`: `—` → `Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.`
  - added `guardrails`: `—` → `The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.`
  - added `guardrails`: `—` → `The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.`
  - added `guardrails`: `—` → `When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `risk_profile`: `Low` → `Medium`
  - added `guardrails`: `—` → `Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.`
  - added `guardrails`: `—` → `The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.`
  - added `guardrails`: `—` → `The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.`
  - added `guardrails`: `—` → `When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `risk_profile`: `Low` → `Medium`
  - added `guardrails`: `—` → `Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.`
  - added `guardrails`: `—` → `The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.`
  - added `guardrails`: `—` → `The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.`
  - added `guardrails`: `—` → `When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `risk_profile`: `Low` → `Medium`
  - added `guardrails`: `—` → `Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.`
  - added `guardrails`: `—` → `The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.`
  - added `guardrails`: `—` → `The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.`
  - added `guardrails`: `—` → `When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.`
