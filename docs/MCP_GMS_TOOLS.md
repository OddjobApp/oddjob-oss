# GMS (Generative Mission Synthesis) MCP Tools - Quick Reference

## Overview
The Generative Mission Synthesis (GMS) engine provides a 4-phase pipeline for autonomously synthesizing, validating, and evolving complex multi-agent missions. These tools are exposed via the Model Context Protocol (MCP).

## The 4-Phase GMS Pipeline

### Phase 1: Neural Verification
Score existing blueprints or candidates using a trained neural network to predict success probability.

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `gms_score_blueprint` | Predict success % and identify risks | `blueprint` |
| `gms_get_status` | Check engine health and metrics | (none) |

### Phase 2: Predictive Mission Intelligence (PMI)
Synthesize new mission candidates from natural language goals using high-precision generative models.

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `gms_synthesize_missions` | Generate diverse mission blueprints | `request`, `nCandidates?`, `topK?` |

### Phase 3: Shadow Validation
Validate candidates in isolated sandbox simulations to establish ground truth data.

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `gms_shadow_validate` | Run sandbox simulations | `candidates`, `variationsPerCandidate?` |

### Phase 4: Skill Evolution & Composition
Search for, evolve, and compose reusable skills from the validated Skill Library.

| Tool | Purpose | Key Parameters |
|------|---------|---------------|
| `gms_find_skills` | Semantic search for validated skills | `query`, `limit?`, `requiredTags?` |
| `gms_evolve_skill` | Genetic algorithm skill optimization | `skillId` |
| `gms_compose_mission` | Assemble complex blueprints from skills | `goal` |

## Example Usage

### Synthesizing a New Mission
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "gms_synthesize_missions",
    "arguments": {
      "request": "Implement a full-stack e-commerce dashboard with real-time analytics",
      "nCandidates": 10,
      "topK": 3
    }
  }
}
```

### Evolving a Specific Skill
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "gms_evolve_skill",
    "arguments": {
      "skillId": "skill-123-analytics-parser"
    }
  }
}
```

## Implementation Details

### Files Modified
- `server/mcp/tools/gms.ts` - Tool definitions
- `server/mcp/handlers/gms.ts` - Handlers
- `server/mcp/handlers.ts` - Dispatcher registration
- `server/mcp/index.ts` - Server registration

### Core Engine
The GMS engine resides in `server/core/gms/` and consists of:
- **`GMSOrchestrator`**: The main entry point and lifecycle manager.
- **`PMIEngine`**: Predictive Mission Intelligence for synthesis.
- **`NeuralMissionVerifier`**: Scoring and risk assessment.
- **`ShadowOrchestrator`**: Isolated validation runner.
- **`SkillLibrary` & `EvolutionEngine`**: Skill management and genetic optimization.

### Error Handling
Standardized MCP responses:
- `{ success: true, ...data }`
- `{ success: false, error: string }`

### Telemetry
GMS operations are instrumented with OpenTelemetry spans and detailed logging for auditability and performance monitoring.
