# 📊 Render Progress
> **Capability ID:** `render_progress`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Rich UI`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Render progress indicators in the assistant chat to show completion status, task progress, or step-by-step advancement. Use this whenever you need to visualize progress (e.g. task completion, project status, workflow steps, loading states). Supports percentage bars, segmented progress, and status indicators. Always use this instead of describing progress in prose for clearer status communication.

---

## Inputs

| Name        | Type   |
| :---------- | :----- |
| `title`     | `string` |
| `description` | `string` |
| `type`      | `enum`   |
| `value`     | `number` |
| `total`     | `number` |
| `status`    | `enum`   |
| `segments`  | `array`  |
| `steps`     | `array`  |

---

## Outputs

| Name     | Type   |
| :------- | :----- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

No explicit business use cases declared.
