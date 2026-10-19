# 🛠️ Verify Action Attestation

> **Capability ID:** `verify_action_attestation`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Verifies the cryptographic HMAC-SHA256 signature, expiry, and payload integrity of an AttestationToken.

Verifies the cryptographic HMAC-SHA256 signature, expiry, and payload integrity of an AttestationToken.

---

## Inputs

| Name | Type |
| --- | --- |
| `token` | `any` |
| `expectedAction` | `string` |
| `expectedPayload` | `object` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.
