# 🌐 API Contract Explorer & Request Playground
> **ID:** `api_contract_explorer`  
> **Version:** `1.0.0`  
> **Schema:** `1`  
> **Category:** Developer Tools / API Explorer  
> **Owner:** App Platform  
> **Risk Profile:** Low  
> **Execution Environment:** Interactive Studio Canvas  

---

## Overview

The **API Contract Explorer** provides an interactive OpenAPI 3.1 Swagger console and live request execution playground directly inside App Builder Studio. Designed specifically for headless applications, background microservices, and webhook pipelines that do not have a graphical user interface.

---

## Core Capabilities

### 1. Interactive Operations Catalog
Lists all REST endpoints defined in the application route manifest with distinct HTTP method badges:
- `GET`: Safe reads, health checks, telemetry counters.
- `POST`: Data mutations, tactical event ingestion, webhook dispatches.
- `PUT`: Resource updates and state reconciliation.
- `DELETE`: Resource teardowns.

### 2. Live Request Execution Runner ("Try It Out")
Enables developers to execute real HTTP queries directly against the active container runtime (e.g. `http://localhost:10009` or `/forged/:slug/api/...`).
- Custom request body editor with sample JSON payloads.
- Sub-millisecond latency timer (`latencyMs`).
- HTTP status code badge formatting (`200 OK`, `400 Bad Request`, `500 Error`).
- Formatted JSON response viewer with syntax highlighting.

### 3. Production cURL Generator
Instantly generates fully escaped, copy-pasteable `cURL` commands for external terminal testing or script automation.

---

## Inputs

| Name | Type | Description |
|---|---|---|
| `appId` | `number` | Application database ID |
| `endpointId` | `string` | Selected API operation |
| `method` | `string` | HTTP method (`'GET'`, `'POST'`, `'PUT'`, `'DELETE'`) |
| `path` | `string` | Endpoint URI path (`/api/health`, `/api/query`) |
| `requestBody` | `string` | Optional JSON string payload |

---

## Outputs

| Name | Type | Description |
|---|---|---|
| `status` | `number` | HTTP response status code (e.g. 200) |
| `latencyMs` | `number` | Round-trip request execution duration in milliseconds |
| `headers` | `object` | Response headers returned by container |
| `data` | `any` | Parsed JSON response payload |
