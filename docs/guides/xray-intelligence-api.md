# X-Ray Intelligence API Reference

The **X-Ray Intelligence Engine** is a stateless, high-performance structural analysis system that provides deep code insights for both the Oddjob UI and AI agents.

---

## 1. Internal Services

### `XRayIntelligenceService`
Location: `server/domain/xray/core/xray-intelligence.service.ts`

#### `findSymbols(workspacePath: string, query: string, limit?: number)`
Performs a fuzzy search across all supported source files in the workspace.
- **Returns**: `Promise<XRaySymbol[]>`
- **Logic**: Uses `ast-grep` to extract structural identifiers, then applies `fuzzysort` for weighted matching.

#### `extractAllSymbols(workspacePath: string)`
Extracts every structural token (functions, classes, routes) from the workspace.
- **Returns**: `Promise<XRaySymbol[]>`
- **Logic**: Iterates through the filesystem and applies language-specific `ast-grep` patterns.

#### `collectFiles(dir: string, depth?: number)`
Advanced recursive file collector.
- **Returns**: `Promise<string[]>`
- **Exclusions**: Automatically ignores `node_modules`, `.git`, and non-source artifacts.

---

## 2. REST API Endpoints

### `GET /api/xray/find`
Fuzzy search endpoint for the Discovery Overlay.
- **Query Params**:
  - `q`: Search string (e.g., `/api/xray/find?q=auth`)
- **Response**: `XRaySymbol[]`

### `GET /api/xray/interface`
Extracts the "API Skeleton" of a specific file.
- **Query Params**:
  - `path`: Relative path to the file (e.g., `src/routes/user.ts`)
- **Response**: `XRaySymbol[]` filtered to the target file.

---

## 3. Structural Patterns (ast-grep)

The engine currently recognizes the following structural patterns:

| Language | Category | Pattern |
| :--- | :--- | :--- |
| **TS/JS** | Function | `function $NAME($$$)` |
| **TS/JS** | Arrow Fn | `const $NAME = ($$$) =>` |
| **TS/JS** | Class | `class $NAME` |
| **TS/JS** | Interface | `interface $NAME` |
| **Express** | Route | `router.$METHOD($PATH, $$$)` |
| **ORM** | DB Call | `db.$OP($$$)` |

---

## 4. Error Handling
The X-Ray API is designed for **Resilience**:
- **Partial Indexing**: If a specific file fails to parse due to a syntax error, the engine skips it and continues indexing the rest of the workspace.
- **Zero-State**: Does not require a database. If the server restarts, intelligence is immediately available and reflects the current filesystem state.
