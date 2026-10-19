# 🛠️ Draft a Flow

> **Capability ID:** `propose_flow`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Drafts a flow — an ordered sequence of this organization's existing jobs — and returns it as a card for a person to create. Writes nothing; the person presses Create. Call list_jobs FIRST and name jobs from what it returns: every step must be a job that already exists, and this tool will not invent one. Use it when someone asks to build, automate or wire up a process.

Drafts a flow — an ordered sequence of this organization's existing jobs — and returns it as a card for a person to create. Writes nothing; the person presses Create. Call list_jobs FIRST and name jobs from what it returns: every step must be a job that already exists, and this tool will not invent one. Use it when someone asks to build, automate or wire up a process.

---

## Inputs

| Name | Type |
| --- | --- |
| `name` | `string` |
| `instruction` | `string` |
| `steps` | `array` |

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
