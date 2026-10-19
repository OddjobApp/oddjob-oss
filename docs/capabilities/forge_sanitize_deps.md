# 🛡️ Forge: Sanitize Dependencies
> **ID:** forge_sanitize_deps
> **Version:** 1.0.0
> **Schema:** 1
> **Category:** App Forge
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Strips AI-hallucinated or internal packages from a forge workspace's package.json. Uses the blueprint as the source-of-truth allowlist, supplemented by known-safe library versions. Call this after AI codegen and before Docker build.

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
No explicit business use cases declared.

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.
