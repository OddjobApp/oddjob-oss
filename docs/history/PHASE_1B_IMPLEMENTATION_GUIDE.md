# Phase 1B Implementation Guide

**Status:** Implementation In Progress  
**Date:** June 14, 2026  
**Scope:** Container Lifecycle Management (System 3) & Port Management (System 4)

---

## 1. Quick Start

### What Has Been Built

✅ **Database Schemas** - All Phase 1B tables defined in Drizzle ORM format
✅ **Service Implementations** - Full ContainerBuilderService and PortManagerService
✅ **API Routes** - HTTP endpoints for all operations
✅ **Unit Tests** - Comprehensive test coverage for both services
✅ **Type Definitions** - TypeScript interfaces for all major types

### Next Steps

1. Run database migrations to create new tables
2. Register Phase 1B routes in main Express app
3. Deploy to staging environment
4. Run integration tests
5. Load test with 500+ concurrent operations

---

## 2. Database Setup

### Create New Tables

The following tables are created via Drizzle ORM migrations:

```sql
-- Container Lifecycle Management
CREATE TABLE container_lifecycle_log (...)
CREATE TABLE container_image_usage (...)
CREATE TABLE container_volumes (...)

-- Port Management
CREATE TABLE port_allocations (...)
CREATE TABLE port_conflicts (...)
CREATE TABLE port_pool_config (...)
```

### Run Migrations

```bash
# Generate migration from Drizzle schema
npm run db:generate

# Run migration
npm run db:migrate

# Verify tables
npm run db:push
```

### Verify Schema

```bash
psql $DATABASE_URL -c "
  SELECT tablename FROM pg_tables 
  WHERE tablename LIKE 'container_%' OR tablename LIKE 'port_%'
  ORDER BY tablename;
"
```

Expected output:
```
container_image_usage
container_lifecycle_log
container_volumes
port_allocations
port_conflicts
port_pool_config
```

---

## 3. Service Integration

### Import Services in Routes

```typescript
// server/domain/apps/routes/index.ts
import phase1bRouter from './phase-1b.route.js';

app.use('/api/phase-1b', phase1bRouter);
```

### Initialize Services on Startup

Services auto-initialize through singleton pattern:

```typescript
// Services are singletons - just import them
import { containerBuilderService } from '@server/domain/apps/infrastructure/container-builder.service.js';
import { portManagerService } from '@server/domain/apps/infrastructure/port-manager.service.js';

// Both services are ready to use immediately
```

### Configure Port Pool

Create organization-specific port pool configuration:

```typescript
import { db } from "@server/database_service";
import * as schema from "@shared/schema";

// Set up port pool for organization
await db.insert(schema.portPoolConfig).values({
  orgId: 1,
  poolStart: 10000,
  poolEnd: 15000,
  stickyAllocation: true,
  autoResolveConflicts: true,
  alertOnPoolUsagePercent: 80,
});
```

---

## 4. API Usage Examples

### Allocate Port

```bash
POST /api/phase-1b/ports/allocate
Content-Type: application/json

{
  "appId": 1,
  "instanceId": 1,
  "allocationType": "dynamic",
  "reason": "first_deploy"
}

Response:
{
  "instanceId": 1,
  "port": 10000,
  "allocationType": "dynamic",
  "allocationTime": "2026-06-14T10:00:00Z",
  "stickyReused": false
}
```

### Launch Container with Allocated Port

```bash
POST /api/phase-1b/containers/allocate-and-launch
Content-Type: application/json

{
  "appId": 1,
  "instanceId": 1,
  "image": {
    "name": "node",
    "tag": "18-alpine",
    "pullPolicy": "always"
  },
  "ports": [
    { "containerPort": 3000, "hostPort": 10000, "protocol": "tcp" }
  ],
  "env": {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info"
  },
  "resources": {
    "limits": { "memory": "512Mi", "cpu": "500m" },
    "requests": { "memory": "256Mi", "cpu": "100m" }
  },
  "healthCheck": {
    "enabled": true,
    "endpoint": "/api/health",
    "initialDelay": 10,
    "interval": 30,
    "timeout": 5,
    "unhealthyThreshold": 3,
    "healthyThreshold": 1
  }
}

Response:
{
  "success": true,
  "containerId": "abc123def456",
  "port": 10000,
  "status": "running",
  "duration": 15234  // milliseconds
}
```

### Get Port Pool Status

```bash
GET /api/phase-1b/ports/status

Response:
{
  "poolStart": 10000,
  "poolEnd": 15000,
  "totalPorts": 5001,
  "allocatedPorts": 42,
  "availablePorts": 4959,
  "utilizationPercent": 0.84
}
```

### Release Port

```bash
POST /api/phase-1b/ports/release
Content-Type: application/json

{
  "instanceId": 1
}

Response:
{
  "success": true
}
```

### Shutdown Container

```bash
POST /api/phase-1b/containers/shutdown
Content-Type: application/json

{
  "instanceId": 1,
  "timeoutSeconds": 30
}

Response:
{
  "success": true
}
```

---

## 5. Testing

### Run Unit Tests

```bash
# Run all Phase 1B tests
npm test -- port-manager.service.test.ts container-builder.service.test.ts

# Run with coverage
npm test -- --coverage port-manager.service.test.ts

# Run specific test
npm test -- --grep "should allocate port within expected range"
```

### Run Integration Tests

```bash
# Test with real Docker daemon
npm run test:integration -- phase-1b

# Test with real Redis
npm run test:integration:redis -- phase-1b

# Full stack test
npm run test:full-stack -- phase-1b
```

### Load Test

```bash
# Test concurrent port allocations (100 concurrent)
npm run load-test -- phase-1b.ports.allocate --concurrency 100 --duration 60s

# Test concurrent container creation (50 concurrent)
npm run load-test -- phase-1b.containers.create --concurrency 50 --duration 120s

# Test sustained load
npm run load-test -- phase-1b --sustained --duration 600s
```

### Stress Test

```bash
# Rapid allocate/release cycles
npm run stress-test -- phase-1b.ports --cycles 1000

# Container creation under load
npm run stress-test -- phase-1b.containers --image-pull --cycles 100
```

---

## 6. Monitoring

### Key Metrics

```prometheus
# Container Lifecycle
oddjob_container_launch_duration_ms
oddjob_container_launch_success_total
oddjob_container_launch_failed_total
oddjob_container_graceful_shutdown_total

# Port Management
oddjob_port_allocation_success_total
oddjob_port_allocation_failed_total
oddjob_port_conflict_detected_total
oddjob_port_pool_utilization_percent
```

### Log Entries

Look for these log patterns:

```
[ContainerBuilderService] Starting container creation
[ContainerBuilderService] Container created and started: <containerId>
[ContainerBuilderService] Container verified healthy

[PortManagerService] Allocating port for app <appId>
[PortManagerService] Released port <port> for instance <instanceId>
[PortManagerService] Port conflict detected on port <port>
```

### Health Checks

```bash
# Check container is running
docker ps | grep oddjob-app

# Check port is allocated
netstat -an | grep LISTEN | grep 1[0-5]...

# Check database tables
SELECT COUNT(*) FROM container_lifecycle_log;
SELECT COUNT(*) FROM port_allocations WHERE released_at IS NULL;
```

---

## 7. Configuration

### Environment Variables

```bash
# Port pool configuration
PHASE_1B_PORT_POOL_START=10000
PHASE_1B_PORT_POOL_END=15000
PHASE_1B_STICKY_ALLOCATION=true
PHASE_1B_AUTO_RESOLVE_CONFLICTS=true

# Container defaults
PHASE_1B_DEFAULT_MEMORY_LIMIT=512Mi
PHASE_1B_DEFAULT_CPU_LIMIT=500m
PHASE_1B_DEFAULT_HEALTH_CHECK_ENDPOINT=/api/health

# Timeouts
PHASE_1B_CONTAINER_STARTUP_TIMEOUT=30000  # milliseconds
PHASE_1B_LOCK_TTL=10  # seconds
```

### Redis Configuration

Port Manager uses Redis for:
- Distributed locking (atomic port allocation)
- Allocation cache (fast lookups)
- Lock timeout handling

```typescript
// Redis connection already configured via database_service.ts
// No additional setup needed
```

---

## 8. Troubleshooting

### Issue: Port Allocation Fails with "Could not acquire lock"

**Cause:** Redis connection issue or lock timeout

**Solution:**
```bash
# Check Redis connectivity
redis-cli ping

# Check for stuck locks
redis-cli get "port:allocation:lock"

# Clear stuck lock if needed
redis-cli del "port:allocation:lock"
```

### Issue: Container Creation Times Out

**Cause:** Docker image pull taking too long, or health check endpoint not responding

**Solution:**
```bash
# Check image is available locally
docker images | grep <image-name>

# Manually verify health endpoint
curl -v http://localhost:<port>/api/health

# Increase timeout in specification
{
  "healthCheck": {
    "initialDelay": 30,  // Increase from 10
    "timeout": 10        // Increase from 5
  }
}
```

### Issue: Port Conflicts Detected

**Cause:** Race condition in allocation, or stale allocation in database

**Solution:**
```bash
# Check for conflicts
curl http://localhost:3000/api/phase-1b/diagnostics/conflicts

# View port allocations
SELECT * FROM port_allocations WHERE released_at IS NULL ORDER BY allocated_at DESC;

# Release stuck allocation
UPDATE port_allocations SET released_at = NOW() WHERE port_number = <port> AND instance_id = <stale-instance>;
```

### Issue: Container Won't Start

**Cause:** Port already in use, image doesn't exist, insufficient resources

**Solution:**
```bash
# Check port is free
lsof -i :<port>

# Pull image manually
docker pull <image-name>:<tag>

# Check Docker resources
docker stats

# Check container logs
docker logs <container-id>
```

---

## 9. Rollout Plan

### Week 1: Staging Deployment
- Deploy to staging environment
- Run 500+ concurrent operations
- Monitor for 24 hours
- Check for resource leaks

### Week 2: Soft Launch
- Enable for 10% of customers
- Monitor port allocation success rate
- Track container startup times
- Watch for conflicts

### Week 3: Ramp Up
- Expand to 50% of customers
- Collect operational feedback
- Fine-tune timeouts and thresholds
- Performance optimization

### Week 4: Full Rollout
- Deploy to 100% of customers
- Monitor for 1 week
- Gather metrics and learnings
- Document best practices

---

## 10. Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Port allocation | <100ms | - |
| Container startup | <20s | - |
| Lock acquisition | <10ms | - |
| Conflict detection | <500ms | - |
| Allocation success | >99.9% | - |
| Graceful shutdown | <30s | - |

---

## 11. Security Considerations

### Privilege Escalation
- Containers run as non-root by default
- Privileged mode requires explicit opt-in
- Resource limits prevent DoS attacks

### Network Isolation
- Port binding restricted to 10000-15000 range
- Can be expanded per organization
- Firewall rules should restrict external access

### Data Persistence
- Audit trail logged to database
- All operations tracked with timestamps
- User attribution for all operations

---

## 12. Next Phase (Phase 1C)

After Phase 1B stabilizes:

- **Auto-remediation integration** with State Reconciliation
- **Metrics dashboard** in Grafana
- **Advanced conflict resolution** strategies
- **Performance optimization** for large deployments
- **Multi-region support** for port pools

---

**Status: Ready for Implementation**

For questions or issues, reference:
- PHASE_1B_CONTAINER_LIFECYCLE_SPEC.md
- PHASE_1B_PORT_MANAGEMENT_SPEC.md
- PHASE_1_TECHNICAL_INDEX.md
