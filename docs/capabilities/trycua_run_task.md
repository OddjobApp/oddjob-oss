# 🧩 Run Computer Task

> **Capability ID:** `trycua_run_task`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Computer Use  
> **Owner:** platform  
> **Risk Profile:** High  
> **Execution Environment:** Host

---

## Overview

Give the computer-use agent a goal in plain language (e.g. 'Open linkedin.com and list my three newest notifications'). If an approved learned skill matches, it is replayed first; Gemini computer use then finishes the task from the screen. Starts immediately. May pause for a person (a login, a CAPTCHA, a confirmation before an irreversible action): the result then says what is needed and where to open the desktop. Pass previousTaskId to chain tasks: the model retains full memory of the prior task and continues from the same screen state.

---

## Inputs

| Name | Type |
| --- | --- |
| `sessionId` | `string` |
| `task` | `string` |
| `skillId` | `string` |
| `skillInputs` | `object` |
| `maxSteps` | `number` |
| `previousTaskId` | `string` |

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
