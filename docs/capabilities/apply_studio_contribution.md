# 🛠️ Apply an Approved Contribution

> **Capability ID:** `apply_studio_contribution`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Applies a studio contribution the user approved on its card. Do not call this directly — it is called automatically by the crew service after the user clicks Apply on a StudioContributionProposalCard. If the proposal carried an applyAction, the crew service chains that tool call immediately after this one completes.

---

## Inputs

| Name | Type |
| --- | --- |
| `proposalId` | `string` |

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
