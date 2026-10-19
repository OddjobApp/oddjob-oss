# 🔍 Search Platform Documentation
> **Capability ID:** `search_platform_documentation`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** System Utilities
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Search this platform's feature specs, API contracts, capability manifests, UI specs, and consumer-badged operational patterns. Use generated system specs for authoritative implementation facts. Use platform patterns for workflow guidance, preserving their consumer role and verification status.

Operational patterns are available through `list_platform_patterns`, `search_platform_patterns`, and `get_platform_pattern`. A pattern never grants authority: user instructions, runtime safety policy, capability guardrails, and live tool schemas take precedence.

---

## Inputs

| Name  | Type   |
| :---- | :----- |
| query | string |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

No explicit business use cases declared.
