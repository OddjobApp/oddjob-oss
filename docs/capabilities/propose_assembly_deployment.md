# 🛠️ Propose Scaffolding a New App From the Assembly Stack
> [!NOTE]
> **ID:** propose_assembly_deployment
> **Version:** 1.0.0
> **Manifest Schema:** 1
> **Category:** App Forge
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Proposes scaffolding a NEW forged application from the room's assembled scaffold packs. Requires a real application name — the packs describe what to build, not what to call it. Use this when asked to deploy, ship, or build out the current assembly stack. Call list_scaffold_packs first: pack ids are validated against the registry and an invented id is rejected.

---

## Inputs
| Name | Type |
|---|---|
| appName | string |
| displayName | string |
| packs | array |
| reason | string |
| publish | boolean |
| accessPolicy | enum |
| designStyleId | string |
| aiEmbellishment | string |

---

## Outputs
| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases
- None declared.

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-14]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Proposes scaffolding a NEW forged application from the room's assembled scaffold packs. Requires a real application name — the packs describe what to build, not what to call it. Use this when asked to deploy, ship, or build out the current assembly stack.` → `Proposes scaffolding a NEW forged application from the room's assembled scaffold packs. Requires a real application name — the packs describe what to build, not what to call it. Use this when asked to deploy, ship, or build out the current assembly stack. Call list_scaffold_packs first: pack ids are validated against the registry and an invented id is rejected.`
  - modified `documentation_meta.summary`: `Proposes scaffolding a NEW forged application from the room's assembled scaffold packs. Requires a real application name — the packs describe what to build, not what to call it. Use this when asked to deploy, ship, or build out the current assembly stack.` → `Proposes scaffolding a NEW forged application from the room's assembled scaffold packs. Requires a real application name — the packs describe what to build, not what to call it. Use this when asked to deploy, ship, or build out the current assembly stack. Call list_scaffold_packs first: pack ids are validated against the registry and an invented id is rejected.`

- **[Auto-Changelog 2026-08-16]** (source: code) — 4 field change(s):
  - added `inputs.accessPolicy`: `—` → `enum`
  - added `inputs.aiEmbellishment`: `—` → `string`
  - added `inputs.designStyleId`: `—` → `string`
  - added `inputs.publish`: `—` → `boolean`
