# 🔨 Forge Trigger (Recursive Spawn)

> **Capability ID:** `forge_trigger`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `App Forge`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description

Recursively spawns a sub-app to handle a specific feature gap or sub-task. Increments the forge depth to prevent infinite loops. Use this when a larger app requires a specialized micro-service or sub-module that doesn't yet exist.

---

## Inputs

| Name        | Type     |
| :---------- | :------- |
| `blueprint` | `string` |
| `name`      | `string` |
| `slug`      | `string` |
| `description`| `string` |
| `missionId` | `number` |
| `blackboard`| `object` |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Business Use Cases

> [!NOTE] No explicit business use cases declared.

---

## Guardrails

> [!NOTE] No explicit guardrails declared.
