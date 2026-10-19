# 🧩 HTTP Query

> **Capability ID:** `http_query`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Web & Browser  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Query a live external HTTP/HTTPS REST API endpoint with SSRF protections, caching, parameter merging, and optional JSON path extraction. Ideal for real-time weather, currency exchange, public data feeds, and market prices.

---

## Inputs

| Name | Type |
| --- | --- |
| `url` | `string` |
| `method` | `enum` |
| `params` | `object` |
| `jsonPath` | `string` |
| `cacheTtlSeconds` | `number` |

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
> Only HTTP and HTTPS URLs are accepted; every other scheme is refused.

> [!WARNING]
> The URL and every redirect hop are validated by EgressFirewall, which refuses loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form, including IPv4-mapped IPv6.

> [!WARNING]
> A hostname is also refused when DNS resolves it to a private or reserved address. This does not close DNS rebinding, where the address changes between the check and the connection.

> [!WARNING]
> When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.

> [!WARNING]
> Responses are cached per organization for the requested TTL, so a query may be answered from a previous caller's result within that window.
