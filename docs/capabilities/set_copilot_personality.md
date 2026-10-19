# 🤖 Set Copilot Personality
> **ID:** set_copilot_personality | **Version:** 1.0.0 | **Schema:** 1 | **Category:** Admin: Personality | **Owner:** platform | **Risk:** Low | **Environment:** Host

## Description
Configures the global personality for the Oddjob Assistant/Copilot system agent. Accepts a named archetype and/or individual OCEAN trait values. Optionally adds a system prompt addon that is appended to every Copilot invocation. Changes are system-wide and take effect on the next request. Super Admin only.

---

## Inputs
| Name | Type |
|---|---|
| archetype | string |
| openness | number |
| conscientiousness | number |
| extraversion | number |
| agreeableness | number |
| neuroticism | number |
| systemPromptAddon | string |

---

## Outputs
| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases
No explicit business use cases declared.

---

## Guardrails
> [!NOTE] No explicit guardrails declared.
