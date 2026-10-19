# 🧩 Mount App Studio (Forge / Builder)

> **Capability ID:** `mount_app_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** App Forge  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Forms, with their scoring, decisions and results, open in Form Studio through mount_form_studio.

Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Forms, with their scoring, decisions and results, open in Form Studio through mount_form_studio.

---

## Inputs

| Name | Type |
| --- | --- |
| `mode` | `enum` |
| `appId` | `number` |
| `appName` | `string` |
| `view` | `enum` |
| `title` | `string` |
| `requirements` | `string` |
| `jobId` | `string` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-09-12]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work.` → `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Form Studio (forms, scoring, decisions, results) is a different studio that cannot be mounted in the room yet; point the user to Forms at /armory/forms instead.`
  - modified `documentation_meta.summary`: `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work.` → `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Form Studio (forms, scoring, decisions, results) is a different studio that cannot be mounted in the room yet; point the user to Forms at /armory/forms instead.`

- **[Auto-Changelog 2026-09-12]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Form Studio (forms, scoring, decisions, results) is a different studio that cannot be mounted in the room yet; point the user to Forms at /armory/forms instead.` → `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Forms, with their scoring, decisions and results, open in Form Studio through mount_form_studio.`
  - modified `documentation_meta.summary`: `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Form Studio (forms, scoring, decisions, results) is a different studio that cannot be mounted in the room yet; point the user to Forms at /armory/forms instead.` → `Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appId or appName. Use mode 'forge' to open the build surface for a NEW application, which attaches to a running forge job when one exists. Mounting is read-only: it never starts, rebuilds or deploys anything. Prefer 'builder' whenever the request concerns an app that already exists, because regenerating a working app discards the author's work. Not for forms: App Studio builds applications. Forms, with their scoring, decisions and results, open in Form Studio through mount_form_studio.`
