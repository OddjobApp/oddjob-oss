# Oddjob Skill Integration System — Technical Specification

## Overview

The **Skill Integration System** enables Oddjob to ingest external AI skill bundles (from Claude, ChatGPT, OpenClaw, skills.sh, ClawHub, and GitHub) and intelligently decide whether each skill should **augment an existing agent** or **provision a new specialized agent**.

---

## 1. Core Architecture

```
                       ┌─────────────────────────┐
                       │ External Skill Package  │
                       │ (Markdown / ZIP / URL)  │
                       └────────────┬────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │   Skill Import Service  │
                       │   - URL/ZIP/MD Analysis │
                       │   - AST / Persona / Tool│
                       │   - Security Scanning   │
                       └────────────┬────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │  Skill Decision Engine  │
                       │  - Capability Overlap   │
                       │  - Persona Alignment    │
                       │  - Tool Compatibility   │
                       │  - Risk Assessment      │
                       └────────────┬────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │ (Compatibility Score: 0 - 100)    │
                  ▼                                   ▼
        Score >= 80 (Augment)                Score < 40 (Create New)
   ┌───────────────────────────────┐   ┌───────────────────────────────┐
   │ Skill Augmentation Service    │   │ Skill Provision Service       │
   │ - Merges capabilities/tools   │   │ - Creates standalone agent    │
   │ - Enforces <= 20 cap limit    │   │ - Registers draft job         │
   │ - Captures rollback snapshot  │   │ - Binds to intent router      │
   └───────────────────────────────┘   └───────────────────────────────┘
```

---

## 2. Decision Scoring Model

The compatibility score ($0–100$) between an incoming skill and each existing tenant Agent Card is computed across four weighted dimensions:

| Dimension | Max Points | Evaluation Heuristics |
|---|---|---|
| **Capability Overlap** | **25 pts** | Exact string matching plus stemmed morphological token Jaccard similarity. |
| **Persona Alignment** | **25 pts** | Matches `personaType`, `topicAffinities`, `intentAffinities`, and `soulArchetype`. |
| **Tool Compatibility** | **25 pts** | Evaluates tool set overlap, synergies, and agent card capacity limits ($\le 30$ tools). |
| **Risk Assessment** | **25 pts** | Inverse security weighting ($25$ low risk, $15$ med, $5$ high, docking for secrets). |

### Threshold Actions
- **$\ge 80$**: `augment_existing` — Recommends merging into the highest-scoring Agent Card.
- **$60–79$**: `assign_multiple` — Recommends relevant agents for operator review.
- **$40–59$**: `hybrid` — Recommends targeted capability merge or specialized variant.
- **$< 40$**: `create_new_agent` — Recommends provisioning a standalone Agent Card.

---

## 3. Database Schema

- **`skill_reviews`**: Records review submissions, compatibility scores, AI recommendations, security reports, and reviewer decisions.
- **`skill_augmentations`**: Records each augmentation with capability diffs, tools added, and exact `rollback_snapshot`.
- **`skill_review_assignments`**: Assigns reviewers with due dates and SLA tracking.
- **`skill_assignments`**: Maps skills to agents or standalone jobs.

---

## 4. Governed Ontology Integration

- **Virtual Object Types**: `Skill` and `AgentCard` registered in `ONTOLOGY_ADAPTERS`.
- **Governed Actions**:
  - `AugmentAgentCard` (`write`, `requiresApproval: true`, `riskLevel: high`)
  - `AssignSkill` (`write`, `requiresApproval: false`, `riskLevel: low`)
- **Link Types**: `Skill --augments--> AgentCard` (`many_to_many`).

---

## 5. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/admin/skills/evaluate` | Evaluates compatibility of a skill against org agents. |
| `POST` | `/api/admin/skills/reviews` | Submits a skill for governance review. |
| `GET` | `/api/admin/skills/reviews` | Lists pending or completed skill reviews. |
| `POST` | `/api/admin/skills/reviews/:id/decision` | Processes approval, rejection, or augmentation. |
| `POST` | `/api/admin/skills/augmentations/:id/rollback` | Restores Agent Card from rollback snapshot. |
| `GET` | `/api/admin/skills/augmentations/agent/:agentCardId` | Lists all augmentations for an Agent Card. |
