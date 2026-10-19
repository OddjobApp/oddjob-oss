# 🌐 Computer Use With Replay & Teach-a-Task

> **Capability ID:** `computer_use_replay`  
> **Capability Version:** `1.1.0`  
> **Manifest Schema:** `v1`  
> **Category:** Browser Automation  
> **Owner:** Computer Intelligence  
> **Risk Profile:** High  
> **Execution Environment:** Ephemeral Sandbox

---

## Overview

Observe and operate a computer session through governed actions while preserving a replayable execution trace. Supports interactive human demonstration recording (Teach-a-Task), in-chat slash command initiation (`/teach`), Socratic parameter clarification, and automated runtime schema generation.

Provides a controlled fallback for systems without suitable APIs, records observations and actions for inspection, and enables agents to replay verified workflows autonomously.

---

## Inputs

| Name | Type |
| --- | --- |
| `objective` | `string` |
| `session_id` | `string \| null` |
| `allowed_actions` | `string[]` |
| `approval_policy` | `string \| null` |
| `skill_id` | `string \| null` |
| `skill_inputs` | `object \| null` |

## Outputs

| Name | Type |
| --- | --- |
| `session_id` | `string` |
| `task_id` | `integer` |
| `status` | `string` |
| `replay_events` | `object[]` |
| `artifacts` | `object[]` |
| `learned_skill_id` | `string \| null` |

---

## Business Use Cases

- Complete operational work in legacy or browser-only systems without public APIs.
- Demonstrate complex browser workflows via in-chat `/teach` mode and auto-convert into parameterized, reusable skills.
- Resolve visual CAPTCHAs, 2FA, and OTP challenges directly in-chat via Inline Approval cards without navigating away.
- Replay and inspect verified sequences of computer actions taken by an agent with step-by-step element resolution.
- Clarify ambiguous task parameters with human operators via Good Question Engine Socratic FormAgent cards.
- Automatically index learned skills into the organizational Knowledge Garden for future RAG navigation.

---

## Security Guardrails

> [!WARNING]
> Computer-use sessions must run in the configured isolated environment (Docker container per tenant org).

> [!WARNING]
> Credential entry (passwords, 2FA, OTP, payment cards) is strictly redacted at recording time and yields control to human operators.

> [!WARNING]
> Interactive approvals are required for destructive, external, or financially impactful actions.

> [!WARNING]
> Runtime input arguments are strictly validated against dynamic Zod schemas (`buildRuntimeInputSchema`) before replay.

---

## Dependencies

- `trycua`
- `governor`
- `credentials`
- `knowledge`
- `audit`
- `good-question-engine`
