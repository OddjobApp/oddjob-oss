# 📎 Get Attached File Text Content
> **Capability ID:** `get_attachment_text`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Knowledge
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

Retrieve the full extracted text content of an attached file (PDF, DOCX, Markdown, CSV, etc.) to read requirements, form fields, schemas, or specifications. Pass either attachmentId or fileName.

---

## Inputs

| Name | Type |
|---|---|
| attachmentId | number |
| fileName | string |
| maxChars | number |
| offset | number |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE] No specific business use cases declared.
