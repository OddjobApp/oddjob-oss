# Phase 1B Resource Guide

**Date:** June 14, 2026  
**Audience:** Engineering Team, DevOps, QA  
**Purpose:** Complete reference for implementing and testing Phase 1B

---

## 📚 Documentation Files

### Technical Specifications (Reference)
| File | Purpose | Audience |
|------|---------|----------|
| `PHASE_1B_CONTAINER_LIFECYCLE_SPEC.md` | Complete System 3 specification | Engineers |
| `PHASE_1B_PORT_MANAGEMENT_SPEC.md` | Complete System 4 specification | Engineers |
| `PHASE_1_TECHNICAL_INDEX.md` | Phase 1 overview and roadmap | Architects |

### Implementation Guides
| File | Purpose | Audience |
|------|---------|----------|
| `PHASE_1B_IMPLEMENTATION_GUIDE.md` | Step-by-step implementation | Engineers |
| `PHASE_1B_BUILD_SUMMARY.md` | Build completion summary | PMs, Leads |
| `PHASE_1B_RESOURCE_GUIDE.md` | This file - team reference | All |

---

## 📁 Code Files

### Database Schema
```
shared/schema/infrastructure/phase-1b.ts
├── Container Lifecycle Tables
│   ├── containerLifecycleLog
│   ├── containerImageUsage
│   └── containerVolumes
└── Port Management Tables
    ├── portAllocations
    ├── portConflicts
    └── portPoolConfig
```

### Services
```
server/domain/apps/infrastructure/
├── container-builder.service.ts (550 lines)
│   ├── ContainerBuilderService class
│   ├── ContainerSpec interface
│   └── ContainerCreateResult interface
└── port-manager.service.ts (450 lines)
    ├── PortManagerService class
    ├── PortAllocationRequest interface
    └── PortAllocationResult interface
```

### API Routes
```
server/domain/apps/routes/phase-1b.route.ts (250 lines)
├── POST /containers/allocate-and-launch
├── POST /ports/allocate
├── POST /ports/release
├── GET /ports/status
├── GET /ports/history/:appId
├── POST /containers/shutdown
├── POST /containers/create
└── GET /diagnostics/conflicts
```

### Tests
```
server/domain/apps/infrastructure/
├── port-manager.service.test.ts (350 lines)
│   └── 12 test suites covering all scenarios
└── container-builder.service.test.ts (400 lines)
    └── 25+ test cases covering all features
```

---

## 🎯 Quick Start Tasks

### For Engineers

#### Task 1: Environment Setup
```bash
# Verify dependencies
node --version          # Should be >=18
npm --version          # Should be >=9
docker --version       # Should be >=20
redis-cli ping         # Should respond PONG

# Install packages
npm install

# Set up database
npm run db:generate    # Generate migrations
npm run db:migrate     # Run migrations
```

#### Task 2: Run Tests
```bash
# Run unit tests
npm test -- port-manager.service.test.ts
npm test -- container-builder.service.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm test -- --watch
```

#### Task 3: Manual Integration Test
```bash
# Start server
npm run dev

# In another terminal, test allocation
curl -X POST http://localhost:3000/api/phase-1b/ports/allocate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "appId": 1,
    "instanceId": 1,
    "allocationType": "dynamic",
    "reason": "test"
  }'

# Check pool status
curl http://localhost:3000/api/phase-1b/ports/status \
  -H "Authorization: Bearer <token>"
```

#### Task 4: Docker Testing
```bash
# Verify Docker daemon running
docker ps

# Test container creation manually
docker run -d --name test-nginx -p 10000:80 nginx:latest

# Verify container is running
docker ps | grep test-nginx

# Check health
curl http://localhost:10000/

# Cleanup
docker stop test-nginx && docker rm test-nginx
```

### For DevOps

#### Task 1: Database Preparation
```bash
# Connect to database
psql $DATABASE_URL

# Verify schema created
SELECT tablename FROM pg_tables 
WHERE tablename LIKE 'container_%' OR tablename LIKE 'port_%'
ORDER BY tablename;

# Check indices
SELECT indexname FROM pg_indexes 
WHERE tablename LIKE 'container_%' OR tablename LIKE 'port_%'
ORDER BY indexname;
```

#### Task 2: Docker Configuration
```bash
# Verify Docker socket access
ls -la /var/run/docker.sock

# Test Docker API connectivity
curl -s --unix-socket /var/run/docker.sock http/v1.40/_ping

# Check available port range
netstat -an | grep LISTEN | grep 1[0-5]...
```

#### Task 3: Redis Configuration
```bash
# Verify Redis connection
redis-cli ping

# Check available memory
redis-cli info memory | grep used_memory_human

# Monitor operations
redis-cli monitor
```

#### Task 4: Resource Monitoring
```bash
# Check system resources
df -h              # Disk space
free -h            # Memory
top -b -n 1        # CPU usage

# Monitor Docker
docker stats --no-stream
```

### For QA

#### Task 1: Test Plan Execution
```bash
# 1. Basic functionality tests
- Allocate port ✓
- Release port ✓
- Create container ✓
- Shutdown container ✓
- Get pool status ✓

# 2. Error handling tests
- Invalid port number ✗
- Non-existent instance ✗
- Concurrent allocations ✗
- Docker failure ✗

# 3. Performance tests
- 100 concurrent allocations
- 50 concurrent container creations
- Rapid allocate/release cycles

# 4. Integration tests
- State Reconciliation integration
- Health Check Service integration
- Metrics export
```

#### Task 2: Load Testing Setup
```bash
# Install load testing tools
npm install -D artillery k6

# Run baseline load test
artillery quick --count 10 --num 100 http://localhost:3000/api/phase-1b/ports/status

# Run sustained load test
k6 run load-test-phase-1b.js
```

#### Task 3: Monitoring Setup
```bash
# Verify Prometheus scraping
curl http://localhost:9090/api/v1/targets

# Check Grafana dashboard
# Navigate to http://localhost:3000/d/phase-1b

# Verify alerting
# Check Alert Manager at http://localhost:9093
```

---

## 🔧 Common Commands

### Database Operations
```bash
# View container lifecycle logs
SELECT * FROM container_lifecycle_log ORDER BY operation_timestamp DESC LIMIT 10;

# View active port allocations
SELECT instance_id, port_number, allocation_type, allocated_at 
FROM port_allocations WHERE released_at IS NULL;

# Find port conflicts
SELECT * FROM port_conflicts WHERE resolved = false;

# Clean up old logs (after 4 weeks)
DELETE FROM container_lifecycle_log 
WHERE operation_timestamp < NOW() - INTERVAL '4 weeks';
```

### Docker Operations
```bash
# List all Oddjob containers
docker ps -a | grep oddjob-app

# View container logs
docker logs <container_id>

# Inspect container
docker inspect <container_id>

# Stop all containers
docker stop $(docker ps -q --filter "label=app=*")

# Clean up stopped containers
docker container prune -f
```

### Redis Operations
```bash
# Check lock status
redis-cli get "port:allocation:lock"

# View allocation cache
redis-cli keys "port:allocations:*"

# Monitor in real-time
redis-cli monitor | grep "port:"

# Clear all cache (careful!)
redis-cli DEL "port:allocations:*"
```

### Service Management
```bash
# Check service status
pm2 status

# View service logs
pm2 logs oddjob-server

# Restart services
pm2 restart oddjob-server

# Monitor in real-time
pm2 monit
```

---

## 📊 Metrics Dashboard

### Prometheus Queries

```promql
# Port allocation success rate (last 5 minutes)
rate(oddjob_port_allocation_success_total[5m])

# Container launch duration (p99)
histogram_quantile(0.99, oddjob_container_launch_duration_ms)

# Port pool utilization
oddjob_port_pool_utilization_percent

# Active port allocations
count(oddjob_port_allocations_active)

# Container creation failure rate
rate(oddjob_container_launch_failed_total[5m])
```

### Expected Baselines

| Metric | Expected | Threshold |
|--------|----------|-----------|
| Port Allocation Latency | 50ms | <100ms |
| Container Startup Time | 10s | <20s |
| Allocation Success Rate | 99.95% | >99.9% |
| Lock Acquisition | 5ms | <10ms |
| Port Conflict Rate | 0% | <0.1% |

---

## 🚀 Deployment Timeline

### Week 1: Development & Testing
- [x] Code implementation
- [ ] Unit tests passing (100%)
- [ ] Integration tests passing
- [ ] Load tests (500+ concurrent)
- [ ] Code review complete
- [ ] Security review complete

### Week 2: Staging
- [ ] Deploy to staging
- [ ] Run full test suite
- [ ] Performance baseline
- [ ] 24-hour stability run
- [ ] Documentation review

### Week 3: Soft Launch
- [ ] Deploy to production (10% rollout)
- [ ] Monitor metrics closely
- [ ] Collect user feedback
- [ ] Fine-tune parameters

### Week 4: Full Rollout
- [ ] Expand to 100% rollout
- [ ] Monitor for 1 week
- [ ] Plan Phase 1C work
- [ ] Document lessons learned

---

## 🐛 Debugging Guide

### Enable Debug Logging
```typescript
// In environment
DEBUG=oddjob:* npm run dev

// Or programmatically
process.env.DEBUG = 'oddjob:*';
```

### Common Issues & Solutions

#### Issue: Ports not allocating
```bash
# Check lock
redis-cli get "port:allocation:lock"

# Check Redis connection
redis-cli ping

# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM port_allocations;"
```

#### Issue: Container creation failing
```bash
# Check Docker daemon
docker ps

# Check Docker logs
journalctl -u docker -n 20

# Test image pull
docker pull nginx:latest

# Check disk space
df -h /var/lib/docker
```

#### Issue: Performance degradation
```bash
# Check system resources
top -b -n 1

# Check database connections
SELECT count(*) FROM pg_stat_activity;

# Check lock contention
redis-cli --latency

# Profile code
node --prof server.js
```

---

## 📞 Support Channels

### Documentation
- Technical Specs: `PHASE_1B_*_SPEC.md`
- Implementation: `PHASE_1B_IMPLEMENTATION_GUIDE.md`
- Code Comments: See service files for inline documentation

### Code Review
- Process: Standard PR review
- Reviewers: Backend lead + DevOps
- Checklist: Security, Performance, Tests

### Issues & Questions
- Slack: #phase-1b-implementation
- GitHub: Create issue with [Phase 1B] label
- Sync: Weekly status call

---

## ✅ Verification Checklist

### Before Staging
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Code review approved
- [ ] Security review completed
- [ ] Database schema verified
- [ ] API contracts documented

### Before Production
- [ ] Load tests passed (500+ concurrent)
- [ ] Staging deployment stable for 48h
- [ ] Metrics dashboard operational
- [ ] Runbooks written
- [ ] On-call training completed
- [ ] Rollback plan ready

### Day 1 Production
- [ ] Monitor all metrics
- [ ] Check error rates
- [ ] Verify port allocations working
- [ ] Confirm health checks passing
- [ ] Review container startup times

---

## 📈 Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Test Coverage | 80%+ | Code coverage report |
| Unit Test Pass Rate | 100% | Test run output |
| Integration Test Pass Rate | 100% | Test run output |
| Load Test Success | >99.9% | Artillery report |
| Staging Stability | 48+ hours | Uptime monitoring |
| Production Availability | >99.9% | SLA monitoring |
| Mean Time to Recovery | <5 minutes | Incident metrics |

---

## 🎓 Learning Resources

### For New Team Members
1. Read: PHASE_1B_IMPLEMENTATION_GUIDE.md
2. Watch: Code walkthrough (30 min)
3. Try: Run tests locally (15 min)
4. Ask: Questions in #phase-1b-implementation

### For Deep Dives
1. Container Lifecycle Spec: PHASE_1B_CONTAINER_LIFECYCLE_SPEC.md
2. Port Management Spec: PHASE_1B_PORT_MANAGEMENT_SPEC.md
3. Service Code: Read implementations line by line
4. Tests: Study test cases for usage patterns

---

## 📝 Notes for Next Phase (1C)

Identified items for Phase 1C:
- [ ] Integration with State Reconciliation auto-remediation
- [ ] Grafana dashboard implementation
- [ ] Advanced conflict resolution
- [ ] Multi-region port pool support
- [ ] Performance optimization for 10k+ instances

---

**Last Updated:** June 14, 2026  
**Maintained By:** Engineering Team  
**Version:** 1.0

For the latest information, check the `#phase-1b-implementation` Slack channel.
