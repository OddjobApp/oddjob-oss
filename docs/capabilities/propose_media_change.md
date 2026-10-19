# 🧩 Draft a Media Studio Change

> **Capability ID:** `propose_media_change`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Video Content  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Drafts a change to a Media Studio scene (its direction, plot points, shots and dialogue) about something the author marked, and returns it as a proposal card for the author to review and apply. Writes nothing to persistent storage.

---

## Inputs

| Name | Type |
| --- | --- |
| `selection` | `object` |
| `instruction` | `string` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

* **Human-in-the-Loop Scene Revision**: Allows operators or assistant directors to mark specific beats, lines, or shots in the Story Panel and request targeted rewriting without touching untouched parts of the scene.
* **Continuity Fixes**: Proposes adjustments to lighting, camera angles, or character seeds based on continuity linting or user feedback.
* **Non-Destructive Diffs**: Displays a visual diff card in the chat and studio rail, showing exactly what additions, deletions, or edits will occur before commitment.

---

## Security Guardrails

* **Idempotent & Read-Safe**: Pure drafting function with `idempotency: "read-safe"`. Does not mutate the database or trigger video rendering pipelines.
* **Digest Fingerprinting**: Captures the scene's current `baseDigest` so that if another user or process edits the scene before application, drift is detected and collision is prevented.
* **Tenant Isolation**: Validates production and scene ownership against the authenticated caller's tenant organization (`requireOrgId()`).
