# 🚀 Deploy Forged Application
> **ID:** `deploy_forged_app`  
> **Version:** `2.0.0`  
> **Schema:** `2`  
> **Category:** System Utilities  
> **Owner:** App Platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Production Edge / Host Container  

---

## Description
Deploys an application blueprint, draft, or Builder Studio customization into production with active routing, enterprise access governance, release versioning, and iframe embed distribution. Accessible directly via the Top-Bar Publish Action in App Builder Studio or platform APIs.

---

## Inputs

| Name | Type | Description |
|---|---|---|
| `appId` | `number` | Application database ID |
| `publicSlug` | `string` | Hyphenated edge route identifier (`/forged/:slug`) |
| `accessPolicy` | `string` | Access rule: `'public'`, `'internal_only'`, `'password'` |
| `password` | `string \| null` | Shared secret when `accessPolicy` is `'password'` |
| `versionTag` | `string` | Semantic release tag (e.g. `'v1.0.0'`) |
| `releaseNotes` | `string` | Summary of features and modifications included in release |
| `customDomain` | `string \| null` | Optional custom CNAME or domain binding |
| `isPublished` | `boolean` | Production publication flag |

---

## Outputs

| Name | Type | Description |
|---|---|---|
| `deploymentId` | `number` | Unique ID of deployment record |
| `publicUrl` | `string` | Canonical production URL (`http://domain/forged/:slug`) |
| `embedCode` | `string` | Ready-to-use HTML iframe snippet for enterprise intranets |
| `status` | `string` | Deployment state (`active`, `published`, `pending`) |
| `versionTag` | `string` | Active production release version |

---

## Business Use Cases

- One-click launch from the App Builder Studio directly into production without leaving the editing session.
- Secure internal enterprise micro-apps with Organization-Only or Passcode access policies.
- Distribute forged workflow tools into Notion, SharePoint, or internal portals via iframe embed snippets.
- Tag immutable versions for compliance auditing and rollback capability.

---

## Guardrails

> [!IMPORTANT]
> Pre-flight AST validation and health probes must succeed before an application is exposed on public routes.

> [!WARNING]
> Internal applications containing proprietary company datasets must remain restricted to `'internal_only'` or authenticated RBAC roles.
