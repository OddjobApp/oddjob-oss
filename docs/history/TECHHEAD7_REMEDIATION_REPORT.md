# TECHHEAD7 Deployment Status & Remediation Report

**Date:** June 14, 2026  
**Organization:** TECHHEAD7 (Org ID: 291)  
**Health Score:** 30% (3/10 apps running)

---

## Executive Summary

The TECHHEAD7 organization has 10 deployed applications, but only 3 are operational:

- ✅ **3 Running & Healthy** (6/14 @ 5:22 PM)
- ❌ **4 Stopped** (containers deleted, last heartbeat 6/13)
- ❌ **3 Never Started** (0 instances, never deployed)

**Critical Finding:** Docker containers referenced in the database **no longer exist in Docker**. They appear to have been deleted or cleaned up on 6/13/2026 around 3:06 AM.

---

## Running Applications (✅ Operational)

| App Name | Port | Container ID | Last Heartbeat | Status |
|---|---|---|---|---|
| AI Workforce Dashboard | 10516 | oddjob-app-ai-workforce-dashboard-org291-10516 | 6/14 5:25 PM | 🟢 RUNNING |
| Agent Performance & Training Portal | 10515 | oddjob-app-agent-training-workbench-org291-10515 | 6/14 5:25 PM | 🟢 RUNNING |
| SDLC Workbench Suite | 10509 | oddjob-app-sdlc-workbench-org291-10509 | 6/14 5:25 PM | 🟢 RUNNING |

---

## Stopped Applications (❌ Containers Deleted)

| App Name | Port | Container ID | Last Heartbeat | Database Status | Docker Status |
|---|---|---|---|---|---|
| Product Manager Workbench | 10021 | oddjob-app-pm-workbench-org291-10021 | 6/13 3:06 PM | stopped | **DELETED** ❌ |
| QA Workbench | 10017 | oddjob-app-qa-workbench-org291-10017 | 6/13 3:06 PM | stopped | **DELETED** ❌ |
| Scrum Master Workbench | 10002 | oddjob-app-scrum-master-workbench-org291-10002 | 6/13 3:06 PM | stopped | **DELETED** ❌ |
| Stakeholder Workbench | 10018 | oddjob-app-stakeholder-workbench-org291-10018 | 6/13 3:06 PM | stopped | **DELETED** ❌ |

**Issue:** Attempted `docker restart` failed because containers no longer exist in Docker.

---

## Never-Started Applications (❌ No Instances)

| App Name | Port | Container ID | Status |
|---|---|---|---|
| Procurement Management Portal | UNSET | NOT SET | No instances |
| Product Launch Workbench | UNSET | NOT SET | No instances |
| Research & RFC Synthesis Portal | UNSET | NOT SET | No instances |

**Issue:** Deployments exist but instance creation never completed. No assigned ports or container IDs in database.

---

## Root Cause Analysis

### Why Stopped Containers Were Deleted (Hypothesis)

**Timeline:**
- 6/13 @ 3:06 AM: All 4 apps show simultaneous `last_heartbeat` (no gradual degradation)
- Containers **existed in database** but **missing from Docker**
- 3 other apps continued running normally (same period)

**Possible Causes:**
1. **Docker system prune:** `docker system prune` was run, removing stopped containers
2. **Deployment rollback:** Bad deployment config caused these 4 to be deleted
3. **Resource cleanup:** Automated cleanup script removed orphaned containers
4. **Host issue:** Container state corrupted, manually removed containers

**Evidence:**
- Deployment status in DB = `active`
- Instance status in DB = `stopped`
- Heartbeat frozen at 6/13 3:06 AM
- Simultaneous stoppage across 4 apps → orchestration issue, not random failure

---

## Remediation Options

### Option A: Redeploy via Oddjob System (RECOMMENDED)

**Approach:** Trigger deployment through the Oddjob app forge service

**Steps:**
```bash
# 1. Call app deployment API to redeploy each stopped app
POST /api/apps/{appId}/redeploy
{
  "forceRebuild": false,
  "fromDeployment": 591,  // Use last known good deployment config
  "assignNewPort": false,  // Keep original port (10021, 10017, 10002, 10018)
}

# 2. Monitor deployment progress
GET /api/jobs/{jobId}/status

# 3. Verify containers are running
docker ps | grep org291
```

**Pros:**
- Uses official deployment pipeline
- Respects deployment configuration stored in database
- Allows rollback if something goes wrong
- Proper error handling and logging

**Cons:**
- Slower than direct Docker commands
- Requires deployment service availability
- May retry if infra issues exist

---

### Option B: Manual Docker Container Recreation

**Approach:** Recreate containers using docker-bridge service

**Pseudo-code:**
```typescript
// For each stopped app:
const app = { name: 'Product Manager Workbench', orgId: 291, port: 10021 };

// 1. Find deployment config from database
const deployment = await db.select().from(app_deployments).where(eq(app_deployments.app_id, appId));

// 2. Recreate container
const containerConfig = {
  image: `oddjob-app/${app.name}:${deployment.imageTag}`,
  name: `oddjob-app-pm-workbench-org291-${app.port}`,
  portMappings: { [app.port]: 3000 },
  restartPolicy: 'unless-stopped'
};

const result = await dockerBridgeService.runContainer(containerConfig);

// 3. Update database with new container ID
await db.update(app_instances).set({
  container_id: result.containerId,
  status: 'running',
  last_heartbeat_at: new Date()
}).where(eq(app_instances.id, instanceId));
```

**Pros:**
- Immediate restoration
- Direct Docker control
- Suitable for development/testing

**Cons:**
- Bypasses deployment pipeline
- May lose configuration during redeploy
- Risk of inconsistency between DB and Docker

---

### Option C: Clean Database & Redeploy Fresh

**Approach:** Clear stale container IDs and trigger fresh deployment

**Steps:**
```sql
-- 1. Clear stale container IDs for stopped apps
UPDATE app_instances
SET container_id = NULL, status = 'pending'
WHERE app_id IN (
  SELECT id FROM apps WHERE name IN (
    'Product Manager Workbench',
    'QA Workbench',
    'Scrum Master Workbench',
    'Stakeholder Workbench'
  )
) AND status = 'stopped';

-- 2. Trigger redeployment
-- Call deployment API for each app
```

**Pros:**
- Cleans up stale data
- Forces fresh deployment from known good state
- Safest option

**Cons:**
- Requires database write access
- Slower (full redeployment cycle)
- May take 5-10 minutes per app

---

## Action Plan

### Immediate (Next 30 minutes)

**Priority 1: Diagnose 6/13 Shutdown Event**
```bash
# 1. Check Docker daemon logs
docker system df  # Disk usage - was system full?
docker ps -a --filter "until=2026-06-13T04:00:00" | wc -l  # How many containers existed

# 2. Check system resources around 6/13 3:06 AM
journalctl --since "2026-06-13 00:00:00" --until "2026-06-13 06:00:00" | grep -i "docker\|container\|resource"

# 3. Check Oddjob logs for deployment events
tail -f /var/log/oddjob/deployment.log | grep "2026-06-13"
```

### Short-term (Next 2 hours)

**Priority 2: Redeploy Stopped Apps (Option C Recommended)**
```bash
# 1. Clean database
# UPDATE app_instances SET container_id = NULL, status = 'pending' WHERE...

# 2. Trigger redeployment via API
curl -X POST http://localhost:3000/api/apps/redeploy-missing \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"orgId": 291, "appNames": ["Product Manager Workbench", "QA Workbench", "Scrum Master Workbench", "Stakeholder Workbench"]}'

# 3. Monitor progress
# GET /api/jobs/{jobId}/status every 10 seconds
```

### Medium-term (Next 4 hours)

**Priority 3: Deploy Never-Started Apps**
- Investigate why 3 apps have 0 instances
- Check deployment logs for errors
- Assign ports if not set
- Trigger initial deployment

---

## Recommended Next Step

**Execute Option C** with the following command:
```bash
# Restart all 4 stopped TECHHEAD7 apps via deployment system
npx tsx restart-techhead7-via-deployment.ts --orgId 291 --clean
```

This will:
1. ✅ Clear stale container IDs from database
2. ✅ Re-register instances as pending
3. ✅ Trigger deployment service to recreate containers
4. ✅ Monitor deployment until running or failed
5. ✅ Report final status

---

## Verification Checklist

After remediation, verify:

- [ ] All 4 stopped apps show `status=running` in database
- [ ] Container IDs match actual Docker containers
- [ ] Ports 10021, 10017, 10002, 10018 respond to HTTP requests
- [ ] Heartbeats updated within last 2 minutes
- [ ] Application UIs load without errors
- [ ] No errors in Docker logs: `docker logs <container-id>`

---

## Prevention

To prevent future incidents:

1. **Enable container health checks**
   ```docker
   HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
     CMD curl -f http://localhost:3000/health || exit 1
   ```

2. **Configure restart policies**
   ```docker
   --restart unless-stopped
   ```

3. **Monitor Docker events**
   ```bash
   docker events --filter 'type=container' --format '{{.Type}} {{.Action}} {{.Actor.Attributes.name}}'
   ```

4. **Set up alerts for container exits**
   - Monitor `docker ps -a` for unexpected state changes
   - Alert if `last_heartbeat_at` exceeds 2 minutes old

5. **Schedule periodic health checks**
   ```typescript
   // Run every 5 minutes
   async function healthCheckAllApps() {
     const apps = await getActiveApps();
     for (const app of apps) {
       const isHealthy = await isAppHealthy(app);
       if (!isHealthy) {
         await alertTeam(app);
         await attemptAutoRestart(app);
       }
     }
   }
   ```

---

## Conclusion

The TECHHEAD7 organization is experiencing a **deployment infrastructure failure** affecting 70% of its apps. The 4 stopped containers were deleted from Docker between 6/13 3:06 AM and now, while 3 apps continue running normally.

**Recommendation:** Execute Option C to clean database state and trigger fresh redeployment through the official Oddjob deployment service. Estimated time to full restoration: **20-30 minutes**.
