---
id: crew-room-collaboration-and-swarms
title: Multi-Agent Crew Room Protocols, Swarm Consensus, Topic SMEs & Hand-Raising Standards
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: HYBRID
category: 01-foundations-and-architecture
autonomy_level: L2-L4
version: 2.0.0
tags: [crew-rooms, swarms, multi-agent, blackboard, consensus, delegation, handshakes, roles, topic-smes, hand-raising]
summary: Protocols for multi-agent collaboration in Oddjob Crew Rooms, domain Subject Matter Expert (SME) topic partitioning, hand-raising protocols, shared blackboard memory synchronization, role segregation, and verified artifact handshakes.
verification_status: verified
applies_when:
  - Assembling and executing multi-agent Crew Rooms or Swarms
  - Managing shared blackboard state across multiple collaborating autonomous agents
  - Partitioning best practice documentation by domain topic to prevent agent context overload
  - Enforcing SME hand-raising and domain deferral rules in CREW discussions
do_not_use_when:
  - Executing single-agent isolated tasks where multi-role consensus is redundant
required_tools:
  - propose_crew_claim
  - propose_crew_decision
  - propose_crew_commitment
  - get_blackboard
  - update_blackboard
  - search_platform_patterns
  - get_platform_pattern
preconditions:
  - Crew Room initialized with designated roles and active tenant session
  - Blackboard memory store provisioned with ACID atomic patch locks
  - Agent cards mapped to domain SME specialties and topic affinities
approval_requirements:
  - Critical actions flagged with high blast radius require Governor role consensus or HIL approval
success_checks:
  - All contributing agents reach quorum consensus ($\ge 67\%$) before committing artifacts
  - Blackboard state mutations conform to strict JSON Patch (RFC 6902) format
  - Domain SMEs take the lead on technical topics and cite verified platform runbooks
stop_conditions:
  - Divergent cycle detection where Critic rejects Planner proposals > 3 consecutive turns
escalation:
  - Trigger HIL intervention when quorum fails or deadlock occurs
implementation_evidence:
  - server/domain/crew/
  - server/domain/swarm/
---

# Multi-Agent Crew Room Protocols, Swarm Consensus & SME Hand-Raising `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid (Agent Architects + Autonomous Swarms)` &nbsp;|&nbsp; **Classification:** Platform Architecture & Swarm Coordination

---

## 1. Crew Room Role Segregation `[🧑 Human]`

Oddjob Crew Rooms enforce separation of concerns across 4 specialized agent roles:

```mermaid
graph TD
    subgraph CrewRoom["Governed Multi-Agent Crew Room"]
        Planner["1. Planner Agent<br/>(Deconstructs Objective into Task DAG)"]
        Worker["2. Worker Agents<br/>(Specialized Execution: Code, SQL, Scrape)"]
        Critic["3. Critic / Verifier Agent<br/>(Adversarial Audit & Grounding Check)"]
        Governor["4. Governor / Policy Agent<br/>(Blast Radius & Budget Enforcement)"]
    end

    subgraph SharedMemory["Shared Blackboard & State"]
        Blackboard["Distributed Blackboard (Atomic JSON Patch)"]
        Artifacts["Verified Artifact Store"]
    end

    Planner -->|Proposes Plan| Blackboard
    Worker -->|Claims Task & Writes Output| Blackboard
    Critic -->|Audits Output & Flags Gaps| Blackboard
    Governor -->|Validates Risk & Signs Off| Artifacts
```

| Role | Core Objective | Key Tool Capabilities | Mutation Permission |
| :--- | :--- | :--- | :--- |
| **Planner** | Problem decomposition, DAG scheduling | `resolve_assembly_dag`, `propose_mission` | Writes plan nodes to blackboard |
| **Worker** | Execution of domain tasks | Code editing, SQL querying, MCP tools | Writes draft task outputs |
| **Critic** | Adversarial verification, ground truth validation | `evaluate_functional_gaps`, `run_dependency_audit` | Appends review critiques |
| **Governor** | Security boundary, spend limits, HIL gating | `propose_crew_decision`, `trigger_hil_approval` | Promotes drafts to final artifacts |

---

## 2. Topic-Based SME Partitioning & The Hand-Raising Protocol `[🤖 Agent Reference]`

To prevent prompt bloat and the "bystander effect," platform best practices are partitioned across **6 Domain SME Clusters**. Each agent carries only its domain-specific runbook index (~60–80 tokens) and operates under the **SME Hand-Raising Protocol**:

```mermaid
graph TD
    Docs["69 Platform Best Practices & Runbooks"]

    subgraph Clusters["Domain Topic Clusters"]
        Arch["🏛️ Architecture & Scalability"]
        Sec["🛡️ Security & Compliance"]
        SRE["⚡ DevOps, SRE & Recovery"]
        Growth["📈 Growth, Marketing & Ads"]
        Data["📊 Data & Knowledge Graph"]
        UI["💻 UI & Browser Automation"]
    end

    subgraph SMEs["Assigned CREW SMEs"]
        BackendDev["Backend Architect"]
        SecurityAuditor["Security Auditor"]
        ChaosEng["QA / SRE Engineer"]
        GrowthMarketer["Growth Marketer"]
        DataEng["Data Engineer"]
        FrontendDev["Frontend Engineer"]
    end

    Docs --> Arch & Sec & SRE & Growth & Data & UI
    Arch --> BackendDev
    Sec --> SecurityAuditor
    SRE --> ChaosEng
    Growth --> GrowthMarketer
    Data --> DataEng
    UI --> FrontendDev
```

### Domain SME Matrix:

| Domain SME Specialty | Core Assigned Platform Runbooks | Hand-Raising Trigger & Behavior |
| :--- | :--- | :--- |
| **Security & Compliance** | `secure-code-sandbox-and-python-runtime`, `compliance-and-audit-trails`, `escalation-and-confidence-gates`, `hil-form-schema-standards` | **Trigger:** Auth, credentials, sandbox execution, or audit logs discussed.<br/>**Behavior:** Takes lead immediately, cites security runbook, enforces non-negotiable policy constraints. |
| **DevOps & Reliability** | `agent-error-recovery`, `debugging-and-xray-playbook`, `chaos-engineering-and-fault-injection`, `dynamic-llm-routing-and-cost-arbitrage` | **Trigger:** Runtime exceptions, outages, timeouts, or debugging.<br/>**Behavior:** Takes lead immediately, prescribes exact state machine transition, backoff formula, or X-Ray triage. |
| **Architecture & Infrastructure** | `distributed-fleet-and-worker-isolation`, `zero-downtime-database-migrations`, `crew-room-collaboration-and-swarms`, `system-limits-and-quotas` | **Trigger:** Scaling, fleet worker allocation, schema migrations, or DAG assembly.<br/>**Behavior:** Takes lead immediately, prescribes zero-downtime migration steps and worker isolation boundaries. |
| **Data & Knowledge Graph** | `knowledge-graph-linking`, `multi-source-reconciliation`, `hybrid-vector-and-graph-retrieval`, `unstructured-document-parsing`, `transactional-writeback` | **Trigger:** Entity resolution, data pipelines, vector search, or database writes.<br/>**Behavior:** Takes lead immediately, defines similarity scoring thresholds and transactional writeback Sagas. |
| **Growth & Marketing** | `ai-marketing-and-ad-campaign-orchestration`, `email-marketing-and-lifecycle-automation`, `enterprise-saas-data-ingestion` | **Trigger:** Advertising, ad creative synthesis, cold email, or deliverability.<br/>**Behavior:** Takes lead immediately, prescribes OCEAN psychographic angles and DNS authentication rules. |
| **UI & Browser Automation** | `browser-automation-and-playwright-standards`, `neuro-symbolic-calculation-nodes`, `antipatterns-and-pitfalls` | **Trigger:** Web scraping, Playwright automation, or instant app assembly.<br/>**Behavior:** Takes lead immediately, defines robust selector strategies, network idle timeouts, and UI layouts. |

### The 2 Core Hand-Raising Invariants:
1. **The Leadership Invariant:** When a turn touches an agent's assigned domain, the agent MUST begin with:
   `"✋ As the [Domain] SME, I am taking the lead on this recommendation. Under platform runbook [pattern-id], we must..."`
2. **The Deferral Invariant:** When discussions focus on domains outside an agent's designated specialty, that agent MUST defer technical authority to the corresponding domain SME in the room and support them with complementary data.

---

## 3. Shared Blackboard Protocol & Memory Synchronization `[🤖 Agent Reference]`

The Crew Room blackboard functions as the single source of truth for the swarm.

### Rules of Engagement:
1. **Atomic RFC 6902 JSON Patches**:
   Agents NEVER overwrite the blackboard root. All state changes MUST be submitted via atomic JSON patch operations:
   ```json
   [
     { "op": "add", "path": "/tasks/task_03/status", "value": "IN_REVIEW" },
     { "op": "add", "path": "/artifacts/draft_report_uri", "value": "s3://oddjob-vault/reports/draft-12.md" }
   ]
   ```
2. **Task Claiming Invariant**:
   An agent must execute `propose_crew_claim` before beginning work on any task node. Double-claiming a task results in a lock collision error.
3. **No Unreviewed Commits**:
   No worker agent may mark a task `COMPLETED` without a corresponding `VERIFIED` endorsement signature from the Critic agent.

---

## 4. Consensus & Deadlock Resolution Protocol `[🧑 Human]`

```mermaid
sequenceDiagram
    autonumber
    participant Planner as Planner Agent
    participant Worker as Worker Agent (SME)
    participant Critic as Critic Agent
    participant Gov as Governor Agent
    participant Human as Human Operator (HIL)

    Planner->>Worker: 1. Assign Task DAG
    Worker->>Worker: 2. Execute Task (citing SME Runbook) & Post Draft to Blackboard
    Worker->>Critic: 3. Request Peer Review
    alt Review Passes (Confidence >= 0.85)
        Critic->>Gov: Endorse Draft as Validated
        Gov->>Gov: Verify Policy & Spending Caps
        Gov-->>Worker: Final Artifact Signed & Committed
    else Review Rejection (3 Iterations)
        Critic->>Planner: Request Plan Revision (Iteration 1..3)
        Note over Critic,Planner: Deadlock: Planner and Critic disagree 3x
        Gov->>Human: Trigger HIL Deadlock Intervention Form
        Human-->>Gov: Human Decision & Override Submitted
        Gov-->>Worker: Commit Human-Sanctioned Artifact
    end
```

---

## 5. Swarm Exit Conditions `[🤖 Agent Reference]`

A Crew Room lifecycle concludes when:
- **`ALL_TASKS_VERIFIED`**: Every DAG task is marked `COMPLETED` and endorsed by Critic + Governor.
- **`BUDGET_EXHAUSTED`**: Total token spend or wall-clock duration crosses configured limit, forcing immediate partial snapshot flush.
- **`HIL_ESCALATION`**: Irreconcilable conflict or high-risk mutation triggers user intervention modal.
