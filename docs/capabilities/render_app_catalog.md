# 🛍️ Render App Catalog

> [!NOTE]
> **ID:** `render_app_catalog`
> **Version:** `1.0.0`
> **Manifest Schema:** `1`
> **Category:** `Rich UI`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

Present MULTIPLE apps or workspaces as an interactive catalog grid in the assistant chat. ALWAYS use this instead of listing apps in prose when there are 2 or more matching results (e.g. user asks for 'Dispatcher apps' and 3 exist). Each item in the catalog renders as a rich product card the user can click to open. Use list_installed_apps first to get the exact slugs and hrefs, then pass each result as an item here. Do NOT use this for a single app — use render_app_surface for that.

---

### Inputs

| Name        | Type   |
| :---------- | :----- |
| `title`     | string |
| `description` | string |
| `items`     | array  |

---

### Outputs

| Name     | Type   |
| :------- | :----- |
| `result` | string |

---

### Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

### Business Use Cases

> [!NOTE]
> No explicit business use cases declared.
