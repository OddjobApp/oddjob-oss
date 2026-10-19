# 🛠️ Mount Agent Studio

> **Capability ID:** `mount_agent_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Opens Agent Studio beside the CREW conversation on one of this organization's agents: what it is, the model it runs on, the tools it may call, what it reads, and how it has performed. Pass agentId, or agentName with the agent's name; with neither, it opens on a new draft. Mounting changes nothing — an agent is changed by drafting with propose_agent and a person applying the card. Not for jobs or missions.

---

## Inputs

| Name | Type |
| --- | --- |
| `agentId` | `number` |
| `agentName` | `string` |
| `view` | `enum` |

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
