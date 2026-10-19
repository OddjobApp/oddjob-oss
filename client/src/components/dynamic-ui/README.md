# Tokenized UI Framework

The Tokenized UI Framework is a lightweight, declarative visual rendering engine designed to replace code-centric TSX workspace generation for dynamic application dashboards. It parses serialized JSON layout schemas, executes reactive data-binding queries, intercepts write actions with Human-in-the-Loop overlays, and validates component structures using a Datalog-style compliance verification rules engine.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   App Forge Agent                      │
│     (Synthesizes JSON layout conforming to Schema)     │
└───────────────────────────┬────────────────────────────┘
                            │ (JSON Tree)
                            ▼
┌────────────────────────────────────────────────────────┐
│                 REST Database Bridge                   │
│   (Saves Token Schema inside apps.config.tokenizedUI)  │
└───────────────────────────┬────────────────────────────┘
                            │ (JSON Payload)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   DynamicUIProvider                    │
│   (Manages client variables & async REST query loop)   │
└───────────────────────────┬────────────────────────────┘
                            │ (Context UIState)
                            ▼
┌────────────────────────────────────────────────────────┐
│                  DynamicUIRenderer                     │
│    (Recursively renders layout & CSS visual variables)  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Component Catalog

* **Container**: Groups layouts, allocating padding and spacing tokens recursively.
* **Grid**: Responsive two-column flex container.
* **Card**: Bordered frame with `title` and `description` headers.
* **StatCard**: Large numeric performance metric display. Supports trend percentage comparisons.
* **DataTable**: Dynamic data table displaying arrays with Badge components and custom monospaced formatting.
* **FormInput**: Text input field mapping inputs directly to client state.
* **FormTextArea**: Rationale/note text editor for justification inputs.
* **ActionButton**: Operator event dispatch trigger with conditional disable gates.

---

## 3. Dynamic Expressions & Data-Binding

The rendering engine parses dynamic property string templates enclosed in double curly braces `{{...}}`.

### 3.1 Expression Syntax
* **Local Client State**: Retrieve form fields or variables: `{{state.selectedApp}}`
* **Query Responses**: Retrieve database/API data: `{{queries.fetchFleet.data.length}}`
* **Event Context**: Retrieve active row parameters (e.g. inside a table row click): `{{event.row.name}}`

### 3.2 Two-way Form Binding
Inputs synchronize values back to the state provider automatically using `bindToState`:
```json
{
  "id": "app-override-input",
  "type": "FormInput",
  "props": {
    "label": "Reason",
    "bindToState": "remediationNote"
  }
}
```

---

## 4. Action Dispatcher & HIL Confirmation Overlay

Dynamic components invoke actions defined via the `onClick` or `onRowClick` handlers:

### 4.1 Action Definitions
1. **setState**: Mutates local client state variables.
2. **refetchQuery**: Reloads a REST query manually.
3. **dispatchApi**: Executes a POST/GET endpoint call, automatically refreshing dependent queries on success.

### 4.2 HIL Approval Modal & Audit Logs
Actions setting `requiresApproval: true` are intercepted by the provider. The layout renders a glassmorphic confirmation modal dialog before execution:

* **Operator Approval**: Clicking confirm posts an operator audit log containing action parameters, endpoint details, and justification notes to `/api/apps/:appId/telemetry` before executing the target call.
* **Operator Rejection**: Aborts execution without emitting server mutations.

---

## 5. Neuro-Symbolic UI Verification

Before layouts are saved to the database, [verification.ts](./verification.ts) parses the schema against governance policies:

* **RULE_WRITE_JUSTIFICATION_REQUIRED**: Any `ActionButton` triggering a `POST` write operation requires a corresponding justification input field (`remediationNote` or `reason`) in the layout.
* **RULE_NON_COMPLIANT_COLOR**: Banned pure red (`#FF0000`/`red`) accents on brand themes to ensure high contrast for critical system alerts.

Non-compliant layouts are rejected on save with a `422 Unprocessable Entity` status.

---

## 6. Directory Structure

* [types.ts](./types.ts): Schema types, theme variables, and component catalog specifications.
* [DynamicUIContext.tsx](./DynamicUIContext.tsx): State, query handlers, and HIL overlay coordinators.
* [DynamicUIRenderer.tsx](./DynamicUIRenderer.tsx): Recursive component layout compiler.
* [verification.ts](./verification.ts): Rule checker for security and design constraints.
