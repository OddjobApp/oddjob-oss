# Oddjob Action Plan & Roadmap 2026

**Document Date**: May 5, 2026  
**Current Status**: Phases 1-3 Complete, Phase 4-6 In Progress  
**Next Review**: June 1, 2026

---

## Executive Summary

Oddjob has successfully completed its foundational phases (1-3), implementing cutting-edge AI research modules and platform infrastructure. The immediate focus shifts to **production hardening**, **market readiness**, and **technical debt reduction** before the Q4 2026 launch.

### Current State at a Glance

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Foundation | ✅ Complete | 100% |
| Phase 2: Advanced Research | ✅ Complete | 100% |
| Phase 3: Platform Experience | ✅ Complete | 100% |
| Phase 4: Go-to-Market | 🔄 In Progress | 65% |
| Phase 5: Scale | ⏸️ Skipped (per directive) | - |
| Phase 6: AGI Preparation | 🔄 In Progress | 40% |
| **Emerging Capabilities** | ✅ Complete | 100% |

---

## Part 1: Immediate Priorities (Next 30 Days)

### Week 1-2: Production Hardening

#### 1.1 UI/UX Technical Debt
**Priority**: P0 | **Owner**: Platform Team

| Issue | Action | Effort | Target |
|-------|--------|--------|--------|
| Monolithic Components | Refactor 5 components >700 lines | 3 days | May 12 |
| Canvas Performance | Optimize React Flow with 50+ nodes | 2 days | May 10 |
| Memory Leaks | Fix canvas component growth | 2 days | May 14 |
| Bundle Size | Code-split pipeline editor | 3 days | May 16 |

**Success Criteria**: 
- Component lines reduced by 40%
- Canvas latency <100ms with 100 nodes
- Bundle size reduced by 30%

#### 1.2 Testing & Quality
**Priority**: P0 | **Owner**: QA Team

| Task | Current | Target | Action |
|------|---------|--------|--------|
| Test Coverage | 50% lines, 45% functions | 80% lines, 75% functions | Add integration tests |
| Browser Testing | Skipped in CI (SKIP_BROWSER=true) | Full Selenium suite | Fix CI pipeline |
| Shadow Mode | Simulated only | Real shadow forges | Implement real execution |

### Week 3-4: AI Integration Completion

#### 1.3 Connect Reasoning Router to AI Client
**Priority**: P1 | **Owner**: AI Team

Current: Reasoning router has placeholder `callReasoningModel()`  
Action: Integrate with actual AI client service  
Timeline: 3 days  
File: `server/domain/ai/core/reasoning-router.service.ts`

#### 1.4 MCP Client Node Configuration UI
**Priority**: P1 | **Owner**: Frontend Team

Create React components for:
- MCP server connection form
- Tool selection dropdown
- Parameter configuration
- Timeout settings

Timeline: 5 days

---

## Part 2: Quarterly Roadmap (Q2-Q4 2026)

### Q2 2026 (May-June): Production Readiness

```
┌─────────────────────────────────────────────────────────────────┐
│                      Q2 2026 FOCUS                               │
│                   "Production Hardening"                         │
└─────────────────────────────────────────────────────────────────┘

MAY:
┌─────────────────┬─────────────────┬─────────────────┐
│  Week 1-2       │   Week 3-4      │   Week 5        │
│                 │                 │                 │
│ UI Refactoring  │ AI Integration  │ Integration     │
│ Performance     │ Testing         │ Testing         │
│ Bug Fixes       │ Documentation   │ Release Prep    │
└─────────────────┴─────────────────┴─────────────────┘

JUNE:
┌─────────────────┬─────────────────┬─────────────────┐
│  Week 1-2       │   Week 3-4      │                 │
│                 │                 │                 │
│ Beta Launch     │ Feedback        │ Q3 Planning     │
│ 10 Customers    │ Iteration       │                 │
└─────────────────┴─────────────────┴─────────────────┘
```

**Key Deliverables**:
1. ✅ Production-hardened UI (bundle <2MB, latency <100ms)
2. ✅ Reasoning Router fully operational with real AI calls
3. ✅ MCP Client Node with full configuration UI
4. ✅ 80% test coverage across all critical paths
5. ✅ 10 beta customers onboarded

---

### Q3 2026 (July-September): Market Validation

**Theme**: *"Customer Validation & Iteration"*

| Initiative | Description | Success Metric |
|------------|-------------|----------------|
| Beta Program | 50 enterprise beta customers | 80% retention |
| Feedback Loop | Weekly customer interviews | 100+ feedback points |
| Feature Requests | Top 10 customer asks implemented | 90% satisfaction |
| Case Studies | 5 vertical success stories | Published |
| Pricing Validation | Test $300-$5,000/mo tiers | 60% conversion |

---

### Q4 2026 (October-December): Public Launch

**Theme**: *"Go-to-Market & Scale"*

#### October: Open Source Launch
- GraphRAG Engine v1.0 public release
- Apache 2.0 license finalization
- Community contributor onboarding
- GitHub stars target: 1,000

#### November: Vertical Solutions GA
- Legal Contract Review Agent
- Healthcare Clinical Decision Support
- Finance AML Surveillance
- Manufacturing Predictive Maintenance
- HR Intelligent Onboarding

#### December: Marketplace Launch
- Certified Agent Program operational
- Revenue share system active
- 50+ marketplace agents available
- First $100K revenue month

---

## Part 3: Resource Plan

### Team Growth Roadmap

| Role | Current | Q2 Need | Q3 Need | Q4 Need |
|------|---------|---------|---------|---------|
| **Platform Engineers** | 2 | 4 (+2) | 6 (+2) | 8 (+2) |
| **AI Researchers** | 2 | 3 (+1) | 4 (+1) | 5 (+1) |
| **Frontend Engineers** | 1 | 3 (+2) | 4 (+1) | 5 (+1) |
| **DevRel/Community** | 0 | 1 (+1) | 2 (+1) | 3 (+1) |
| **Sales/Customer Success** | 0 | 1 (+1) | 3 (+2) | 6 (+3) |
| **Product Designers** | 0 | 1 (+1) | 2 (+1) | 3 (+1) |
| **QA Engineers** | 0 | 1 (+1) | 2 (+1) | 3 (+1) |
| **Technical Writers** | 0 | 1 (+1) | 1 | 2 (+1) |
| **TOTAL** | **5** | **15** | **24** | **35** |

### Budget Requirements

| Category | Q2 2026 | Q3 2026 | Q4 2026 | Total 2026 |
|----------|---------|---------|---------|------------|
| **Personnel** | $450K | $600K | $750K | $1.8M |
| **Infrastructure** | $50K | $100K | $150K | $300K |
| **GPU Compute** | $30K | $60K | $100K | $190K |
| **Marketing/Launch** | $20K | $50K | $200K | $270K |
| **Legal/Compliance** | $10K | $15K | $25K | $50K |
| **Contingency (15%)** | $82K | $123K | $188K | $393K |
| **TOTAL** | **$642K** | **$948K** | **$1.413M** | **$3.003M** |

---

## Part 4: Technical Roadmap

### Immediate Technical Priorities (Next 90 Days)

```
┌─────────────────────────────────────────────────────────────────┐
│  PRIORITY MATRIX                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  HIGH IMPACT  │  AI Integration   │  UI Hardening    │           │
│  LOW EFFORT   │  (5 days)         │  (10 days)       │           │
│               │                   │                  │           │
│  ─────────────┼───────────────────┼──────────────────┼───────────│
│               │                   │                  │           │
│  HIGH IMPACT  │  Pentagonal OODA  │  Test Coverage   │           │
│  HIGH EFFORT  │  (30 days)        │  (20 days)       │           │
│               │                   │                  │           │
│  ─────────────┼───────────────────┼──────────────────┼───────────│
│               │                   │                  │           │
│  LOW IMPACT   │  Documentation    │  Refactoring     │           │
│  LOW EFFORT   │  (5 days)         │  (15 days)       │           │
│               │                   │                  │           │
│  ─────────────┼───────────────────┼──────────────────┼───────────│
│               │                   │                  │           │
│  LOW IMPACT   │  Migration Tools  │  Edge Cases      │           │
│  HIGH EFFORT  │  (30 days)        │  (20 days)       │           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Feature Completion Status

| Feature | Status | Completion % | ETA |
|---------|--------|--------------|-----|
| MCP Client Node | 🔄 Partial | 80% | May 15 |
| Reasoning Router | 🔄 Partial | 75% | May 12 |
| Pentagonal OODA | ⏹️ Not Started | 0% | June 30 |
| GraphRAG Engine | ✅ Complete | 100% | Done |
| Vertical Solutions | ✅ Complete | 100% | Done |
| Marketplace | ✅ Complete | 100% | Done |
| SLAs | ✅ Complete | 100% | Done |
| Constitutional AI | ✅ Complete | 100% | Done |

---

## Part 5: Success Metrics & KPIs

### Technical KPIs

| Metric | Current | Q2 Target | Q3 Target | Q4 Target |
|--------|---------|-----------|-----------|-----------|
| API Latency (p99) | 250ms | 150ms | 100ms | 75ms |
| Test Coverage | 50% | 80% | 85% | 90% |
| Agent Uptime | 99.5% | 99.9% | 99.95% | 99.99% |
| Bundle Size | 3MB | 2MB | 1.5MB | 1MB |
| Build Time | 5min | 3min | 2min | 1.5min |

### Business KPIs

| Metric | Current | Q2 Target | Q3 Target | Q4 Target |
|--------|---------|-----------|-----------|-----------|
| Beta Customers | 0 | 10 | 50 | 200 |
| Paying Customers | 0 | 0 | 10 | 100 |
| Agents Deployed | 0 | 100 | 500 | 2,000 |
| Monthly API Calls | 0 | 100K | 1M | 5M |
| GitHub Stars | 0 | 100 | 500 | 2,000 |
| ARR | $0 | $0 | $50K | $500K |

### Product KPIs

| Metric | Current | Q2 Target | Q3 Target | Q4 Target |
|--------|---------|-----------|-----------|-----------|
| NPS Score | N/A | 50 | 60 | 70 |
| Time to First Agent | 15min | 10min | 5min | 3min |
| Mission Success Rate | N/A | 85% | 90% | 95% |
| Customer Retention | N/A | 80% | 85% | 90% |

---

## Part 6: Risk Mitigation

### Top 5 Risks

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| **UI Performance Issues** | High | Medium | Refactor sprint, performance budgets |
| **AI Talent Shortage** | Medium | High | Remote-first, academic partnerships |
| **Competitor Feature Parity** | High | Medium | Accelerate emerging capabilities |
| **Customer Acquisition Delays** | Medium | High | PLG motion, freemium tier |
| **Technical Debt Accumulation** | Medium | Medium | 20% capacity allocation to debt |

### Contingency Plans

1. **If UI refactoring exceeds timeline**: Prioritize critical path components, defer nice-to-haves
2. **If beta feedback is negative**: Rapid iteration cycle (1-week sprints), direct customer collaboration
3. **If hiring stalls**: Contractor augmentation, outsourcing non-core features
4. **If infrastructure costs exceed budget**: Optimize with caching, implement rate limiting

---

## Part 7: Next Steps (This Week)

### Immediate Actions (May 5-12, 2025)

| Day | Action | Owner | Deliverable |
|-----|--------|-------|-------------|
| **Mon** | Prioritize Q2 OKRs | Leadership | Aligned team objectives |
| **Tue** | Begin UI refactoring | Platform Team | Refactored PipelineCanvas |
| **Wed** | Connect Reasoning Router | AI Team | Working reasoning API |
| **Thu** | MCP Client Node UI | Frontend | Configuration components |
| **Fri** | Integration test suite | QA | 10 new tests passing |

### Week 2 Commitments

1. **Platform Team**: Complete 3 component refactors
2. **AI Team**: Reasoning Router making live AI calls
3. **Frontend Team**: MCP Client Node fully configurable
4. **QA Team**: 80% coverage on critical paths

---

## Appendix A: Detailed Sprint Schedule

### Sprint 1 (May 5-19): Foundation Hardening
- UI component refactoring
- AI service integration
- Test coverage expansion
- Performance optimization

### Sprint 2 (May 20-June 2): Feature Completion
- MCP Client Node UI
- Reasoning Router operational
- Pentagonal OODA design
- Beta customer onboarding

### Sprint 3 (June 3-16): Integration & Testing
- End-to-end testing
- Load testing
- Security audit
- Documentation finalization

### Sprint 4 (June 17-30): Beta Launch
- 10 beta customers live
- Feedback collection
- Rapid iteration
- Q3 planning

---

## Appendix B: Dependency Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEPENDENCY MAP                                  │
└─────────────────────────────────────────────────────────────────┘

UI Hardening
    ├──→ Reasoning Router UI
    ├──→ MCP Client Node UI
    └──→ Beta Customer Onboarding

AI Integration
    ├──→ Pentagonal OODA Design
    ├──→ Mission Orchestration
    └──→ Beta Testing

Test Coverage
    ├──→ Production Release
    ├──→ Security Audit
    └──→ Customer Confidence

Open Source
    ├──→ Community Building
    ├──→ Talent Acquisition
    └──→ Brand Awareness
```

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | May 5, 2026 | AI Assistant | Initial draft |
| | | | |

**Next Review**: June 1, 2026  
**Status**: Draft - Pending Leadership Review

---

*This plan integrates findings from ODDJOB_STRATEGIC_ROADMAP_2026.md, PHASE4_6_IMPLEMENTATION_SUMMARY.md, EMERGING_AI_CAPABILITIES.md, and SWOT analysis.*
