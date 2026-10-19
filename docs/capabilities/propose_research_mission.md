# 🔍 Propose Research Mission
> **Capability ID:** `propose_research_mission`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Discovery`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description
When you CANNOT answer a user's question from the knowledge base or web search, propose running a RESEARCH MISSION that investigates the question and saves the answer to the organization's knowledge base. This does NOT run anything — it creates a proposal a human must approve; on approval a research mission runs, stores its findings in the knowledge base, and posts an update to Assistant Updates when it finishes. Use this ONLY after search_unified_knowledge (and web search where available) returned nothing useful. Provide the user's question and a short reason you couldn't answer directly.

---

## Inputs

| Name       | Type     |
| :--------- | :------- |
| `question` | `string` |
| `reason`   | `string` |
| `topic`    | `string` |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.
