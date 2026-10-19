# 🔧 Forge: Validate Workspace
> **ID**: `forge_validate_workspace`
> **Version**: `1.0.0`
> **Schema**: `1`
> **Category**: `App Forge`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

## Description

Pre-flight validation of a forge workspace before Docker build. Checks for required files (package.json, Dockerfile, next.config.js, tsconfig.json, src/lib/utils.ts, pages/index.tsx), build scripts, core dependencies, and ignoreBuildErrors config. Returns a list of issues if any are found.

---

## Inputs

| Name | Type |
| :--- | :--- |
| slug | string |

---

## Outputs

| Name | Type |
| :--- | :--- |
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

*   No explicit business use cases declared.
