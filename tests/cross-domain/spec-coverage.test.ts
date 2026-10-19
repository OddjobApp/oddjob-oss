/**
 * Spec coverage tests — validates implementation against docs/specs
 * References: JOB_TYPES_SPEC.md, oddjob_feature_reference.md, HIL_2_ACCOUNTABILITY_SPEC.md
 * @vitest-environment node
 */

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { jobExecutorRegistry } from "@domain/jobs/core/executors/index.js";

// Job types from JOB_TYPES_SPEC executor mapping
const JOB_TYPES_WITH_EXECUTORS = [
  'shell', 'curl', 'api', 'python', 'node_script', 'ai_api_call', 'ai_agent',
  'repeater', 'iterator', 'decision', 'transformer', 'human_approval', 'form_agent',
  'folder_import', 'file_export', 'file_writer', 'file_ops', 'selenium', 'git_op',
  'slack_post', 'email_send', 'sql_query', 'openapi', 'airflow_dag_run',
  'confluence_sync', 'jira_sync', 'google_drive_sync', 'static_response',
  'supervisor', 'reranker'
];

// jobExecutorRegistry discovers executors by scanning its directory, and that scan
// is async and lazy — nothing is registered until autoRegister() has been awaited.
// Without this every getExecutor() call returned undefined and all 41 assertions in
// this file failed, which looked like missing executors rather than an uninitialised
// registry.
beforeAll(async () => {
  await jobExecutorRegistry.autoRegister();
});

describe('Spec Coverage - Job Executors (JOB_TYPES_SPEC)', () => {
  it('registers executor for api/curl job types', () => {
    const api = jobExecutorRegistry.getExecutor('api');
    const curl = jobExecutorRegistry.getExecutor('curl');
    expect(api).toBeDefined();
    expect(curl).toBeDefined();
    expect(api).toBe(curl);
  });

  it('registers executor for human_approval (Decision Inbox)', () => {
    const executor = jobExecutorRegistry.getExecutor('human_approval');
    expect(executor).toBeDefined();
  });

  it('registers executor for form_agent', () => {
    const executor = jobExecutorRegistry.getExecutor('form_agent');
    expect(executor).toBeDefined();
  });

  it('registers executor for iterator and repeater', () => {
    expect(jobExecutorRegistry.getExecutor('iterator')).toBeDefined();
    expect(jobExecutorRegistry.getExecutor('repeater')).toBeDefined();
  });

  it('registers executor for decision (trueStepId/falseStepId)', () => {
    const executor = jobExecutorRegistry.getExecutor('decision');
    expect(executor).toBeDefined();
  });

  it('registers SaaS sync executors (jira_sync, confluence_sync, google_drive_sync)', () => {
    expect(jobExecutorRegistry.getExecutor('jira_sync')).toBeDefined();
    expect(jobExecutorRegistry.getExecutor('confluence_sync')).toBeDefined();
    expect(jobExecutorRegistry.getExecutor('google_drive_sync')).toBeDefined();
  });

  it('registers static_response and supervisor', () => {
    expect(jobExecutorRegistry.getExecutor('static_response')).toBeDefined();
    expect(jobExecutorRegistry.getExecutor('supervisor')).toBeDefined();
  });

  it('returns undefined for unknown job type', () => {
    const executor = jobExecutorRegistry.getExecutor('unknown_type_xyz');
    expect(executor).toBeUndefined();
  });

  describe('executor mapping from JOB_TYPES_SPEC', () => {
    JOB_TYPES_WITH_EXECUTORS.forEach((jobType) => {
      it(`has executor for ${jobType}`, () => {
        const executor = jobExecutorRegistry.getExecutor(jobType);
        expect(executor).toBeDefined();
      });
    });
  });
});

describe('Spec Coverage - HIL 2.0 Accountability (HIL_2_ACCOUNTABILITY_SPEC)', () => {
  it('approvals route module exports registerApprovalsRoutes', async () => {
    const { registerApprovalsRoutes } = await import('../../server/routes/approvals');
    expect(typeof registerApprovalsRoutes).toBe('function');
  });

  it('external-service submitForm path exists for modifiedOutput', async () => {
    const { externalService } = await import('@domain/integrations/core/external.service.js');
    expect(externalService).toBeDefined();
    expect(typeof externalService.submitForm).toBe('function');
  });
});

describe('Spec Coverage - Missions (MISSIONS_SPEC)', () => {
  it('missions routes are registered', async () => {
    const { missionsRouter } = await import('../../server/domain/mission/index.js');
    expect(missionsRouter).toBeDefined();
    expect(missionsRouter.stack).toBeDefined();
  });

  it('missionService has required methods for mission CRUD', async () => {
    const { missionService } = await import('@server/domain/mission/core/mission.service.js');
    expect(typeof missionService.createMission).toBe('function');
    expect(typeof missionService.listMissions).toBe('function');
    expect(typeof missionService.getById).toBe('function');
  });

  it('missionRunService has required methods for run lifecycle (checkpoint, pause, resume)', async () => {
    const { missionRunService } = await import('@server/domain/mission/core/mission-run.service.js');
    expect(typeof missionRunService.checkpoint).toBe('function');
    expect(typeof missionRunService.pauseForFile).toBe('function');
    expect(typeof missionRunService.pauseForHumanApproval).toBe('function');
    expect(typeof missionRunService.resumeMissionRun).toBe('function');
    expect(typeof missionRunService.resumeIfWaitingOnApproval).toBe('function');
    expect(typeof missionRunService.listWaitingOnFile).toBe('function');
  });

  it('folder_import executor supports mission wake-up', async () => {
    const { jobExecutorRegistry } = await import('@domain/jobs/core/executors/index.js');
    const executor = jobExecutorRegistry.getExecutor('folder_import');
    expect(executor).toBeDefined();
  });
});

describe('Spec Coverage - AI Agent Enhancements (AI_AGENT_ENHANCEMENTS_SPEC)', () => {
  it('toolAnalyticsService has inferTaskType, getSuccessfulExamples, getRecommendedTools for Tool Recommendations', async () => {
    const { toolAnalyticsService } = await import('@domain/agents/core/tool-analytics.service.js');
    expect(typeof toolAnalyticsService.inferTaskType).toBe('function');
    expect(typeof toolAnalyticsService.getSuccessfulExamples).toBe('function');
    expect(typeof toolAnalyticsService.getRecommendedTools).toBe('function');
    expect(toolAnalyticsService.inferTaskType('search the web for competitors')).toBe('web_research');
  });

  it('runAgentLoop accepts missionId in initialContext and missionService has addSharedMemory for Agent Memory Sharing', async () => {
    const { runAgentLoop } = await import('../../server/domain/agents/agent-runner.js');
    expect(typeof runAgentLoop).toBe('function');
    const { missionService } = await import('@server/domain/mission/core/mission.service.js');
    expect(typeof missionService.addSharedMemory).toBe('function');
    const { AGENT_TOOLS } = await import('../../server/domain/tools/v1/tool-registry.service.js');
    expect(AGENT_TOOLS.add_shared_memory).toBeDefined();
  });

  it('supervisorService.planStream exists for Streaming Supervisor Plans', async () => {
    const { supervisorService } = await import('@domain/integrations/core/supervisor.service.js');
    expect(typeof supervisorService.planStream).toBe('function');
    // planStream is an async generator yielding { type: 'chunk'|'plan', ... }
  });

  it('supervisor plan-stream route is registered', async () => {
    const { supervisorRouter } = await import('../../server/routes/supervisor');
    expect(supervisorRouter).toBeDefined();
    const stack = supervisorRouter.stack;
    const planStreamRoute = stack.find((r: any) => r.route?.path === '/plan-stream');
    expect(planStreamRoute).toBeDefined();
  });

  it('AIClientFactory and execute interface exist for Multi-Model Fallback', async () => {
    const { AIClientFactory } = await import('@domain/ai/core/ai-client.service.js');
    expect(AIClientFactory).toBeDefined();
    expect(typeof AIClientFactory.getClient).toBe('function');
  });

  it('agent_run_steps schema has confidence column for Confidence Scoring', async () => {
    const { agentRunSteps } = await import('@shared/schema');
    expect(agentRunSteps).toBeDefined();
    expect(agentRunSteps.content).toBeDefined();
    expect(agentRunSteps.confidence).toBeDefined();
  });

  it('mapIntentToPipeline exists for Intent-to-Pipeline mapping', async () => {
    const { mapIntentToPipeline } = await import('@domain/pipeline/core/intent-pipeline-mapper.service.js');
    expect(typeof mapIntentToPipeline).toBe('function');
  });

  it('resolve_intent_to_pipeline tool is registered', async () => {
    const { PIPELINE_TOOLS } = await import('../../server/domain/tools/v1/capabilities/pipelines.js');
    expect(PIPELINE_TOOLS.resolve_intent_to_pipeline).toBeDefined();
    expect(PIPELINE_TOOLS.resolve_intent_to_pipeline.name).toBe('resolve_intent_to_pipeline');
  });
});

describe('Spec Coverage - June 27 AI Enhancement Specs', () => {
  const repoRoot = process.cwd();
  const specFiles = [
    'docs/specs/World_Model_Spec.md',
    'docs/specs/Skill_Discovery_Spec.md',
    'docs/specs/CAI_Spec.md',
  ];

  const staleReferencePatterns = [
    'backend/memory/world_model.py',
    'backend/memory/knowledge_distiller.py',
    'backend/executors/htn/mcts.py',
    'backend/executors/htn/htn_loop.py',
    'backend/validation/critic.py',
    'backend/validation/constitution.md',
    'KnowledgeDistiller',
    'ProceduralMemory',
    'WorldModel',
  ];

  function extractLocalPathReferences(markdown: string): string[] {
    const references = new Set<string>();
    const backtickPattern = /`([^`\n]+)`/g;
    for (const match of markdown.matchAll(backtickPattern)) {
      const value = match[1].replaceAll('\\', '/');
      const hasPathSeparator = value.includes('/');
      const hasKnownExtension = /\.(ts|tsx|js|mjs|cjs|md|json|py)$/i.test(value);
      const startsInRepo = /^(server|client|shared|packages|docs|scripts|tests)\//.test(value);
      if (hasPathSeparator && hasKnownExtension && startsInRepo) {
        references.add(value);
      }
    }
    return [...references].sort();
  }

  it('keeps implementation status and drift cues visible in each spec', () => {
    for (const file of specFiles) {
      const markdown = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      // The specs write this as "**Status**:", so a literal 'Status:' substring never
      // matched even though every spec carries the field.
      expect(markdown).toMatch(/\*{0,2}Status\*{0,2}\s*:/);
      expect(markdown).toContain('## Implementation Status');
      expect(markdown).toContain('## Drift Cues');
    }
  });

  it('does not preserve stale Python-era architecture references', () => {
    for (const file of specFiles) {
      const markdown = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      for (const staleReference of staleReferencePatterns) {
        // Bare class names are matched as whole identifiers. A plain substring check
        // flagged `WorldModelBridgeService` — a current, live service in
        // server/domain/signal-intelligence — as a stale Python-era `WorldModel`
        // reference. Paths keep the substring check.
        const isPath = staleReference.includes('/');
        const found = isPath
          ? markdown.includes(staleReference)
          : new RegExp(`\b${staleReference}(?![A-Za-z0-9_])`).test(markdown);
        expect(found, `${file} should not reference ${staleReference}`).toBe(false);
      }
    }
  });

  it('only references local implementation files that exist', () => {
    for (const file of specFiles) {
      const markdown = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      const references = extractLocalPathReferences(markdown);
      expect(references.length, `${file} should cite concrete implementation files`).toBeGreaterThan(0);
      for (const reference of references) {
        const absolutePath = path.join(repoRoot, reference);
        expect(fs.existsSync(absolutePath), `${file} references missing file ${reference}`).toBe(true);
      }
    }
  });
});

describe('Spec Coverage - Evaluation Studio (EVALUATION_STUDIO_SPEC)', () => {
  it('evaluation-studio routes are registered', async () => {
    const evaluationStudioRouter = (await import('../../server/routes/evaluation-studio')).default;
    expect(evaluationStudioRouter).toBeDefined();
    expect(evaluationStudioRouter.stack).toBeDefined();
  });

  it('evaluationService has runTestSet and getRunResults', async () => {
    const { evaluationService } = await import('@domain/pipeline/core/evaluation.service.js');
    expect(typeof evaluationService.runTestSet).toBe('function');
    expect(typeof evaluationService.getRunResults).toBe('function');
  });
});
