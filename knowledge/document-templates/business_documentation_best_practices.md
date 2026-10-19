# Business Documentation Best Practices (BABOK / TOGAF Aligned)

**Standard Reference Guide:** `STD-BIZDOC-2026-v2`  
**Applies To:** Business Analysts, Enterprise Architects, Product Managers, Delivery Leads  
**Purpose:** Ensure all business and technical documentation produced in Oddjob and Scribe Studio adheres to industry best practices for clarity, completeness, MECE structuring, and verifiable acceptance.

---

## 1. Core Principles of Enterprise Business Documentation

### 1.1 The MECE Principle (Mutually Exclusive, Collectively Exhaustive)
- **Mutually Exclusive:** No two sections, work packages, or requirement statements should overlap or duplicate each other.
- **Collectively Exhaustive:** Together, the documented items must cover 100% of the target problem domain with zero omissions.

### 1.2 The Principle of Verifiable Acceptance
Every deliverable, milestone, and requirement must have an explicit, binary **Acceptance Criterion**. Avoid ambiguous language:
- ❌ *Bad:* "The system should be fast and easy to use."
- ✅ *Good:* "The API P99 latency must not exceed 200ms under 5,000 concurrent requests, and 95% of first-time users must complete onboarding within 3 minutes without support intervention."

---

## 2. Requirements Structuring Standards

### 2.1 Given-When-Then Acceptance Criteria Format
For every functional requirement, provide structured BDD scenarios:
```gherkin
Scenario: Automated Scribe Studio Mount on Document Intent
  Given a user has opened a new CREW chat room with no prior turns
  When the user submits a message with intent "Draft an SOW for Project Titan"
  Then Scribe Studio mounts with the "sow_statement_of_work" framework
  And 8 stations appear in the Vertical Subway Spine initialized with project context
```

### 2.2 Requirements Hierarchy & Traceability (RTM)
Maintain strict bidirectional traceability between business goals, functional requirements, and verification test cases:

```
[Strategic Objective]
       │
       ▼
[Business Requirement (BR-xxx)]
       │
       ▼
[Functional Requirement (FR-xxx)]
       │
       ▼
[Verification Test Case (TC-xxx)]
```

---

## 3. Financial Justification Standards
When writing business cases or proposals, always include:
1. **Total Cost of Ownership (TCO):** Direct CapEx + 3-year OpEx (hosting, maintenance, licensing, staffing).
2. **Net Present Value (NPV):** Discounted cash flows at standard hurdle rate (e.g. 8-10%).
3. **Payback Period:** Exact month in which cumulative savings exceed total initial investment.
4. **Sensitivity Analysis:** Base case vs. conservative case (-20% savings) vs. aggressive case (+20% savings).

---

## 4. Document Review & Critic Squad Governance
When authoring in Scribe Studio, assemble a multi-lens critic panel:

| Critic Persona | Focus Area | Mandatory Checkpoints |
|:---|:---|:---|
| **Commercial / Legal Counsel** | Risk allocation, indemnification, liability caps | Ensures liability is capped, change control is strict, IP is protected. |
| **Delivery Principal** | Timeline feasibility, dependencies, RACI | Validates milestone durations, staffing ratios, and external dependencies. |
| **Enterprise Architect** | Non-functional requirements, data sovereignty | Checks system integration contracts, telemetry standards, security RBAC. |
| **Quality & Governance SME** | Traceability, MECE adherence, formatting | Verifies Flesch-Kincaid readability, given-when-then criteria completeness. |

---

## 5. Document Revision & Sign-Off Checklist
Before publishing or submitting any enterprise document for executive sign-off:
- [ ] Title, document reference ID, version, and effective date are populated.
- [ ] All `{{variable_placeholders}}` have been resolved.
- [ ] Executive summary is self-contained and states the decision request upfront.
- [ ] In-scope activities and out-of-scope exclusions are explicitly separated.
- [ ] RACI matrix has exactly one **Accountable (A)** owner per deliverable.
- [ ] Multi-lens critic evaluation has been executed with zero unresolved critical conflicts.
