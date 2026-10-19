# Missions Development Roadmap

This document outlines the planned features and improvements for the Oddjob Missions system, organized by priority and implementation order.

## Phase 1: Foundation & Stability ✅ COMPLETED

| Feature | Status | Files Modified |
|---------|--------|----------------|
| MCP Mission Tools Expansion | ✅ Done | `server/mcp/tools/missions.ts`, `handlers/missions-enhanced.ts` |
| HIL Approval Email Fix | ✅ Done | `dynamic-orchestrator.service.ts`, `mission-reporting.service.ts` |
| Mission Blackboard Unified | ✅ Done | All orchestrators now merge mission.blackboard |
| Rolling Wave Null Fix | ✅ Done | `rolling-wave-orchestrator.service.ts` |
| Mission Timeout Service | ✅ Done | `mission-timeout.service.ts` |
| Mission Status MCP Tool | ✅ Done | `get_mission_status` tool |
| Auto-Checkpoint Before Tools | ✅ Done | `dynamic-orchestrator.service.ts` |

## Phase 2: Observability & Debugging 🔄 CURRENT

### 2.1 Mission Replay System ✅ COMPLETED
**Purpose**: Enable debugging and recovery by replaying missions from checkpoints

**Components**:
- ✅ `mission-replay.service.ts` - Core replay logic
- ✅ `get_mission_replay_history` - List checkpoints
- ✅ `replay_mission_from_checkpoint` - Create replay run
- ✅ `compare_mission_runs` - Diff two runs
- ✅ `get_mission_execution_heatmap` - Time analysis
- ✅ Tests - Full test coverage
- ✅ Documentation - Feature guide
- ⏳ UI Components - Replay visualization (deferred)

**Implemented**:
- Unit tests for all replay methods
- Integration with checkpoint system
- MCP tool handlers
- Feature documentation

### 2.2 Structured Logging with Correlation IDs ✅ COMPLETED
**Purpose**: Trace mission execution across services

**Implementation**:
- ✅ Create correlation ID service
- ✅ Add correlation tracking to missions
- ✅ Propagate through event stream
- ✅ Add to mission-run.service logs
- ⏳ UI: Filter logs by correlation ID (deferred)

**Files**:
- ✅ `mission-correlation.service.ts` - Core correlation tracking

### 2.3 Mission Debug Mode ✅ COMPLETED
**Purpose**: Step-through debugging for missions

**Features**:
- ✅ Pause before each tool execution
- ✅ Inspect blackboard state at breakpoints
- ✅ Modify parameters mid-flight
- ✅ Step over/into/continue controls
- ✅ Debug session management

**Implementation**:
- ✅ `mission-debug.service.ts` - Core debug engine
- ✅ Debug state tracked in-memory
- ✅ Dynamic orchestrator debug pause checks
- ✅ 8 MCP tools for debug control
- ✅ `mission-debug.service.test.ts` - Unit tests
- ✅ `MISSION_DEBUG_MODE.md` - Documentation
- ⏳ UI: Debug panel with controls (deferred)

## Phase 3: Resilience & Recovery 🔄 CURRENT

### 3.1 Circuit Breaker for Tools ✅ COMPLETED
**Purpose**: Prevent cascading failures when external tools fail

**Implementation**:
- ✅ Create circuit-breaker.service.ts
- ✅ Track tool failure rates per tool
- ✅ Open circuit after N failures
- ✅ Half-open state for recovery testing
- ✅ Automatic fallback to alternatives
- ✅ 3 MCP tools for circuit management
- ✅ CircuitBreakerError class
- ✅ Event publishing

**Files**:
- ✅ `circuit-breaker.service.ts` - Core circuit breaker logic (380 lines)
- ✅ `circuit-breaker.service.test.ts` - Unit tests
- ✅ `CIRCUIT_BREAKER_SYSTEM.md` - Documentation
- ✅ MCP tool definitions and handlers
- ✅ Dispatcher cases

### 3.2 Automatic Retry with Exponential Backoff ✅ COMPLETED
**Purpose**: Handle transient failures gracefully

**Features**:
- ✅ Configurable retry attempts per tool
- ✅ Exponential backoff with jitter
- ✅ Circuit breaker integration
- ✅ Retry context and correlation tracking
- ✅ Dead letter queue for persistent failures

**Files**:
- ✅ `retry.service.ts` - Core retry logic (350+ lines)
- ✅ `retry.service.test.ts` - Unit tests
- ✅ `RETRY_SYSTEM.md` - Documentation
- ✅ 4 MCP tools for retry management
- ✅ Decorator pattern support

### 3.3 Mission State Snapshots
**Purpose**: Save full mission state for disaster recovery

**Implementation**:
- Periodic full snapshots
- Snapshot storage in S3/filesystem
- Restore from snapshot
- Cross-region snapshot replication

## Phase 4: Multi-Mission Orchestration 🔄 CURRENT

### 4.1 Mission Dependencies ✅ COMPLETED
**Purpose**: Chain missions together with dependencies

**Features**:
- ✅ Declare upstream/downstream missions
- ✅ Trigger on completion of dependencies
- ✅ Fan-out: One mission triggers multiple
- ✅ Fan-in: Multiple missions must complete before next
- ✅ Mission dependency graph with cycle detection
- ✅ Topological sort for execution order
- ✅ Dependency satisfaction checking
- ✅ Workflow creation and management

**Implementation**:
- ✅ `mission-dependencies.service.ts` - Core dependency engine (400+ lines)
- ✅ 9 MCP tools for dependency management
- ✅ Event-driven dependency resolution
- ✅ `mission-dependencies.service.test.ts` - Unit tests
- ✅ `MISSION_DEPENDENCIES.md` - Documentation

### 4.2 Mission Templates & Reusability ⏳ PENDING
**Purpose**: Create reusable mission patterns

**Implementation**:
- Template definition format
- Parameter substitution
- Template inheritance
- Template marketplace/sharing

### 4.3 Cross-Mission Communication ⏳ PENDING
**Purpose**: Share data between missions

**Features**:
- Blackboard sharing between missions
- Event-driven inter-mission communication
- Shared memory segments
- Pub/sub between missions

## Phase 5: Advanced AI Capabilities 🔄 CURRENT

### 5.1 Predictive Mission Planning ✅ COMPLETED
**Purpose**: AI suggests optimal mission structure

**Features**:
- ✅ Auto-generate pipeline sequences based on objective
- ✅ Tool selection recommendations from historical data
- ✅ Estimated completion times with confidence intervals
- ✅ Risk assessment and failure prediction
- ✅ Mission pattern matching (data processing, API integration, document generation)
- ✅ Similar mission discovery

**Implementation**:
- ✅ `predictive-planning.service.ts` - AI-powered planning engine (450+ lines)
- ✅ 6 MCP tools for planning operations
- ✅ Historical mission analysis
- ✅ Tool effectiveness scoring
- ✅ `predictive-planning.service.test.ts` - Unit tests
- ✅ `PREDICTIVE_PLANNING.md` - Documentation

### 5.2 Self-Healing Missions ✅ COMPLETED
**Purpose**: Auto-recover from common failures

**Features**:
- ✅ Pattern recognition for failure signatures
- ✅ Automatic fix application from known remedies
- ✅ Escalation to humans for novel failures
- ✅ Learning from recovery actions
- ✅ 5 built-in failure patterns (timeout, rate limit, auth, connection, resources)

**Implementation**:
- ✅ `self-healing.service.ts` - Core healing engine (400+ lines)
- ✅ 5 MCP tools for healing management
- ✅ `self-healing.service.test.ts` - Unit tests
- ✅ `SELF_HEALING_MISSIONS.md` - Documentation

### 5.3 Multi-Agent Coordination ✅ COMPLETED
**Purpose**: Specialized agents collaborate on complex missions

**Features**:
- ✅ 5 Agent roles: planner, executor, reviewer, specialist, coordinator
- ✅ Inter-agent message passing (direct & broadcast)
- ✅ Consensus building with configurable thresholds
- ✅ Conflict detection and resolution
- ✅ Task assignment and status tracking
- ✅ Multi-agent coordination statistics

**Implementation**:
- ✅ `multi-agent-coordination.service.ts` - Core engine (450+ lines)
- ✅ 10 MCP tools for agent management
- ✅ `multi-agent-coordination.service.test.ts` - Unit tests
- ✅ `MULTI_AGENT_COORDINATION.md` - Documentation

## Implementation Process

For each feature:
1. **Design**: Document the feature interface and behavior
2. **Develop**: Implement the feature
3. **Test**: Write unit, integration, and E2E tests
4. **Document**: Update API docs and user guides
5. **Review**: Validate against requirements

## Current Status

**Last Updated**: 2026-04-21
**Phase**: 2.1 Mission Replay System (IN PROGRESS)
**Next Milestone**: Complete replay system with tests
