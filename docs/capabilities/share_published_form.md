# 🛠️ Share a Published Form

> **Capability ID:** `share_published_form`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Shows one of this organization's published forms in the conversation so the person can fill it in there. Pass formName with the form's name, or formId. Only published forms can be shared. The person sees the questions and the results meant for respondents, never reviewer scores, and their answers go to the form.

Shows one of this organization's published forms in the conversation so the person can fill it in there. Pass formName with the form's name, or formId. Only published forms can be shared. The person sees the questions and the results meant for respondents, never reviewer scores, and their answers go to the form.

---

## Inputs

| Name | Type |
| --- | --- |
| `formId` | `number` |
| `formName` | `string` |

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
