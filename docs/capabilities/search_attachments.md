# 🔍 Search Attached Files
> **Capability ID:** `search_attachments`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Knowledge
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Search the files attached to this project for passages relevant to a question. Use this before answering anything about an uploaded document — it returns the actual text, with the file each passage came from, so you can cite rather than recall.

---

## Inputs

| Name           | Type      |
|----------------|-----------|
| `query`        | `string`  |
| `limit`        | `number`  |
| `thisRoomOnly` | `boolean` |

---

## Outputs

| Name     | Type     |
|----------|----------|
| `result` | `string` |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.
