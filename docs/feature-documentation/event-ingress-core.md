# Event Ingress Core (Level 3 Supervised / Beta)

> **Feature Status:** Level 3 (Supervised / Beta)  
> **Module Path:** `server/domain/signal-intelligence/`  
> **API Base Route:** `/api/oddjob/signal/ingress`

---

## Overview

The **Event Ingress Core** provides high-throughput, self-healing event stream ingestion, automated JSON/XML payload schema inference, real-time source health telemetry, and Dead-Letter Queue (DLQ) auto-healing retries for Oddjob's Decision Intelligence engine.

---

## Core Capabilities

### 1. Automated Payload Schema Inference
- **Service:** [event-schema-inferencer.service.ts](../../server/domain/signal-intelligence/core/event-schema-inferencer.service.ts)
- **Description:** Automatically samples incoming raw JSON/XML webhooks, infers JSON Schema specifications with type confidence scores, and detects real-time structural schema drift (added/removed fields and type mismatches).

### 2. Ingress Source Health Telemetry
- **Service:** [event-ingress-health.service.ts](../../server/domain/signal-intelligence/core/event-ingress-health.service.ts)
- **Description:** Monitors connection status (`healthy` | `degraded` | `offline`), tracks consecutive failure counters, p95 latency, and onboarding latency (`firstEventRouted - sourceAttached`).

### 3. Dead-Letter Queue (DLQ) Auto-Healing Handler
- **Service:** [event-dlq-auto-healer.service.ts](../../server/domain/signal-intelligence/core/event-dlq-auto-healer.service.ts)
- **Description:** Captures unroutable or malformed event ingress payloads into a structured DLQ store. Categorizes failures (`schema_mismatch`, `missing_auth`, `rate_limited`, `timeout`) and executes schema adaptation & exponential backoff retries ($N \le 5$).

---

## API Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/api/oddjob/signal/ingress/infer-schema` | `POST` | Infers JSON Schema spec from raw webhook JSON/XML string. |
| `/api/oddjob/signal/ingress/sources/health` | `GET` | Returns real-time health telemetry summary across all sources. |
| `/api/oddjob/signal/ingress/dlq/replay` | `POST` | Triggers automated DLQ schema adaptation and retry replay. |
