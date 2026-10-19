---
id: event-driven-agent-triggers
title: "Real-Time Webhook Ingestion & Event-Driven Agent Triggers"
audience: ["AGENT_PRIMARY", "HUMAN_PRIMARY"]
badge: "AGENT_PRIMARY"
category: "02-problem-resolution-patterns"
autonomy_level: "L3-L5"
version: "1.0.0"
tags: ["webhooks", "event-driven", "triggers", "kafka", "queues", "deduplication", "async"]
summary: "Architecture and design patterns for ingesting high-velocity webhooks, deduplicating incoming events, and triggering autonomous agent missions asynchronously."
---

# Real-Time Webhook & Event-Driven Agent Triggers

> **Audience:** 🤖 Agent / Autonomous | 🧑 Human / Builder  
> **Autonomy Level:** L3 to L5  
> **Telemetry Span:** `event.webhook.trigger`

---

## 1. Architectural Flow

Handling external webhooks (e.g. *Stripe Payment Success*, *GitHub Pull Request Opened*, *Kafka IoT Sensor Alert*) requires an asynchronous event pipeline. Synchronously running LLM agent turns inside an HTTP webhook endpoint causes timeout failures ($> 5\text{s}$).

```mermaid
graph TD
    Source[External Provider / Stripe / GitHub / Kafka] --> IngestHTTP[Edge Ingestion Webhook Endpoint]
    
    IngestHTTP --> HMACCheck{HMAC Signature Valid?}
    HMACCheck -- Invalid --> Reject[401 Unauthorized]
    
    HMACCheck -- Valid --> DeDupe{Redis Event De-duplication<br/>Key: event_id:timestamp}
    DeDupe -- Duplicate --> AckDuplicate[200 OK - Already Queued]
    
    DeDupe -- Unique --> Enqueue[Push Job to BullMQ / Redis Stream]
    Enqueue --> ImmediateAck[202 Accepted (< 25ms)]
    
    subgraph Asynchronous Worker Mesh
        Enqueue --> Worker[Oddjob Background Agent Worker]
        Worker --> ContextInject[Fetch Organization Knowledge Context]
        ContextInject --> ExecuteMission[Execute Autonomous Agent Mission]
        ExecuteMission --> UpdateRecord[Persist Results to Database & Telemetry]
    end
```

---

## 2. Event Deduplication Pattern

To prevent duplicate webhook processing during network retries:

```typescript
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

export async function isEventDuplicate(
  provider: string,
  eventId: string,
  ttlSeconds: number = 86400 // 24 hours
): Promise<boolean> {
  const key = `webhook:dedup:${provider}:${eventId}`;
  // SET key 1 EX ttl NX returns "OK" if key did not exist, null if it did
  const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
  return result === null; // True if duplicate
}
```

---

## 3. Webhook Controller Implementation

```typescript
import { Request, Response } from "express";
import { isEventDuplicate } from "./deduplication.service.js";
import { queueMissionExecution } from "@domain/mission/core/mission-queue.js";

export async function handleGitHubWebhook(req: Request, res: Response): Promise<void> {
  const eventId = req.headers["x-github-delivery"] as string;
  const eventType = req.headers["x-github-event"] as string;

  if (!eventId || !eventType) {
    res.status(400).json({ error: "Missing required webhook headers" });
    return;
  }

  // 1. Check deduplication cache
  const duplicate = await isEventDuplicate("github", eventId);
  if (duplicate) {
    res.status(200).json({ status: "acknowledged", duplicate: true });
    return;
  }

  // 2. Enqueue background agent job
  await queueMissionExecution({
    missionType: "GITHUB_PR_CODE_REVIEW",
    organizationId: (req as any).orgId || 342,
    triggerPayload: {
      eventId,
      eventType,
      body: req.body,
    },
    priority: "HIGH",
  });

  // 3. Return immediate 202 Accepted
  res.status(202).json({
    status: "queued",
    eventId,
    message: "Agent mission queued for asynchronous execution.",
  });
}
```

---

## 4. Operational Invariants

1. **Sub-50ms Response Time:** Webhook listener endpoints must acknowledge within 50ms.
2. **Dead-Letter Queue:** If the background agent worker fails after 3 retries, the payload is forwarded to `webhook_dlq` for forensic analysis.
3. **Payload Sanitization:** Scrub authorization tokens from incoming headers before serializing to disk or logging to telemetry.
