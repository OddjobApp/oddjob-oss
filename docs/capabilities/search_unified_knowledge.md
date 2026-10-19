# 🔍 Search Unified Knowledge
> **Capability ID:** `search_unified_knowledge`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Knowledge Management
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relationships (Knowledge Graph). IMPORTANT: When citing a result, copy its DOCUMENT URL exactly, including relative /knowledge/... URLs. Never invent or replace the URL's origin.

---

## Inputs

| Name | Type |
| :--- | :--- |
| `query` | `string` |
| `filter_source` | `enum` |
| `limit` | `number` |
| `before` | `string` |
| `after` | `string` |
| `since` | `string` |
| `updated_before` | `string` |
| `updated_after` | `string` |

---

## Outputs

| Name | Type |
| :--- | :--- |
| `result` | `string` |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
No business use cases declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-25]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relationships (Knowledge Graph). IMPORTANT: ALWAYS provide the direct URL (the link starting with https://) in your response if it is available in the search results. This is critical for verification.` → `Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relationships (Knowledge Graph). IMPORTANT: When citing a result, copy its DOCUMENT URL exactly, including relative /knowledge/... URLs. Never invent or replace the URL's origin.`
  - modified `documentation_meta.summary`: `Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relationships (Knowledge Graph). IMPORTANT: ALWAYS provide the direct URL (the link starting with https://) in your response if it is available in the search results. This is critical for verification.` → `Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relationships (Knowledge Graph). IMPORTANT: When citing a result, copy its DOCUMENT URL exactly, including relative /knowledge/... URLs. Never invent or replace the URL's origin.`
