# 🚀 Propose Mission Launch

> **ID**: `propose_mission` | **Version**: `1.0.0` | **Schema**: `1` | **Category**: `Discovery` | **Owner**: `platform` | **Risk Profile**: `Low` | **Environment**: `Host`

---

## Description

Propose launching a specific mission (by id, obtained from discover_capabilities) to fulfil the user's request. This does NOT run the mission — it creates a proposal a human must approve. Use this INSTEAD of launch_mission when acting on a conversational request. Provide the missionId, a short reason, and any inputs the mission's capability contract requires.

---

## Inputs

| Name      | Type   |
| :-------- | :----- |
| `missionId` | `number` |
| `reason`    | `string` |
| `inputs`    | `object` |

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

No business use cases declared.
