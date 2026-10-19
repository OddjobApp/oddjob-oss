---
id: event-stream-normalization
title: High-Velocity Event Stream Ingestion & Multi-Provider Normalization
audience: [AGENT_PRIMARY, HYBRID]
badge: AGENT_PRIMARY
category: 02-problem-resolution-patterns
autonomy_level: L3-L4
version: 1.1.0
tags: [streaming, webhooks, kafka, pubsub, normalization, dead-letter, stripe, slack, sendgrid, github]
summary: Production patterns and multi-provider payload mappings for transforming raw webhooks (Stripe, Slack, GitHub, SendGrid) into the Canonical Oddjob Event schema with deduplication and dead-letter queue routing.
---

# Event Stream Ingestion & Multi-Provider Normalization `[🤖 AGENT]`

> **Audience:** `🤖 Agent / Autonomous` &nbsp;|&nbsp; **Autonomy:** `L3 / L4` &nbsp;|&nbsp; **Layer:** `Layer 1 (Ingestion)`

---

## 1. Multi-Provider Ingestion Architecture `[🧑 Human]`

```mermaid
graph LR
    P1["Stripe Webhooks"] --> Ingest["Oddjob Ingestion Gateway"]
    P2["Slack Events"] --> Ingest
    P3["SendGrid Events"] --> Ingest
    P4["GitHub Webhooks"] --> Ingest

    Ingest --> Dedup["SHA-256 Deduplication Hash (24h Buffer)"]
    Dedup --> Parser["Provider-Specific Normalizer"]
    Parser --> Canonical["Oddjob Canonical Event Stream"]
    Parser -- Malformed --> DLQ["Dead-Letter Queue with Diagnostics"]
```

---

## 2. Multi-Provider Mapping Matrix `[🤖 Agent Reference]`

### A. Stripe Inbound Mapping
```typescript
export function normalizeStripeEvent(raw: any) {
  return {
    eventId: `stripe_${raw.id}`,
    sourceSystem: "stripe",
    eventType: raw.type, // e.g. "payment_intent.succeeded"
    occurredAt: new Date(raw.created * 1000).toISOString(),
    entityId: raw.data.object.customer || raw.data.object.id,
    payload: {
      amountCents: raw.data.object.amount,
      currency: raw.data.object.currency,
      status: raw.data.object.status
    }
  };
}
```

### B. Slack Event Mapping
```typescript
export function normalizeSlackEvent(raw: any) {
  return {
    eventId: `slack_${raw.event_id}`,
    sourceSystem: "slack",
    eventType: raw.event.type, // e.g. "app_mention" or "message"
    occurredAt: new Date(raw.event_time * 1000).toISOString(),
    entityId: raw.event.user,
    payload: {
      channel: raw.event.channel,
      text: raw.event.text,
      threadTs: raw.event.thread_ts || raw.event.ts
    }
  };
}
```

### C. SendGrid Inbound Email Mapping
```typescript
export function normalizeSendGridEvent(raw: any) {
  return {
    eventId: `sendgrid_${raw.sg_message_id}`,
    sourceSystem: "sendgrid",
    eventType: raw.event, // e.g. "delivered" or "inbound_parse"
    occurredAt: new Date(raw.timestamp * 1000).toISOString(),
    entityId: raw.email,
    payload: {
      subject: raw.subject,
      sender: raw.from,
      recipient: raw.to,
      spamScore: raw.spam_score
    }
  };
}
```
