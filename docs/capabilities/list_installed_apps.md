# 📱 List Org Apps
> **ID:** `list_installed_apps`
> **Version:** `1.0.0`
> **Schema:** `1`
> **Category:** `App Forge`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

### Description
Returns the app catalog for the current organization: installed/live App Forge deployments, active Agent AI deployments, advertised marketplace apps that can be installed, and blueprint templates that can scaffold a new app. Each item includes: slug, title, description, source ('app' | 'agent_ai' | 'blueprint'), availability ('installed' | 'advertised' | 'template'), href (the correct URL to open, install, or create the app), and any blueprint/cycle relationship metadata. ALWAYS call this before render_app_surface or render_app_catalog when recommending or opening an app, so you have the right source, slug, availability, href, blueprint, and cycle. CRITICAL: When this returns 2 or more items that match what the user asked for, you MUST call render_app_catalog immediately with all matching items — do NOT list them in prose or ask for clarification in text. The render_app_catalog tool shows them as a visual catalog grid where the user can click the one they want.

---

### Inputs
No inputs required.

---

### Outputs
| Name   | Type   |
| :----- | :----- |
| result | string |

---

### Guardrails
> [!NOTE]
> No explicit guardrails declared.

---

### Business Use Cases
No explicit business use cases declared.
