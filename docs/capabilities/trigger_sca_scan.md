# 🛡️ trigger_sca_scan
> **ID:** trigger_sca_scan
> **Version:** 1.0.0
> **Manifest Schema Version:** 1
> **Category:** System Utilities
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Executes Software Composition Analysis (SCA) on dependency manifests to detect known CVEs and high-risk packages.

---

## Inputs

| Name               | Type   |
| :----------------- | :----- |
| packageJsonContent | string |
| dependencies       | object |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No specific business use cases declared.
