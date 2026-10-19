# 🛠️ Forge: Inject Build Config
> **ID:** `forge_inject_build_config`
> **Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `App Forge`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

Injects required build configuration into a forge workspace: next.config.js (with ignoreBuildErrors), tsconfig.json (with path aliases), src/lib/utils.ts (cn helper), and copies domain UI components/hooks. Call this before Docker build.

---

## Inputs

| Name | Type |
|---|---|
| slug | string |
| blueprintSlug | string |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases
No specific business use cases are documented.

---

## Guardrails
> [!NOTE] No explicit guardrails declared.
