# JIT Tool Assembler & Dynamic Capability Framework

## Overview

Oddjob features over 330+ capability tools across 50+ domain capability modules (Git, Knowledge Graph, X-Ray, App Forge, Pipelines, Slack, etc.).

Exposing all 330+ tools simultaneously in an LLM agent prompt causes:
1. **System Prompt Bloat**: Consumes 20,000+ tokens per step.
2. **High Latency & Token Costs**: Degrades inference performance.
3. **Tool Hallucination**: Increases likelihood of the model picking incorrect tools.

The **JIT Tool Assembler** (`jit-tool-assembler.ts`) dynamically scores, filters, and ranks candidate tools per step based on user intent and domain context, returning a minimalist manifest of 3–7 tools.

---

## Architecture & API Usage

```typescript
import { assembleJITTools } from "./jit-tool-assembler.js";

// Dynamically assemble tools for a user step
const assembly = assembleJITTools(
  "I need to inspect data lineage in xray and query knowledge graph",
  {
    maxTools: 5,
    requiredToolNames: ["get_active_editor_context"],
    categoryHint: "xray knowledge",
  }
);

console.log(assembly.tools); // Array of 5 matched ToolDefinition objects
console.log(assembly.totalCandidateTools); // 339 total candidates scanned
```

### JITAssemblyOptions

| Option | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `maxTools` | `number` | Maximum number of tools to assemble for prompt | `7` |
| `requiredToolNames` | `string[]` | Tool names that MUST be included in assembled manifest | `[]` |
| `categoryHint` | `string` | Optional domain category keyword hint (e.g. `"xray"`) | `undefined` |

---

## Unit Testing

Run the Vitest test suite for the JIT Tool Assembler:

```bash
npx vitest run server/domain/tools/v1/jit-tool-assembler.test.ts
```
