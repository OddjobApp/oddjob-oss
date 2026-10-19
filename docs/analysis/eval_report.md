# Detailed Observability Evaluation Report
**Date:** 2/12/2026, 8:49:02 PM

## Summary
| Component | Status | Duration |
|-----------|--------|----------|
| Alert Configuration | ❌ FAIL | 1835ms |
| Audit Logging | ❌ FAIL | 1808ms |
| Authentication System | ❌ FAIL | 1802ms |
| Credentials System | ❌ FAIL | 1792ms |
| CURL / API Jobs | ❌ FAIL | 1836ms |
| Datasets | ❌ FAIL | 1858ms |
| Enterprise Features | ❌ FAIL | 1782ms |
| Ephemeral Concierge | ❌ FAIL | 2808ms |
| Error Diagnosis System | ❌ FAIL | 1682ms |
| Forensic Logging | ❌ FAIL | 1785ms |
| HIL (Human in the Loop) Forms | ❌ FAIL | 1864ms |
| Job Type Execution | ❌ FAIL | 1772ms |
| Knowledge Extraction | ❌ FAIL | 1798ms |
| Knowledge Graph | ❌ FAIL | 1789ms |
| MCP Server | ❌ FAIL | 2848ms |
| Core Observability (Tracing & Logging) | ❌ FAIL | 1944ms |
| OpenAPI Job Configuration | ❌ FAIL | 1802ms |
| Pipeline Execution | ❌ FAIL | 1526ms |
| Pipeline Variable Resolution | ✅ PASS | 1098ms |
| RAG (Retrieval Augmented Generation) | ❌ FAIL | 1759ms |
| Scheduler & Cron | ❌ FAIL | 1739ms |
| Universal Analyst Search | ❌ FAIL | 2366ms |
| Fine-tuning / Learning Loop | ❌ FAIL | 1775ms |
| Webhooks | ❌ FAIL | 1741ms |

## Detailed Output
### Alert Configuration
**Command:** `npx tsx eval_alerts.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_alerts.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Audit Logging
**Command:** `npx tsx eval_audit.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_audit.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Authentication System
**Command:** `npx tsx eval_authentication.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_authentication.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Credentials System
**Command:** `npx tsx eval_credentials.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_credentials.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### CURL / API Jobs
**Command:** `npx tsx eval_curl.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_curl.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Datasets
**Command:** `npx tsx eval_datasets.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_datasets.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Enterprise Features
**Command:** `npx tsx eval_enterprise_features.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_enterprise_features.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Ephemeral Concierge
**Command:** `npx tsx eval_ephemeral_concierge.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_ephemeral_concierge.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Error Diagnosis System
**Command:** `npx tsx eval_error_diagnosis.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_error_diagnosis.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Forensic Logging
**Command:** `npx tsx eval_forensic.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_forensic.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### HIL (Human in the Loop) Forms
**Command:** `npx tsx eval_hil_forms.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_hil_forms.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Job Type Execution
**Command:** `npx tsx eval_job_types.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_job_types.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Knowledge Extraction
**Command:** `npx tsx eval_knowledge_extraction.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_knowledge_extraction.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Knowledge Graph
**Command:** `npx tsx eval_knowledge_graph.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_knowledge_graph.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### MCP Server
**Command:** `npx tsx eval_mcp.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_mcp.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Core Observability (Tracing & Logging)
**Command:** `npx tsx eval_observability.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_observability.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### OpenAPI Job Configuration
**Command:** `npx tsx eval_openapi.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_openapi.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Pipeline Execution
**Command:** `npx tsx eval_pipeline_execution.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_pipeline_execution.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Pipeline Variable Resolution
**Command:** `npx tsx eval_pipeline_variables.ts`
**Status:** Pass

```text
🧠 Starting Pipeline Variable Resolution Evaluation...

======================================================================

📋 Test: Basic Step Output Resolution
--------------------------------------------------
[Variable Resolver] Resolving {{step.0.output}}: length=65
   ✅ Step 0 Output (0ms)
[Variable Resolver] Resolving {{step.1.output}}: length=51
   ✅ Step 1 Output (0ms)

📋 Test: Named Step Resolution
--------------------------------------------------
[Variable Resolver] Resolving {{step.fetch_data.output}}: length=26
   ✅ Named Step Output (0ms)

📋 Test: Context Data Resolution
--------------------------------------------------
   ✅ Data apiKey (0ms)
   ✅ Data baseUrl (0ms)

📋 Test: Nested Object Path Resolution
--------------------------------------------------
   ✅ Nested config.timeout (0ms)
   ✅ Nested config.retries (0ms)

📋 Test: Multiple Variables
--------------------------------------------------
   ✅ Multiple Variables (0ms)

📋 Test: Environment Variables
--------------------------------------------------
   ✅ Env NODE_ENV (0ms)

📋 Test: Missing Variable Handling
--------------------------------------------------
   ✅ Missing Variable (0ms)

📋 Test: Job Config Resolution
--------------------------------------------------
[Variable Resolver] Resolving {{step.0.output}}: length=65
   ✅ Job Config Resolution (0ms)

📋 Test: Special Cases
--------------------------------------------------
   ✅ No Variables (0ms)
   ✅ Empty String (0ms)

======================================================================
📊 PIPELINE VARIABLE RESOLUTION SUMMARY
======================================================================

   Total Tests: 13
   Passed: 13
   Failed: 0
   Pass Rate: 100.0%
   Total Duration: 0ms

======================================================================
🎉 EVALUATION PASSED: Variable resolution system is working correctly!
======================================================================
```

### RAG (Retrieval Augmented Generation)
**Command:** `npx tsx eval_rag_quality.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_rag_quality.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Scheduler & Cron
**Command:** `npx tsx eval_scheduler.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_scheduler.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Universal Analyst Search
**Command:** `npx tsx eval_search.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_search.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Fine-tuning / Learning Loop
**Command:** `npx tsx eval_training.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_training.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

### Webhooks
**Command:** `npx tsx eval_webhooks.ts`
**Status:** Fail

```text
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1

Error: Command failed: npx tsx eval_webhooks.ts
server/db.ts:6
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
        ^

Error: DATABASE_URL must be set. Did you forget to provision a database?
    at <anonymous> (server/db.ts:6:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:665:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)

Node.js v22.21.1
```

