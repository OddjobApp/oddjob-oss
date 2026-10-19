# Phase 4.5: Quick Wins Sprint

**Timeline:** Week of Jul 15-19, 2026 (5 working days)  
**Duration:** 8-10 hours  
**Target Completion:** 2026-07-19  
**Purpose:** Ship high-impact compliance + UX features immediately after Phase 4D  
**Status:** NOT STARTED (dependent on Phase 4D completion)

---

## Overview

After Phase 4 (indexing/caching/streaming/async workers) completes, we have a natural pause point. Phase 4.5 capitalizes on this momentum by shipping 2 highly-visible features that unblock enterprise sales:

1. **Privacy-Aware Model Router** — Keep PII/sensitive data off cloud models
2. **Hardware-Aware Deployment Profiles** — Auto-tune for laptop/workstation/cluster

Combined, these two features provide:
- **Compliance argument:** "We respect data residency requirements"
- **Scaling story:** "Works on your laptop, grows to production"
- **Cost argument:** "Fine-grained control over where your data goes"

---

## 📋 Day 1: Privacy-Aware Model Router

**Duration:** 2 hours  
**Owner:** 1 developer  
**Impact:** HIGH — enterprise compliance requirement

### 1.1 Update Job Schema (0.5 hours)

Add `dataClassification` field to jobs table:

```typescript
// shared/schema/index.ts
export const jobs = pgTable('jobs', {
  // ... existing fields ...
  dataClassification: text('data_classification').default('public')
    .$type<'public' | 'internal' | 'sensitive' | 'restricted'>(),
  // ... rest of fields ...
});
```

Migrate existing records:

```sql
-- Migration: 005_add_data_classification_to_jobs.sql
ALTER TABLE jobs ADD COLUMN data_classification VARCHAR DEFAULT 'public';

-- Set defaults by job type
UPDATE jobs SET data_classification = 'restricted' 
WHERE type IN ('pii_extraction', 'document_analysis', 'email_summarization');

UPDATE jobs SET data_classification = 'sensitive' 
WHERE type IN ('financial_analysis', 'medical_research');

UPDATE jobs SET data_classification = 'internal' 
WHERE type IN ('code_review', 'data_transformation');
```

**Deliverable:** Schema updated, migration deployed

---

### 1.2 Add Model Routing Logic (1 hour)

Update `ai-client.service.ts` to route based on classification:

```typescript
// server/domain/ai/core/ai-client.service.ts

async request(jobConfig: JobConfig, prompt: string, dataClassification: string = 'public') {
  let modelToUse = jobConfig.model || 'claude-opus-4-1';
  
  // Policy: Restricted data only uses local models
  if (dataClassification === 'restricted') {
    if (jobConfig.allowLocalModels !== true) {
      throw new Error(
        `Job contains restricted data but allowLocalModels is not enabled. ` +
        `Add "allowLocalModels: true" to job config or reduce data classification.`
      );
    }
    modelToUse = 'local-llama-2-70b';  // fallback to on-prem model
  }
  
  // Policy: Sensitive data prefers local, falls back to Sonnet (not Opus)
  if (dataClassification === 'sensitive') {
    if (jobConfig.allowLocalModels === true) {
      modelToUse = 'local-llama-2-70b';
    } else {
      modelToUse = 'claude-sonnet-4-20250514';  // cheaper, still capable
    }
  }
  
  // Policy: Internal data can use any configured model
  // Policy: Public data can use frontier models (default)
  
  logger.info(`[AI] Using model '${modelToUse}' for classification '${dataClassification}'`);
  
  return this.callModel(modelToUse, prompt, jobConfig);
}
```

Hook this into job execution:

```typescript
// server/domain/mission/core/mission-executor.service.ts

async executeJob(job: Job) {
  const response = await aiService.request(
    job.config,
    job.prompt,
    job.dataClassification  // ← pass classification
  );
  return response;
}
```

**Deliverable:** Model routing logic implemented + tested

---

### 1.3 Add UI Controls (0.5 hours)

Add dropdown to Job configuration form:

```tsx
// web/components/JobConfigForm.tsx

<Select
  label="Data Classification"
  value={formData.dataClassification}
  onChange={(val) => setFormData({...formData, dataClassification: val})}
  options={[
    { value: 'public', label: '🌍 Public (any model OK)' },
    { value: 'internal', label: '🏢 Internal (cloud OK)' },
    { value: 'sensitive', label: '🔒 Sensitive (prefer local)' },
    { value: 'restricted', label: '🔐 Restricted (local only)' },
  ]}
  help="Select based on data privacy requirements"
/>

{formData.dataClassification === 'restricted' && (
  <Alert type="warning">
    🔐 This job will ONLY run on local models. Enable 'allowLocalModels' in job config.
  </Alert>
)}
```

Add badge to job listings:

```tsx
// Cycle detail view, Job card
{job.dataClassification !== 'public' && (
  <Badge icon={classificationIcon[job.dataClassification]}>
    {job.dataClassification.toUpperCase()}
  </Badge>
)}
```

Add metric to Cost Dashboard:

```tsx
// Cost Dashboard
<MetricCard
  title="PII-Safe API Calls"
  value={`${piiSafeCount} calls`}
  subtitle="Using local models or restricted policies"
  trend="+42% this month"
/>
```

**Deliverable:** UI controls + Cost Dashboard metric

---

## 📋 Day 2-3: Hardware-Aware Deployment Profiles

**Duration:** 2.5 hours  
**Owner:** 1 developer  
**Impact:** MEDIUM — auto-tuning + scaling story

### 2.1 Add Profile to Organization Schema (0.5 hours)

Update org schema to include deployment tier:

```typescript
// shared/schema/index.ts
export const organizations = pgTable('organizations', {
  // ... existing fields ...
  deploymentProfile: text('deployment_profile').default('cluster')
    .$type<'laptop' | 'workstation' | 'cluster'>(),
  // ... rest of fields ...
});
```

Migration:

```sql
-- Migration: 006_add_deployment_profile_to_orgs.sql
ALTER TABLE organizations ADD COLUMN deployment_profile VARCHAR DEFAULT 'cluster';

-- Default existing orgs to cluster (most permissive)
-- Customers on SMB plan get 'workstation'
UPDATE organizations 
SET deployment_profile = 'workstation' 
WHERE subscription_plan IN ('startup', 'growth');
```

**Deliverable:** Schema updated, migration deployed

---

### 2.2 Profile Tuning Configuration (0.75 hours)

Define profile constraints:

```typescript
// server/config/deployment-profiles.ts

export const DEPLOYMENT_PROFILES = {
  laptop: {
    maxParallelWorkers: 2,
    maxContextLength: 8_000,
    allowedModels: ['haiku'],  // Haiku only
    maxCyclesPerDay: 5,
    maxBlueprintsPerCycle: 3,
    estimatedCost: '$5-20/month',
  },
  workstation: {
    maxParallelWorkers: 8,
    maxContextLength: 32_000,
    allowedModels: ['haiku', 'sonnet'],  // Haiku + Sonnet
    maxCyclesPerDay: 50,
    maxBlueprintsPerCycle: 20,
    estimatedCost: '$50-200/month',
  },
  cluster: {
    maxParallelWorkers: 256,  // unlimited effectively
    maxContextLength: 200_000,
    allowedModels: ['haiku', 'sonnet', 'opus'],  // All models
    maxCyclesPerDay: 1000,
    maxBlueprintsPerCycle: 200,
    estimatedCost: 'Custom',
  },
};
```

**Deliverable:** Profile definitions + constraints

---

### 2.3 Orchestration Logic (1 hour)

Update `rolling-wave-orchestrator.service.ts` to respect profile:

```typescript
// server/domain/mission/core/rolling-wave-orchestrator.service.ts

async orchestrateCycle(cycle: OperationalCycle, org: Organization) {
  const profile = DEPLOYMENT_PROFILES[org.deploymentProfile];
  
  // Cap parallelism based on profile
  const maxParallel = Math.min(
    this.config.maxParallelMissions,
    profile.maxParallelWorkers
  );
  
  // Check cycle complexity against profile limits
  if (cycle.blueprintCount > profile.maxBlueprintsPerCycle) {
    logger.warn(
      `[Orchestration] Cycle has ${cycle.blueprintCount} blueprints ` +
      `but ${org.deploymentProfile} profile allows max ${profile.maxBlueprintsPerCycle}. ` +
      `Suggest: upgrade to next profile or split cycle.`
    );
    eventStream.publish('cycle.profile_limit_exceeded', {
      cycleId: cycle.id,
      blueprintCount: cycle.blueprintCount,
      profileLimit: profile.maxBlueprintsPerCycle,
      suggestedProfile: this.nextProfile(org.deploymentProfile),
    });
  }
  
  // Cap context length in AI requests
  const maxContext = profile.maxContextLength;
  
  // Execute with constraints
  return this.executeWithConstraints(cycle, {
    maxParallel,
    maxContext,
    allowedModels: profile.allowedModels,
  });
}

// Helper to suggest next profile
private nextProfile(current: string): string {
  return { laptop: 'workstation', workstation: 'cluster', cluster: 'cluster' }[current];
}
```

Hook into ai-client to enforce model allowlist:

```typescript
// server/domain/ai/core/ai-client.service.ts

async request(jobConfig: JobConfig, prompt: string, options: {
  allowedModels?: string[];
  maxContext?: number;
} = {}) {
  const profile = DEPLOYMENT_PROFILES[org.deploymentProfile];
  
  // Check if requested model is allowed
  if (options.allowedModels && !options.allowedModels.includes(this.model)) {
    logger.warn(
      `Model '${this.model}' not allowed in ${org.deploymentProfile} profile. ` +
      `Falling back to '${options.allowedModels[0]}'`
    );
    this.model = options.allowedModels[0];
  }
  
  // Warn if context exceeds profile limit
  if (prompt.length > options.maxContext) {
    logger.warn(
      `Prompt (${prompt.length} tokens) exceeds ` +
      `${org.deploymentProfile} profile limit (${options.maxContext}). ` +
      `Will truncate or recommend profile upgrade.`
    );
  }
  
  return this.callModel(this.model, prompt, jobConfig);
}
```

**Deliverable:** Orchestration respects profile constraints

---

### 2.4 UI for Profile Selection (0.75 hours)

Add to Organization settings:

```tsx
// web/pages/OrgSettings.tsx

<Card title="Deployment Profile" icon="⚙️">
  <RadioGroup
    name="deploymentProfile"
    value={org.deploymentProfile}
    onChange={(val) => updateOrg({deploymentProfile: val})}
    options={[
      {
        value: 'laptop',
        label: '💻 Laptop',
        description: 'Max 2 workers, Haiku only. Perfect for solo dev.',
        cost: '$5-20/month',
      },
      {
        value: 'workstation',
        label: '🖥️ Workstation',
        description: 'Max 8 workers, Haiku + Sonnet. For small teams.',
        cost: '$50-200/month',
      },
      {
        value: 'cluster',
        label: '🚀 Cluster',
        description: 'Unlimited workers, all models. For enterprises.',
        cost: 'Custom',
      },
    ]}
  />
  
  <WarningBox>
    ℹ️ Current profile: <strong>{org.deploymentProfile}</strong>
  </WarningBox>
  
  <ProfileLimitsTable profile={DEPLOYMENT_PROFILES[org.deploymentProfile]} />
  
  <Button onClick={() => upgradePlan()}>Upgrade to Next Profile →</Button>
</Card>
```

Add profile badge to Cycle header:

```tsx
// Cycle Detail view
<Header>
  <Heading>{cycle.name}</Heading>
  <Badge icon="📊">{org.deploymentProfile}</Badge>
</Header>
```

**Deliverable:** Profile UI + settings page

---

## 📋 Day 4: Integration & Testing

**Duration:** 1.5 hours  
**Owner:** 1 developer  
**Impact:** Validation + confidence

### 4.1 Integration Testing (0.75 hours)

```typescript
// server/__tests__/phase-4-5-integration.test.ts

describe('Phase 4.5: Quick Wins', () => {
  
  describe('Privacy-Aware Model Router', () => {
    it('should route restricted data to local models only', async () => {
      const job = await createJob({
        dataClassification: 'restricted',
        allowLocalModels: true,
      });
      
      const result = await aiService.request(job.config, 'test prompt', 'restricted');
      expect(result.modelUsed).toBe('local-llama-2-70b');
    });
    
    it('should reject restricted data if local models not enabled', async () => {
      const job = await createJob({
        dataClassification: 'restricted',
        allowLocalModels: false,
      });
      
      await expect(
        aiService.request(job.config, 'test prompt', 'restricted')
      ).rejects.toThrow('allowLocalModels');
    });
    
    it('should route sensitive data to Sonnet if local unavailable', async () => {
      const job = await createJob({
        dataClassification: 'sensitive',
        allowLocalModels: false,
      });
      
      const result = await aiService.request(job.config, 'test prompt', 'sensitive');
      expect(result.modelUsed).toBe('claude-sonnet-4-20250514');
    });
  });
  
  describe('Hardware-Aware Profiles', () => {
    it('should limit parallelism on laptop profile', async () => {
      const org = await createOrg({ deploymentProfile: 'laptop' });
      const cycle = await createCycle(org, { blueprintCount: 10 });
      
      const maxParallel = orchestrator.getMaxParallelism(org);
      expect(maxParallel).toBe(2);  // laptop max
    });
    
    it('should warn when cycle exceeds profile blueprint limit', async () => {
      const org = await createOrg({ deploymentProfile: 'laptop' });
      const cycle = await createCycle(org, { blueprintCount: 5 });
      
      const warnings = await orchestrator.validateCycleForProfile(cycle, org);
      expect(warnings).toContainEqual(
        expect.objectContaining({
          type: 'profile_limit_exceeded',
          suggested: 'workstation',
        })
      );
    });
  });
});
```

### 4.2 End-to-End Walkthrough (0.75 hours)

Test complete flows:

1. **Privacy Router Flow:**
   - Create job with dataClassification: 'restricted'
   - Submit cycle
   - Verify it routes to local model
   - Check Cost Dashboard shows "PII-Safe API Calls" +1
   - ✅ Pass

2. **Profile Limit Flow:**
   - Create org with deploymentProfile: 'laptop'
   - Create cycle with 10 blueprints
   - Submit cycle
   - Verify warning emitted
   - Check UI shows ⚠️ warning badge
   - ✅ Pass

3. **Profile Upgrade Flow:**
   - Org has workstation profile (max 8 workers)
   - Create cycle with 15 concurrent blueprints
   - System suggests upgrade to cluster
   - User clicks "Upgrade"
   - Profile changes to cluster
   - Cycle runs with full parallelism
   - ✅ Pass

**Deliverable:** All tests passing, flows validated

---

## 📋 Day 5: Documentation & Hand-off

**Duration:** 0.5 hours  
**Owner:** 1 developer  
**Impact:** Clarity for future maintenance

### 5.1 Architecture Document

```markdown
# Privacy-Aware Model Router

## How It Works
- Job schema includes `dataClassification` (public/internal/sensitive/restricted)
- During execution, ai-client.request() checks classification
- Routes to local model if restricted, prefers local if sensitive, uses configured model otherwise
- Cost Dashboard tracks "PII-Safe API Calls" metric

## Deployment
- Requires "local-llama-2-70b" available (or update fallback model)
- Update org settings to specify if local models enabled

## Adding New Classifications
1. Add to `JobConfig.dataClassification` union type
2. Add routing logic to `ai-client.request()`
3. Add UI option to job form
4. Add metric to Cost Dashboard

---

# Hardware-Aware Deployment Profiles

## How It Works
- Org has `deploymentProfile` (laptop/workstation/cluster)
- rolling-wave-orchestrator checks profile during cycle execution
- Limits parallelism, context length, and available models per profile
- Warns if cycle exceeds profile limits and suggests upgrade

## Profile Specifications
See DEPLOYMENT_PROFILES in server/config/deployment-profiles.ts

## Deployment
- Migration adds deploymentProfile column to organizations
- Default existing orgs to 'cluster' (no change in behavior)
- SMB plan customers automatically set to 'workstation'

## Adding New Profiles
1. Add to `deploymentProfile` type in schema
2. Add to DEPLOYMENT_PROFILES config
3. Add UI option to org settings
4. Update orchestrator validation logic
```

### 5.2 Success Criteria Checklist

- [ ] Privacy-Aware Model Router deployed to staging
- [ ] Hardware profiles applied to all orgs
- [ ] All integration tests passing
- [ ] Cost Dashboard shows PII-Safe API metric
- [ ] Org Settings shows profile selector + limits
- [ ] Job form shows data classification dropdown
- [ ] Zero regressions on existing functionality
- [ ] Ready for production deployment

**Deliverable:** Documentation + sign-off checklist

---

## 🎯 Phase 4.5 Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Privacy router deployed | Jul 19 | ⏳ |
| Hardware profiles active | Jul 19 | ⏳ |
| Integration tests passing | Jul 19 | ⏳ |
| Zero regressions | 0 failures | ⏳ |
| Ready for production | Yes | ⏳ |

---

## 📝 Dependencies

- ✅ Phase 4 complete (indexing/caching/streaming/async workers)
- ✅ Phase 4 extensions complete (model arbitrage, audit trail, state persistence)
- ✅ Local model available (or update fallback)
- ✅ Cost Dashboard infrastructure in place

---

## 🚀 Next Steps After Phase 4.5

**Phase 5 (2-week sprint, Jul 22-Aug 04):**
- Unified Channel Gateway Interface (6-8h)
- Policy-Driven Capability Governance (8-12h)

**Post-Phase 5:**
- Sandboxed Execution Runtime (20+ h, Q3 2026)

---

**Phase 4.5 is a critical milestone: 2 features that transform Oddjob from "nice tool" to "enterprise-ready platform."**

