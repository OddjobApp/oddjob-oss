# ✅ Workspace Health Check

> **ID:** `workspace_health_check`
> **Version:** `1.0.0`
> **Schema:** `1`
> **Category:** `Git Workspace`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Pre-flight validation of the coding workspace. Checks: git repo exists, dependencies installed, test runner works, build compiles, lint passes. Run this BEFORE writing any code.

---

### Inputs

| Name   | Type  |
| :----- | :---- |
| checks | array |

---

### Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

### Business Use Cases

No specific business use cases declared.

---

### Guardrails

> [!NOTE]
> No explicit guardrails declared.
