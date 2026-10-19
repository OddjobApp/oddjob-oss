# Autoresearch Engine (Level 4 Delegated / Production)

> **Feature Status:** Level 4 (Delegated / Production)  
> **Module Path:** `server/domain/self-improvement/`  
> **API Base Route:** `/api/oddjob/self-improvement/tournament`

---

## Overview

The **Autoresearch Engine** provides multi-agent parallel competition, synthetic peer-critique evaluation, Elo rating leaderboards, and autonomous academic research paper synthesis (`RESEARCH_PAPER_<id>.md`) for Oddjob's self-evolving platform.

---

## Core Capabilities

### 1. Multi-Agent Tournament Evaluation Engine
- **Service:** [autoresearch-tournament.service.ts](../../server/domain/self-improvement/autoresearch-tournament.service.ts)
- **Description:** Executes parallel round-robin matches across rival hypothesis candidates (Control vs Challengers), collecting peer-critique scores ($S \in [0, 1]$), latency, and updating standard Elo ratings.

### 2. Autonomous Research Agenda & Paper Synthesizer
- **Service:** [autoresearch-paper-synthesizer.service.ts](../../server/domain/self-improvement/autoresearch-paper-synthesizer.service.ts)
- **Description:** Automatically compiles peer-reviewed academic markdown research papers (`docs/research-papers/RESEARCH_PAPER_<id>.md`) containing Abstract, Leaderboard, Peer Critique Matrix, and Production Promotion Directives.

---

## API Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/api/oddjob/self-improvement/tournament/run` | `POST` | Executes a multi-agent tournament across hypotheses and publishes a research paper. |
| `/api/oddjob/self-improvement/tournament/papers` | `GET` | Lists all published academic research papers in `docs/research-papers/`. |
