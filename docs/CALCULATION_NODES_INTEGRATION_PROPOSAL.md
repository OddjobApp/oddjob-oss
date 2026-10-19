# Calculation Nodes Integration Proposal

**Project**: Neuro-Symbolic Knowledge Graph Calculation System
**Status**: Backend Complete, Integration Required
**Date**: August 4, 2026

## Executive Summary

The calculation nodes system provides a powerful neuro-symbolic computation engine with 7 distinct calculation types (Basic, Temporal, Probabilistic, Constraint, Graph Algorithms, ML Inference, Advanced). The backend implementation is complete with comprehensive unit tests and database migrations. However, the system is not yet integrated with the platform's API layer, UI, or documentation.

This proposal outlines the integration work required to make the calculation system fully accessible and usable across the Oddjob platform.

## Current State Assessment

### ✅ Completed Components

**Backend Implementation:**
- ✅ Calculation service with 7 calculation types (35+ operations)
- ✅ Schema definitions with 7 database migrations (0025-0031)
- ✅ Comprehensive unit tests (200+ test cases)
- ✅ Ontology adapter integration for graph discoverability
- ✅ Caching and reactive update mechanisms
- ✅ Safe formula evaluation

**Calculation Types Implemented:**
1. **Basic**: Arithmetic, aggregation, conditional, statistical
2. **Temporal**: Moving averages, YoY/MoM, CAGR, exponential smoothing
3. **Probabilistic**: Monte Carlo, Bayesian inference, confidence intervals
4. **Constraint**: Rule validation, conditional logic, policy enforcement
5. **Graph Algorithms**: PageRank, shortest path, community detection
6. **ML Inference**: Prediction, classification, anomaly detection
7. **Advanced**: Regression, forecasting, anomaly scoring

### ❌ Missing Components

**API Layer:**
- ❌ No REST API routes for calculation CRUD operations
- ❌ No GraphQL schema for calculations
- ❌ No WebSocket endpoints for real-time calculation updates
- ❌ No API authentication/authorization integration

**User Interface:**
- ❌ No calculation management UI components
- ❌ No calculation builder/editor interface
- ❌ No calculation execution monitoring
- ❌ No integration with knowledge graph visualization

**Documentation:**
- ❌ Not documented in `docs/FEATURES.md`
- ❌ No dedicated calculation nodes documentation
- ❌ No API reference documentation
- ❌ No developer guide for creating calculations

**Testing:**
- ❌ No integration tests with database
- ❌ No E2E tests for calculation workflows
- ❌ No performance benchmarks
- ❌ No load testing

## Integration Requirements

### Phase 1: API Layer (High Priority)

**REST API Routes**
Create comprehensive REST API endpoints in `server/api/routes/calculations.ts`:

```typescript
// Calculation CRUD
POST   /api/calculations              - Create calculation
GET    /api/calculations              - List calculations
GET    /api/calculations/:id          - Get calculation by ID
PUT    /api/calculations/:id          - Update calculation
DELETE /api/calculations/:id          - Delete calculation

// Calculation Execution
POST   /api/calculations/:id/execute  - Execute calculation
GET    /api/calculations/:id/history  - Get execution history
GET    /api/calculations/:id/result   - Get latest result

// Dependencies
POST   /api/calculations/:id/dependencies - Add dependency
DELETE /api/calculations/:id/dependencies/:depId - Remove dependency
GET    /api/calculations/:id/dependencies - List dependencies

// Time Series (Temporal Calculations)
POST   /api/calculations/:id/timeseries - Add time series point
GET    /api/calculations/:id/timeseries - Get time series data
GET    /api/calculations/:id/timeseries/range - Get time range

// ML Models (ML Inference)
POST   /api/ml/models                 - Register ML model
GET    /api/ml/models                 - List ML models
PUT    /api/ml/models/:id/deploy      - Deploy model version
GET    /api/ml/models/:id/metrics     - Get model performance

// Graph Algorithms
GET    /api/graph/centrality          - Get node centrality scores
GET    /api/graph/communities         - Get community detection results
GET    /api/graph/shortest-path       - Calculate shortest path
```

**GraphQL Schema**
Extend GraphQL schema to include calculation types:

```graphql
type CalculationNode {
  id: ID!
  nodeId: ID!
  operation: CalculationOperation!
  formula: String!
  inputReferences: [InputReference!]!
  status: CalculationStatus!
  cachedResult: Float
  lastCalculatedAt: DateTime
  # ... configuration fields based on operation type
}

type Query {
  calculations(organizationId: ID!): [CalculationNode!]!
  calculation(id: ID!): CalculationNode
  executeCalculation(id: ID!): CalculationResult
}

type Mutation {
  createCalculation(input: CreateCalculationInput!): CalculationNode!
  updateCalculation(id: ID!, input: UpdateCalculationInput!): CalculationNode!
  deleteCalculation(id: ID!): Boolean!
}
```

**WebSocket Integration**
Add real-time calculation updates via WebSocket:

```typescript
// Real-time calculation execution events
ws.on('calculation:started', (data) => { /* ... */ })
ws.on('calculation:completed', (data) => { /* ... */ })
ws.on('calculation:failed', (data) => { /* ... */ })
```

### Phase 2: Documentation (High Priority)

**Update docs/FEATURES.md**
Add new section "Calculation Nodes" with:
- Overview of calculation system
- Supported operation types
- Usage examples
- API references

**Create docs/CALCULATION_NODES.md**
Comprehensive documentation including:
- Architecture overview
- Calculation type reference
- Configuration guide
- Best practices
- Performance considerations

**API Reference Documentation**
Create OpenAPI/Swagger specification for calculation endpoints.

### Phase 3: User Interface (Medium Priority)

**Calculation Management UI**
Create React components in `client/src/components/calculations/`:

```typescript
// Main components
<CalculationList />           - List and filter calculations
<CalculationBuilder />        - Create/edit calculations
<CalculationExecutor />       - Execute and monitor calculations
<CalculationHistory />        - View execution history
<CalculationDependencies />   - Manage dependencies

// Type-specific builders
<TemporalCalculationBuilder />
<ProbabilisticCalculationBuilder />
<ConstraintCalculationBuilder />
<GraphAlgorithmBuilder />
<MLInferenceBuilder />
```

**Knowledge Graph Integration**
Extend knowledge graph visualization to show:
- Calculation nodes as special node type
- Dependencies as edges between nodes
- Real-time calculation results
- Execution status indicators

**Dashboard Integration**
Add calculation metrics to platform dashboard:
- Active calculations count
- Recent executions
- Failed calculations
- Performance metrics

### Phase 4: Testing (Medium Priority)

**Integration Tests**
Create integration tests in `tests/integration/calculations/`:

```typescript
// Test suites
calculation-crud.test.ts        - CRUD operations
calculation-execution.test.ts   - Execution workflows
temporal-calculations.test.ts   - Time series operations
probabilistic-calculations.test.ts - Monte Carlo/Bayesian
graph-algorithms.test.ts        - Graph operations
ml-inference.test.ts            - ML model integration
```

**E2E Tests**
Create Playwright E2E tests in `playwright-test-repo/tests/calculations/`:

```typescript
// User workflows
create-calculation.spec.ts      - Create calculation workflow
execute-calculation.spec.ts     - Execute calculation workflow
manage-dependencies.spec.ts      - Dependency management
ml-model-deployment.spec.ts     - Model deployment workflow
```

**Performance Testing**
- Benchmark calculation execution times
- Load test concurrent executions
- Memory usage profiling
- Cache effectiveness testing

## Implementation Plan

### Sprint 1: API Layer (Week 1-2)

**Week 1:**
- Create REST API routes for basic CRUD operations
- Implement calculation execution endpoint
- Add input validation and error handling
- Write API integration tests

**Week 2:**
- Create REST API routes for specialized operations (time series, ML, graph)
- Implement GraphQL schema extension
- Add WebSocket support for real-time updates
- Document API endpoints

### Sprint 2: Documentation (Week 3)

**Tasks:**
- Add calculation nodes section to `docs/FEATURES.md`
- Create comprehensive `docs/CALCULATION_NODES.md`
- Generate OpenAPI specification
- Create developer guide with examples
- Add troubleshooting section

### Sprint 3: UI Components (Week 4-5)

**Week 4:**
- Create calculation list and builder components
- Implement calculation executor with progress tracking
- Add dependency management UI
- Integrate with existing design system

**Week 5:**
- Create type-specific builders (temporal, probabilistic, etc.)
- Integrate with knowledge graph visualization
- Add calculation dashboard widgets
- Implement real-time updates via WebSocket

### Sprint 4: Testing & Polish (Week 6)

**Tasks:**
- Create integration test suite
- Implement E2E test scenarios
- Performance benchmarking
- Bug fixes and optimization
- Final documentation updates

## Technical Considerations

### Security
- Implement RBAC for calculation operations
- Validate formula expressions for security
- Rate limit calculation executions
- Audit logging for all operations

### Performance
- Optimize database queries for large calculation sets
- Implement result caching with TTL
- Background job queue for long-running calculations
- Pagination for calculation lists

### Scalability
- Support for distributed calculation execution
- Horizontal scaling of calculation workers
- Database sharding for large datasets
- CDN for static calculation results

### Error Handling
- Graceful degradation for failed calculations
- Detailed error messages for debugging
- Retry logic for transient failures
- Circuit breaker for external ML services

## Success Criteria

**Functional Requirements:**
- ✅ All calculation types accessible via API
- ✅ UI for creating and managing calculations
- ✅ Real-time execution monitoring
- ✅ Integration with knowledge graph
- ✅ Comprehensive documentation

**Non-Functional Requirements:**
- ✅ API response time < 100ms (p95)
- ✅ Support 1000+ concurrent calculations
- ✅ 99.9% uptime for calculation service
- ✅ Zero data loss for calculation results

**User Experience:**
- ✅ Intuitive calculation builder UI
- ✅ Clear error messages and guidance
- ✅ Responsive design for all screen sizes
- ✅ Accessible keyboard navigation

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Complex UI for advanced calculations | High | Progressive disclosure, templates, wizards |
| Performance issues with graph algorithms | High | Caching, async execution, result pagination |
| ML service integration complexity | Medium | Mock services, fallback to simulation |
| Database migration conflicts | Medium | Careful migration planning, rollback procedures |
| Security vulnerabilities in formula evaluation | High | Sandboxed evaluation, input validation |

## Resource Requirements

**Development:**
- 1 Senior Backend Developer (API layer)
- 1 Senior Frontend Developer (UI components)
- 1 DevOps Engineer (deployment, monitoring)
- 1 QA Engineer (testing)

**Infrastructure:**
- Additional database storage for calculation results
- Redis for caching and job queues
- Monitoring and alerting for calculation service
- Load balancer for API endpoints

## Timeline Summary

| Phase | Duration | Start | End |
|-------|----------|-------|-----|
| API Layer | 2 weeks | Week 1 | Week 2 |
| Documentation | 1 week | Week 3 | Week 3 |
| UI Components | 2 weeks | Week 4 | Week 5 |
| Testing & Polish | 1 week | Week 6 | Week 6 |
| **Total** | **6 weeks** | **Week 1** | **Week 6** |

## Next Steps

1. **Review and approve** this integration proposal
2. **Assign resources** for each sprint
3. **Set up development environment** for API layer
4. **Begin Sprint 1** with REST API implementation
5. **Weekly progress reviews** to track milestones

## Conclusion

The calculation nodes system is a powerful addition to the Oddjob platform that enables sophisticated neuro-symbolic computations. With focused effort over 6 weeks, we can fully integrate this system and make it accessible to users through a robust API, intuitive UI, and comprehensive documentation.

The phased approach ensures we deliver value incrementally while maintaining quality and managing risks effectively.
