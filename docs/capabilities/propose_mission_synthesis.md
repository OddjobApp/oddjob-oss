# 💡 Propose Mission Synthesis

> **Capability ID**: `propose_mission_synthesis`
> **Capability Version**: `1.0.0`
> **Manifest Schema Version**: `1`
> **Category**: `Discovery`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

## Description

When `discover_capabilities` finds NO existing mission that fits the user's request, propose SYNTHESIZING a new one via GMS. This does NOT run anything — it creates a proposal a human must approve; on approval a new mission is synthesized and saved as a draft for review. Only use this AFTER `discover_capabilities` returns no suitable match. Provide the user's goal and a short reason.

---

## Inputs

| Name    | Type   |
| :------ | :----- |
| `request` | `string` |
| `reason`  | `string` |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| `result` | `string` |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases

No specific business use cases declared.
