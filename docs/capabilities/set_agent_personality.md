# 🎭 Set Agent Personality
> **ID:** `set_agent_personality`
> **Version:** `1.0.0`
> **Schema:** `1`
> **Category:** `Admin: Personality`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Updates the OCEAN traits, archetype, and/or system prompt override for an agent or app deployment. You can pass a named archetype (which auto-fills OCEAN values) or specify individual traits. Changes take effect on the next agent execution. Super Admin only.

---

## Inputs

| Name | Type |
|---|---|
| agentDeploymentId | number |
| appDeploymentId | number |
| archetype | string |
| openness | number |
| conscientiousness | number |
| extraversion | number |
| agreeableness | number |
| neuroticism | number |
| systemPrompt | string |

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

No explicit business use cases declared.
