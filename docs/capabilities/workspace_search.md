# 🔍 Search Code

> **ID**: `workspace_search`
> **Version**: `1.0.0`
> **Manifest Schema**: `1`
> **Category**: `Git Workspace`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

## Description

Search for a text pattern or regex across the workspace codebase. Returns matching lines with file paths and line numbers. Excludes node_modules, .git, dist, .next.

---

## Inputs

| Name | Type |
|---|---|
| pattern | string |
| path | string |
| file_pattern | string |
| max_results | number |

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

> [!NOTE] No business use cases declared.
