# Autonomous OpenAPI Connector Synthesizer Engine (Level 4/5 Production)

> **Feature Status:** Level 4 / Level 5 Production-Grade  
> **Module Path:** `server/domain/capabilities/core/`, `server/domain/capabilities/routes/`  
> **API Base Route:** `/api/oddjob/capabilities`

---

## Overview

The **Autonomous OpenAPI Connector Synthesizer Engine** ingests OpenAPI v3 specifications, Swagger JSON/YAML, or raw REST endpoint definitions and automatically synthesizes production TypeScript Node.js HTTP request client handlers with authentication header injection (Bearer, API Key, Basic), compiles ACDD `CapabilityManifest` schemas, and auto-enrolls new tool connectors directly into the active `capabilityRegistry`.

---

## Core Capabilities

### 1. OpenAPI Spec Ingestion & HTTP Handler Synthesizer
- **Service:** [api-connector-synthesizer.service.ts](../../server/domain/capabilities/core/api-connector-synthesizer.service.ts)
- **Description:** Parses paths, HTTP methods (`GET`, `POST`, `PUT`, `DELETE`), headers, parameters, and request body schemas to synthesize executable Node.js HTTP client request handlers (`executeConnector`).

### 2. ACDD Capability Manifest & Tool Registry Auto-Enrollment
- **Service:** [api-connector-synthesizer.service.ts](../../server/domain/capabilities/core/api-connector-synthesizer.service.ts)
- **Description:** Compiles ACDD `CapabilityManifest` specs and Zod input validation schemas, auto-enrolling the newly synthesized connector tool into `capabilityRegistry` for live agent invocation.

---

## API Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/api/oddjob/capabilities/synthesize-connector` | `POST` | Ingests an OpenAPI spec or REST endpoint array, synthesizes the connector tool, and registers it into the capability router. |
