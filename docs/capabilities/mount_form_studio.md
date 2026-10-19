# 🛠️ Mount Form Studio

> **Capability ID:** `mount_form_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Opens Form Studio beside the CREW conversation on one of this organization's forms: questionnaires, assessments, scorecards, intake and review forms, with their scoring, decision rules and results. Pass formId, or formName with the form's name. Mounting is read-only: it never changes or publishes the form. Changes are drafted as a diff the author applies, so do not describe a form as changed until then. Not for applications (mount_app_studio) or documents (mount_scribe_studio).

Opens Form Studio beside the CREW conversation on one of this organization's forms: questionnaires, assessments, scorecards, intake and review forms, with their scoring, decision rules and results. Pass formId, or formName with the form's name. Mounting is read-only: it never changes or publishes the form. Changes are drafted as a diff the author applies, so do not describe a form as changed until then. Not for applications (mount_app_studio) or documents (mount_scribe_studio).

---

## Inputs

| Name | Type |
| --- | --- |
| `formId` | `number` |
| `formName` | `string` |
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
