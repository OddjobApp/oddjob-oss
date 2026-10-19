# CREW Room Features Review

> **Review Date:** August 2026  
> **Purpose:** Comprehensive analysis of new CREW Room multi-agent discussion features

---

## Executive Summary

CREW Room is a sophisticated multi-agent discussion system that enables collaborative AI deliberation. It transforms single-agent interactions into structured debates where specialized agents respond to each other based on topic affinity, with a supervisor managing the discussion quality and consensus.

**Key Innovation:** Agents argue from their accumulated experience (knowledge graphs) rather than prompt alone, with a supervisor ensuring quality and surfacing disagreements.

---

## Core Architecture

### Database Schema (9 Tables)

| Table | Purpose | Key Features |
|-------|---------|--------------|
| `crew_sessions` | Room management | Project scoping, consensus tracking, interrupt handling |
| `crew_members` | Agent participants | Agent card membership, join timestamps |
| `crew_participants` | Human participants | Role-based access (owner/member), invitation tracking |
| `crew_turns` | Transcript | Speaker types, reply chains, tool usage, artifacts |
| `supervisor_notes` | Supervisor output | Critiques, consensus, summaries, intents, plans |
| `crew_issues` | Unresolved disagreements | Severity tracking, consensus levels, project linkage |
| `crew_intent_observations` | Learning data | Routing accuracy measurement, labeled corpus |
| `crew_hand_raises` | Agent signaling | Affinity scoring, memory hits, call-on tracking |
| `crew_plans` | Structured action plans | Step-by-step plans with owner assignment |

---

## Feature Analysis

### 1. Supervisor Service

**Purpose:** Manager that shapes discussion quality without taking sides

**Capabilities:**
- **Critique:** Challenges weak or unsupported contributions
- **Consensus:** States where agents agree vs. disagree
- **Summary:** Running account of established facts
- **Notes:** Observations worth keeping
- **Intent:** Introduces new threads of enquiry
- **Plan:** Structured steps with agent assignment
- **Directive:** What supervisor says aloud (addresses agents by @mention)

**Advanced Features:**
- **Position Extraction:** Each agent's position as a single claim with confidence
- **Consensus Calculation:** 0-100 scale of agreement
- **Divergence Questions:** Good Question Engine synthesizes discriminating questions when split
- **Stage Gating:** Creation Studio DAG integration for focused discussions
- **Entropy Measurement:** Shannon entropy over belief mass distribution

**Strengths:**
- Prevents agents from speculating without evidence
- Surface disagreements rather than burying them
- Provides structured output (plans, summaries) for downstream use

**Maturity Level:** 4 (Production)

---

### 2. Orchestrator Service

**Purpose:** Runs rounds of multi-agent discussion

**Round Flow:**
1. User speaks → Opens new round
2. Topic/intent affinity determines which agents speak
3. Sequential responses (agents see previous agents in same round)
4. Supervisor reviews entire round
5. Learning loop writes back conclusions

**Speaker Selection:**
- Based on topic/intent affinity (same classifiers as intent router)
- MAX_SPEAKERS_PER_ROUND = 3 (latency control)
- Agents see previous agents in round → argue with each other, not just user

**Agent Prompting:**
- Each agent gets its own Legend + OCEAN personality
- Recall from its own accumulated knowledge graph
- Research ladder: search_unified_knowledge → google_search → browse_web → propose_research_mission

**Restatement Detection:**
- RESTATEMENT_THRESHOLD = 0.8 (word overlap)
- Prevents agents from repeating themselves
- Only near-identical answers are filtered

**Strengths:**
- Agents argue from experience, not prompt alone
- Sequential responses enable true debate
- Research ladder prevents confident invention

**Maturity Level:** 4 (Production)

---

### 3. Memory Service

**Purpose:** Agents recall from their accumulated experience during discussion

**Key Innovation:**
- Agents accumulate experience across missions in knowledge graphs
- Crew discussions have no repository → topic is unit of context
- Recalls across every repository agent has worked in

**Scoring:**
- Semantic similarity + stored confidence + recency decay
- Consistent with AgentMemoryAcrossMissionsService
- Code-specific exact-match boost dropped (no meaning in conversation)

**Scope Handling:**
- Project Space encoded into repository_id key
- Private project conclusions don't surface in other projects
- DISCUSSION_SCOPE_PREFIX = "crew-discussion"

**Degradation:**
- Fails gracefully: no history, unavailable Qdrant, failed embedding → empty context
- Agent without recall can still speak

**Strengths:**
- Agents argue from what they've actually learned
- Project scoping maintains privacy
- Graceful degradation prevents failures

**Maturity Level:** 4 (Production)

---

### 4. Learning Service

**Purpose:** Turns finished discussions into operational output

**Three Outputs:**

1. **Knowledge Write-Back:**
   - Settled conclusions become knowledge graph entries
   - WRITE_BACK_MIN_CONSENSUS = 60 (only high-consensus conclusions)
   - Uses same storeEntry() as codegen missions
   - Embeddings + 0.85 semantic dedup included

2. **Issue Creation:**
   - Unresolved disagreements become crew_issues
   - ISSUE_MAX_CONSENSUS = 40 (low consensus + critique = issue)
   - Published as BLOCKER_CREATED on event bus
   - Severity tracking (low/medium/high)

3. **Intent Observations:**
   - Keyword classifier guess vs. actual discovered intent
   - Labeled corpus for measuring routing accuracy
   - Prompt hashing for deduplication

**Strengths:**
- Closes the learning loop (knowledge flows both ways)
- Surfaces disagreements as findings
- Improves routing accuracy over time

**Maturity Level:** 4 (Production)

---

### 5. Tools Service

**Purpose:** Exposes read-only tools for evidence citation

**Classification:**
- DEFAULT-DENY approach (only positively identifiable reads)
- READ_TOKENS: get, list, search, read, query, find, describe, discover, etc.
- WRITE_TOKENS: create, update, delete, write, post, send, publish, etc.
- DISQUALIFYING_SIDE_EFFECTS: file-system, email, webhook, container, queue-message

**Tier 2 - Artifact Tools:**
- Explicit allowlist (not heuristic)
- Tools that hand user working artifact (forms, instant apps)
- Examples: render_instant_app, assemble_instant_app, render_intake_form
- All declare riskLevel "low"

**Universal Presentation Tools:**
- Granted to EVERY crew agent regardless of card declaration
- Generic tools not bound to specific org resource
- Examples: list_instant_app_components, render_instant_app, render_intake_form

**Constraints:**
- MAX_TOOL_CALLS_PER_TURN = 3
- Research ladder enforced in prompt
- Side-effect checks prevent accidental writes

**Strengths:**
- Enables evidence-based arguments
- Prevents accidental writes during discussion
- Artifact tools enable rich responses (forms, apps)

**Maturity Level:** 4 (Production)

---

### 6. Persona Service

**Purpose:** Gives agents distinct voices via personality modeling

**Components:**
- **Legend:** First-person operational philosophy
- **OCEAN Traits:** Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism
- **Soul Archetype:** 10 canonical archetypes with mannerisms

**Archetype Profiles (Polarized Traits):**
- Tactical Analyst: o=0.55, c=0.92, e=0.25, a=0.45, n=0.35
- Strategic Oracle: o=0.88, c=0.82, e=0.40, a=0.50, n=0.30
- Creative Catalyst: o=0.95, c=0.40, e=0.82, a=0.78, n=0.30
- Data Sentinel: o=0.40, c=0.90, e=0.20, a=0.40, n=0.70
- Crisis Commander: o=0.50, c=0.88, e=0.85, a=0.32, n=0.55
- Knowledge Architect: o=0.84, c=0.86, e=0.35, a=0.80, n=0.25
- Process Engineer: o=0.45, c=0.95, e=0.28, a=0.55, n=0.40
- Innovation Director: o=0.92, c=0.60, e=0.78, a=0.72, n=0.28
- Field Operative: o=0.62, c=0.84, e=0.52, a=0.48, n=0.50
- Lead Directive: o=0.65, c=0.80, e=0.62, a=0.72, n=0.30

**Archetype Mannerisms:**
- Tactical Analyst: "Argue from evidence. Quantify claims..."
- Strategic Oracle: "Speak in second-order consequences..."
- Creative Catalyst: "Offer the unconventional option..."
- Data Sentinel: "Watch for what is missing or unverified..."
- Crisis Commander: "Drive toward a decision..."
- Knowledge Architect: "Give the discussion structure..."
- Process Engineer: "Reduce ideas to repeatable steps..."
- Innovation Director: "Push scope outward..."
- Field Operative: "Test claims against practice..."
- Lead Directive: "Keep the group oriented..."

**Auto-Inference:**
- Infers archetype from card name, description, topic/intent affinities
- Rules for dispatch, deploy, doc, qa, security, product, etc.

**Strengths:**
- Each crew member sounds different
- Reuses existing Soul layer
- Polarized traits ensure visible steering

**Maturity Level:** 4 (Production)

---

### 7. Triage Service

**Purpose:** Decides whether message deserves full multi-agent round

**Problem Solved:**
- "Hi" used to convene 3 agents + supervisor = 4 model calls
- Produced durable-looking output about nothing
- Once written back to knowledge graphs, this poisons recall

**Heuristic Scoring (Model-Free):**
- SUBSTANCE_THRESHOLD = 0.3
- Below threshold: one agent replies conversationally

**Signals (Weighted):**
1. **@mention:** Explicit request → substance = 1.0
2. **High-stakes verbs:** deploy, ship, delete, rollback → substance = 1.0
3. **Pleasantries:** hi, thanks, ok → substance = 0.0
4. **Length:** Words/25 (saturating at 1.0) → weight 0.4
5. **Substance markers:** why, how, explain, analyze → weight 0.3
6. **Domain nouns:** technical terms → weight 0.2
7. **Question marks:** Explicit questions → weight 0.1

**Modes:**
- **discussion:** Full crew round convened
- **conversational:** Single agent replies

**Strengths:**
- Prevents waste on low-value messages
- Model-free (no LLM cost for triage)
- Protects knowledge graph quality

**Maturity Level:** 4 (Production)

---

### 8. Beliefs Service

**Purpose:** Agent positions and theory-of-mind calibration

**Layer 1 - Beliefs:**
- Records what agent argued this round
- Three outcomes:
  - No prior belief → recorded fresh
  - Restating held belief → confidence reinforced
  - Contradicting held belief → old marked revised, new supersedes
- SAME_BELIEF_THRESHOLD = 0.85 (cosine similarity)
- CONTRADICTION_THRESHOLD = 0.45

**Layer 2 - Calibration:**
- Agent predicts what next speaker will argue
- Once speaker speaks, prediction is scored via embedding similarity
- False-belief test operationalized
- Distinguishes real theory-of-mind from fluent guessing

**Cost-Neutral:**
- Prediction rides along in turn agent was already taking
- Scoring uses embedding similarity (no model call)
- No additional LLM round-trips

**Strengths:**
- Enables belief revision tracking
- Measures theory-of-mind accuracy
- Zero additional cost

**Maturity Level:** 3 (Beta)

---

## Integration Points

### Creation Studio
- Stage Gating: Supervisor reports if discussion is on active unblocked stage
- Redirect signals when discussion drifts from current stage

### Intent Router
- Same keyword classifiers for speaker selection
- Intent observations improve routing accuracy over time

### Knowledge Graph
- Agents recall from their accumulated experience
- Conclusions written back to knowledge graphs
- Project scoping maintains privacy

### Event Bus
- BLOCKER_CREATED events for unresolved disagreements
- Cross-app integration for issue tracking

---

## Strengths

1. **Evidence-Based Arguments:** Agents cite from knowledge graphs, not prompt alone
2. **True Debate:** Sequential responses enable agent-to-agent argumentation
3. **Quality Control:** Supervisor prevents speculation and surfaces disagreements
4. **Learning Loop:** Knowledge flows both ways (recall + write-back)
5. **Distinct Voices:** Persona system ensures agents sound different
6. **Cost Control:** Triage prevents waste on low-value messages
7. **Privacy:** Project scoping keeps discussions isolated
8. **Theory of Mind:** Belief calibration measures agent understanding of others

---

## Areas for Enhancement

### Short-Term (Level 4 → 5)
1. **Beliefs Service:** Move from Beta to Production (more testing)
2. **Hand Raises:** Better prediction of when agents want to speak
3. **Plan Execution:** Convert supervisor plans into actual cycles/actions

### Medium-Term
1. **Cross-Crew Learning:** Share conclusions across related discussions
2. **Dynamic Speaker Selection:** Adjust MAX_SPEAKERS_PER_ROUND based on complexity
3. **Consensus Visualization:** UI for showing belief mass distribution

### Long-Term
1. **Self-Improving Triage:** ML model for substance scoring
2. **Agent Specialization:** Auto-infer optimal archetypes from performance
3. **Federated Discussions:** Cross-organization crew rooms

---

## Competitive Analysis

### Unique Differentiators
1. **Accumulated Experience:** Agents argue from knowledge graphs, not prompt alone
2. **Supervisor Quality Control:** No competitor has discussion quality manager
3. **Belief Tracking:** Theory-of-mind calibration is novel
4. **Learning Loop:** Bidirectional knowledge flow

### vs. Competitors
- **AutoGPT:** No multi-agent debate, single agent only
- **CrewAI:** Basic agent coordination, no supervisor or learning loop
- **LangGraph:** Workflow orchestration, not discussion quality
- **Multi-Agent Systems:** Research-focused, not production-ready

---

## Maturity Assessment

| Component | Level | Rationale |
|-----------|-------|-----------|
| Supervisor Service | 4 (Production) | Stable, documented, extensive testing |
| Orchestrator Service | 4 (Production) | Core functionality battle-tested |
| Memory Service | 4 (Production) | Graceful degradation, consistent with existing services |
| Learning Service | 4 (Production) | Three outputs working, event bus integration |
| Tools Service | 4 (Production) | Tiered access, safety checks validated |
| Persona Service | 4 (Production) | 10 archetypes, auto-inference working |
| Triage Service | 4 (Production) | Model-free, cost-effective, protects quality |
| Beliefs Service | 3 (Beta) | Novel feature, needs more production validation |

**Overall Maturity:** 4 (Production) with Beliefs Service at Beta

---

## Recommendation

**CREW Room is production-ready** for core multi-agent discussion use cases. The Beliefs Service should graduate to Production after additional validation, but this does not block deployment.

**Strategic Value:** High - This is a unique competitive differentiator that no competitor offers. The combination of accumulated experience, supervisor quality control, and learning loop creates a defensible moat.

**Next Priority:** Integrate CREW Room with Decision Intelligence to enable crew-based rule creation and event source configuration.
