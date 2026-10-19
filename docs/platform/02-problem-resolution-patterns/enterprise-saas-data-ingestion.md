---
id: enterprise-saas-data-ingestion
title: Enterprise SaaS Data Ingestion, Webhook Verification & Normalization Patterns
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: AGENT_PRIMARY
category: 02-problem-resolution-patterns
autonomy_level: L1-L3
version: 1.0.0
tags: [saas, ingestion, webhooks, jira, slack, salesforce, servicenow, rate-limiting, normalization, graph]
summary: Resilient architectural patterns for ingesting, rate-limiting, verifying HMAC webhooks, and normalizing multi-source enterprise SaaS data into the Oddjob Knowledge Graph.
verification_status: verified
applies_when:
  - Connecting third-party SaaS connectors (Jira, Slack, Salesforce, ServiceNow, AgentMail)
  - Handling high-throughput webhooks, cursor-based pagination, and backoff retries
  - Normalizing unstructured enterprise records into canonical Knowledge Graph nodes
do_not_use_when:
  - Ingesting raw relational databases via direct SQL dumps (use SQL ingestion pipeline instead)
required_tools:
  - list_saas_connectors
  - sync_saas_connector
  - update_saas_sync_config
  - create_entity
  - create_relationship
preconditions:
  - Valid OAuth2 tokens or API credentials configured in Secret Vault
  - Target connector endpoint passes health-check ping
approval_requirements:
  - Initial SaaS connector authorization requires Workspace Admin OAuth grant
success_checks:
  - Ingestion stream records zero 429 rate-limit dropouts
  - Ingested entities link to existing Graph nodes with valid provenance metadata
stop_conditions:
  - Token expiration error (HTTP 401) or upstream API downtime (HTTP 503) > 5 retries
escalation:
  - Prompt user via HIL OAuth re-authentication modal when refresh tokens fail
implementation_evidence:
  - server/domain/integrations/
  - server/domain/knowledge/
---

# Enterprise SaaS Data Ingestion & Normalization `[🤖 AGENT]`

> **Audience:** `🤖 Agent Executable & Integration Builder` &nbsp;|&nbsp; **Classification:** Problem Resolution Pattern

---

## 1. End-to-End Ingestion & Normalization Pipeline `[🧑 Human]`

Oddjob normalizes disparate SaaS data streams into unified Knowledge Graph entities through an asynchronous, rate-limited processing pipeline:

```mermaid
graph LR
    subgraph SaaS_Sources["Enterprise SaaS Sources"]
        Jira["Jira / Confluence"]
        Slack["Slack / Teams"]
        SFDC["Salesforce CRM"]
        SNOW["ServiceNow ITSM"]
    end

    subgraph IngestionLayer["Ingestion & Rate Control"]
        Webhooks["Webhook Ingress (HMAC Verification)"]
        Poller["Cursor Poller (Token Bucket)"]
        Buffer["Dead-Letter & Staging Buffer"]
    end

    subgraph TransformationLayer["Normalization & Enrichment Layer"]
        Parser["AST & Content Extractor"]
        NER["Entity & Topic Extractor"]
        Linker["Graph Entity Resolver"]
    end

    subgraph TargetGraph["Oddjob Knowledge Graph"]
        Nodes["Entities (Incidents, Deals, People)"]
        Edges["Relationships (ASSIGNED_TO, RELATES_TO)"]
    end

    Jira & Slack --> Webhooks
    SFDC & SNOW --> Poller
    Webhooks & Poller --> Buffer
    Buffer --> Parser --> NER --> Linker
    Linker --> Nodes & Edges
```

---

## 2. Rate Limiting & Resilient Pagination Invariants `[🤖 Agent Reference]`

When pulling records via bulk or incremental REST APIs:

1. **Token Bucket Rate Limiter**:
   - Limit requests to **$\le 80\%$** of upstream provider's published maximum rate limit.
   - Example: For Salesforce (100 req/min), cap agent requests at `80 req/min` (1 req every 750ms).
2. **Deterministic Cursor Pagination**:
   - Always persist the latest `next_cursor` or `updated_at_gt` watermark in the sync state table after every page batch.
   - Never iterate unbounded loops without maximum page guards (`maxPages = 500`).
3. **Exponential Jitter Backoff**:
   - On HTTP 429 (Too Many Requests), extract `Retry-After` header. If missing, apply exponential backoff with full jitter:
     $$T_{\text{wait}} = \min(60, 2^{\text{attempt}} \times 0.5) + \text{random}(0, 1)$$

---

## 3. Webhook HMAC Security Verification `[🧑 Human]`

Every inbound SaaS webhook MUST verify cryptographic authenticity before payload deserialization:

```typescript
import crypto from "node:crypto";

export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headerSignature: string,
  secretKey: string
): boolean {
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(rawBody)
    .digest("hex");
  
  const expectedSignature = `v0=${computedHash}`;
  
  // Timing-safe equal comparison prevents timing attack vectors
  return crypto.timingSafeEqual(
    Buffer.from(headerSignature, "utf-8"),
    Buffer.from(expectedSignature, "utf-8")
  );
}
```

---

## 4. Entity Normalization & Graph Mapping Contract `[🤖 Agent Reference]`

All inbound records must be mapped into canonical Knowledge Graph nodes conforming to the standard schema:

| SaaS Source Record | Canonical Graph Type | Standard Properties | Primary Relationships |
| :--- | :--- | :--- | :--- |
| **Jira Issue / Bug** | `ENTITY:WORK_ITEM` | `title`, `key`, `priority`, `status`, `severity` | `REPORTED_BY` $\rightarrow$ `User`<br/>`BLOCKS` $\rightarrow$ `WorkItem` |
| **Slack Message** | `ENTITY:CONVERSATION_EVENT` | `channelId`, `authorId`, `timestamp`, `text` | `MENTIONS` $\rightarrow$ `User`<br/>`IN_THREAD` $\rightarrow$ `Conversation` |
| **Salesforce Deal** | `ENTITY:OPPORTUNITY` | `amount`, `stage`, `closeDate`, `account` | `OWNED_BY` $\rightarrow$ `User`<br/>`ASSOCIATED_WITH` $\rightarrow$ `Organization` |
| **ServiceNow Incident** | `ENTITY:INCIDENT` | `number`, `impact`, `urgency`, `state`, `cmdbCi` | `AFFECTS` $\rightarrow$ `Service`<br/>`ASSIGNED_TO` $\rightarrow$ `User` |
