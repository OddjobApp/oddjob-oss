---
id: compliance-and-audit-trails
title: Cryptographic Audit Trails, WORM Storage & Compliance Standards
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, GOVERNANCE]
badge: GOVERNANCE
category: 03-human-in-the-loop-governance
autonomy_level: L1-L4
version: 2.0.0
tags: [compliance, audit-trail, worm-storage, cryptography, sha256, soc2, hipaa, pii-redaction, governance]
summary: Governance standard for tamper-proof cryptographic audit trails, Write-Once-Read-Many (WORM) storage, SOC2/HIPAA compliance, and automated PII redaction filters.
verification_status: verified
applies_when:
  - Logging agent execution decisions, tool parameters, and human sign-off signatures
  - Handling sensitive customer PII, HIPAA medical records, or SOC2 financial data
  - Implementing tamper-evident audit logs with cryptographic hash chaining
do_not_use_when:
  - Ephemeral debug console logs that are purged after test runs
required_tools:
  - monitoring_trigger_alert
preconditions:
  - Immutable audit trail append-only storage volume mounted
  - PII regex and NER redaction pipeline loaded in memory
approval_requirements:
  - Accessing unmasked raw audit logs requires Security Officer dual-custody authorization
success_checks:
  - Every audit log entry contains a valid SHA-256 hash chaining to the preceding entry
  - Redaction pipeline masks 100% of detected PII (SSNs, credit cards, API keys)
stop_conditions:
  - Audit log append failure (system must fail-closed rather than executing untracked actions)
escalation:
  - Trigger immediate Security Alert to SRE HUD if audit log signature verification fails
implementation_evidence:
  - server/domain/audit/
  - server/domain/governance/
---

# Cryptographic Audit Trails & Compliance Standards `[⚖️ GOVERNANCE]`

> **Audience:** `⚖️ Governance / Chief Information Security Officer & Compliance Auditor` &nbsp;|&nbsp; **Classification:** Regulatory Compliance & Audit Standard

---

## 1. Cryptographic Hash-Chained Audit Trail Architecture `[🧑 Human]`

To satisfy SOC2 Type II, HIPAA, and ISO 27001 requirements, Oddjob implements a **Write-Once-Read-Many (WORM)** hash-chained ledger:

```mermaid
graph LR
    subgraph EventStream["Agent Action Stream"]
        Action1["1. Tool Invocation (sql_query)"]
        Action2["2. HIL Human Approval (Form Submit)"]
        Action3["3. Database Mutation (Drizzle Apply)"]
    end

    subgraph Ledger["Cryptographic Audit Ledger (WORM Storage)"]
        Block1["Audit Entry #101<br/>Hash: 0x8F3A...<br/>PrevHash: 0x4B21..."]
        Block2["Audit Entry #102<br/>Hash: 0xE19C...<br/>PrevHash: 0x8F3A..."]
        Block3["Audit Entry #103<br/>Hash: 0x77DA...<br/>PrevHash: 0xE19C..."]
    end

    Action1 --> Block1
    Action2 --> Block2
    Action3 --> Block3
    Block1 -->|Hash Chaining| Block2 -->|Hash Chaining| Block3
```

---

## 2. Mandatory Audit Envelope Schema `[🤖 Agent Reference]`

Every tool invocation and human decision MUST emit an immutable audit envelope:

```typescript
export interface AuditEnvelope {
  id: string; // UUID v4
  sequenceNumber: number;
  timestamp: string; // ISO-8601 UTC
  organizationId: string;
  projectId: string;
  userId: string; // Actor: human user or agent ID
  action: string; // e.g. "TOOL_EXECUTION:external_sql_query"
  traceparent: string; // W3C distributed tracing context
  inputPayloadRedacted: Record<string, any>;
  outputPayloadRedacted: Record<string, any>;
  metadata: {
    modelTierUsed?: string;
    tokenSpend?: number;
    blastRadiusScore?: number;
    hilApprovalSignature?: string;
  };
  previousEntryHash: string; // SHA-256 of Entry N-1
  currentEntryHash: string;  // SHA-256 of this entry
}
```

---

## 3. Automated PII & Sensitive Credential Redaction `[🤖 Agent Reference]`

Before an audit envelope is serialized to disk or indexed into OpenTelemetry:

| Sensitive Pattern | Redaction Rule | Replacement Format |
| :--- | :--- | :--- |
| **API Keys & Bearer Tokens** | Regex pattern `/(bearer|sk_live_|ghp_)[a-zA-Z0-9_\-]{16,}/i` | `"[REDACTED_API_KEY]"` |
| **Credit Card Numbers** | Luhn algorithm + PAN regex | `"************" + last4` |
| **Social Security Numbers** | Pattern `/\b\d{3}-\d{2}-\d{4}\b/` | `"[REDACTED_SSN]"` |
| **Customer Passwords** | Field name matching `password`, `secret`, `api_key` | `"[REDACTED_CREDENTIAL]"` |

---

## 4. Fail-Closed Invariant `[⚖️ GOVERNANCE]`

If the audit log service encounters a disk full, permission error, or database timeout:
- The agent execution engine MUST immediately **FAIL-CLOSED**.
- No state mutation or tool call may proceed if its corresponding audit record cannot be written and signed.
