# ⚙️ Propose Application Draft
> **Capability ID:** `propose_app_draft`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description
Configures and saves a new Application Draft to the Organization's App Forge registry and creates an approval-gated proposal card in chat. Use this whenever asked to create, draft, or save an application or forged app.

---

## Inputs

| Name          | Type     |
| :------------ | :------- |
| `name`        | `string` |
| `description` | `string` |
| `blueprintSlug` | `string` |
| `projectId`   | `number` |
| `components`  | `array`  |
| `pipelineIds` | `array`  |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Business Use Cases

> [!NOTE]
> No specific business use cases declared.

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.
