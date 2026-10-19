# 🚀 Start Multi-Step Run
> **Capability ID:** `start_multistep_run`<br>
> **Capability Version:** `1.0.0`<br>
> **Manifest Schema Version:** `1`<br>
> **Category:** `System Utilities`<br>
> **Owner:** `platform`<br>
> **Risk Profile:** `Low`<br>
> **Execution Environment:** `Host`

---

## Description
Create a multi-step assembly run from a blueprint and mount it inline in chat as a step-by-step wizard. Use when a task needs several ordered stages with dependencies between them, rather than a single form.

---

## Inputs

| Name      | Type   |
| :-------- | :----- |
| `blueprint` | `object` |
| `title`     | `string` |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| `result` | `string` |

---

## Business Use Cases

---

## Guardrails
> [!NOTE] No explicit guardrails declared.
