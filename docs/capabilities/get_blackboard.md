# 📝 Get Blackboard
> **ID:** get_blackboard | **Version:** 1.0.0 | **Schema:** 1 | **Category:** Collaboration | **Owner:** platform | **Risk:** Low | **Environment:** Host

Retrieve the current content of the shared mission blackboard. By default, large fields (tool outputs) are truncated for stability. Use 'keys' to read specific large values.

---

## Inputs

| Name         | Type    |
|--------------|---------|
| keys         | array   |
| includeLarge | boolean |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE] No specific business use cases declared.
