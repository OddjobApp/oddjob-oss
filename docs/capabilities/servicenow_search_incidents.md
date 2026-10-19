# 🔍 Search ServiceNow Incidents
> **ID:** `servicenow_search_incidents`
> **Version:** `1.0.0`
> **Manifest Schema:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Search ServiceNow incidents using encoded query syntax (e.g. 'active=true^priority=1', 'state=2^assigned_toISEMPTY', 'short_descriptionLIKEvpn').

---

## Inputs

| Name  | Type   |
|-------|--------|
| query | string |
| limit | number |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.
