# 🚀 Apply an approved gallery migration
> **Capability ID:** `apply_gallery_migration`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** App Forge
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Applies a migration previously proposed for this app, verifies the result, and rolls the whole thing back if verification fails. Requires the snapshot id returned by propose_gallery_migration.

---

## Inputs

| Name | Type |
|---|---|
| appId | number |
| snapshotId | string |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE]
> No explicit business use cases declared.
