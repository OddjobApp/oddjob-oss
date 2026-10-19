# ⏱️ simulate_network_latency

> **ID:** `simulate_network_latency`
> **Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

## Description

Simulates controlled network latency on an upstream service to test timeout handling and circuit breakers.

---

## Inputs

| Name | Type |
|---|---|
| targetService | string |
| addedLatencyMs | number |
| durationSeconds | number |

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

* None.
