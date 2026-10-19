# 🛠️ Draft an agent

> **Capability ID:** `propose_agent`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Drafts an agent from a description, or a change to an existing one, and shows it as a card the person applies. Writes nothing: no agent is created and no permission is granted until they apply it. The card says what the agent will be able to do, what a run will cost, and what it still needs — a tool it has not been given, an approval policy, a model. Use this whenever someone asks for a bot, an assistant or an agent that does something, rather than describing what you would build.

---

## Inputs

| Name | Type |
| --- | --- |
| `instruction` | `string` |
| `agentId` | `number` |
| `name` | `string` |
| `tools` | `array` |
| `topics` | `array` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.
