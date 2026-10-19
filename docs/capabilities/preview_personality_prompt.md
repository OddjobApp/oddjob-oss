# 🧠 Preview Personality Prompt
> **ID:** `preview_personality_prompt`
> **Version:** `1.0.0`
> **Schema:** `1`
> **Category:** `Admin: Personality`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

## Description
Generates and returns the full soul prompt that would be injected into an agent's system prompt for a given set of OCEAN traits and archetype. Useful for testing personality configurations before applying them.

---

## Inputs

| Name | Type |
|---|---|
| `archetype` | `string` |
| `openness` | `number` |
| `conscientiousness` | `number` |
| `extraversion` | `number` |
| `agreeableness` | `number` |
| `neuroticism` | `number` |

---

## Outputs

| Name | Type |
|---|---|
| `result` | `string` |

---

## Business Use Cases
No explicit business use cases declared.

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.
