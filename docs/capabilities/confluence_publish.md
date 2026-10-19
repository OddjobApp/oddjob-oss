# 📝 confluence_publish

> **Capability ID:** `confluence_publish`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `SDLC`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description

Publish or update a Confluence page (falls back to the knowledge base when Confluence is not configured).

---

## Inputs

| Name | Type |
| :--- | :--- |
| `title` | `string` |
| `content` | `string` |
| `space` | `string` |
| `pageId` | `string` |
| `parentPageId` | `string` |

---

## Outputs

| Name | Type |
| :--- | :--- |
| `result` | `string` |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE]
> No explicit business use cases declared.
