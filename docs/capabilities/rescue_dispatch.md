# 🚨 Initiate Rescue Dispatch
> **Capability ID:** rescue_dispatch
> **Capability Version:** 1.0.0
> **Manifest Schema Version:** 1
> **Category:** Rescue
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Trigger a formal rescue coordination flow. This creates a rescue session, initiates the mission, and starts the discovery/dispatch process.

---

## Inputs

| Name        | Type    |
|-------------|---------|
| serviceType | string  |
| userLat     | number  |
| userLng     | number  |
| address     | string  |
| isDemoMode  | boolean |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE]
> No specific business use cases declared.
