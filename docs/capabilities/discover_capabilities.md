# 🔍 Discover Capabilities
> **Capability ID:** `discover_capabilities`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Discovery
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Discover which Oddjob missions are available to fulfil a request, each with its purpose, when to use it, and the inputs it needs. ALWAYS call this before telling a user a request can't be handled, and before launching a mission, so you select the right one. Pass `query` (the user's goal in natural language) to rank the most relevant missions first.

---

## Inputs

| Name  | Type   |
| :---- | :----- |
| query | string |
| limit | number |

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

> [!NOTE] No explicit business use cases declared.
