# 🧠 Remember About User
> **ID:** `remember`
> **Version:** `1.0.0`
> **Schema:** `1`
> **Category:** Memory
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Persist a DURABLE fact or preference about the CURRENT user for future conversations (e.g. 'prefers concise, bullet-point answers', 'is working on the Q3 launch', 'timezone is PST'). Use when the user states a lasting preference or shares context worth recalling later. Do NOT use for transient, one-off task details.

---

## Inputs

| Name    | Type   |
| :------ | :----- |
| content | string |
| kind    | enum   |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases

*   No specific business use cases declared.
