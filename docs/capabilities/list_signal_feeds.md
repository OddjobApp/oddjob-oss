# 🛠️ List Signal Feeds

> **Capability ID:** `list_signal_feeds`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

List the signal feeds configured for this organization — what events Signal Studio can already see, with each feed's name, source type, URL, status, and last successful poll. Call this before proposing a new source: the feed may already exist. To add one, mount_signal_studio opens the studio's Sources tab.

---

## Inputs

_None._

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
