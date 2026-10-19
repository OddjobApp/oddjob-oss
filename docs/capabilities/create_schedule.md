# 📅 Create Schedule

> **Capability ID:** `create_schedule`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Pipeline Orchestration
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Create a new schedule pattern. Requires admin. Patterns: 1=hourly, 2=daily, 3=weekly, 4=cron. Use patternString for timing config.

---

## Inputs

| Name | Type |
|---|---|
| name | string |
| description | string |
| pattern | number |
| patternString | object |
| patternLabel | string |
| timezone | string |
| isActive | boolean |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE] No explicit business use cases declared.
