# 🐛 Create GitHub Issue

> **Capability ID:** `github_create_issue`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `GitHub`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Create a new issue in a GitHub repository.

---

## Inputs

| Name | Type |
| :--- | :--- |
| `owner` | `string` |
| `repo` | `string` |
| `title` | `string` |
| `body` | `string` |
| `labels` | `array` |
| `assignees` | `array` |

---

## Outputs

| Name | Type |
| :--- | :--- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
