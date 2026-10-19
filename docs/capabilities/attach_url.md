# 📚 Attach a File From a URL

> **Capability ID:** `attach_url`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Knowledge  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Fetch a file from a URL the user supplied (PDF, CSV, JSON, image, or page) and attach it to this room, where it is parsed and indexed. Use this whenever the user gives you a link to a document or data file instead of an upload — do NOT describe uploading it. Afterwards call get_attachment_text or search_attachments to read it.

---

## Inputs

| Name | Type |
| --- | --- |
| `url` | `string` |
| `fileName` | `string` |

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
> The URL and every redirect hop are validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.

> [!WARNING]
> When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.

> [!WARNING]
> At most 5 redirects, a 45-second timeout, and a 25 MB ceiling checked against both the declared Content-Length and the received body.

> [!WARNING]
> The file is attached only to the room's own project; a room with no project is refused.
