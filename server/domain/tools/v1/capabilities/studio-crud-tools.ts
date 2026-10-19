import { z } from 'zod';
import type { ToolContext, ToolDefinition } from './types.js';
import { requireToolOrgId } from './org-context.js';
import { toMediaStudioContext } from './seedance.js';
import { feedSourceTypes } from '@shared/schema/signal-intelligence.js';

const id = z.number().int().positive();
const title = z.string().trim().min(1).max(200);
const confirmed = z.literal(true).describe('The user explicitly requested deletion/archival of this resource.');
const context = (ctx: ToolContext) => toMediaStudioContext(ctx);
const projectContext = (ctx: ToolContext) => ({
  organizationId: requireToolOrgId(ctx),
  userId: ctx.userId ?? undefined,
});
type Execute = (params: any, ctx: ToolContext) => Promise<unknown>;
function tool(name: string, description: string, parameters: z.ZodTypeAny, execute: Execute, mode: 'read' | 'create' | 'update' | 'delete'): ToolDefinition {
  return {
    name, description, parameters, group: 'Studio CRUD', riskLevel: mode === 'delete' ? 'high' : mode === 'read' ? 'low' : 'medium',
    idempotency: mode === 'read' ? 'read-safe' : mode === 'update' || mode === 'delete' ? 'idempotent' : 'none',
    sideEffects: mode === 'read' ? [] : ['database'],
    execute: async (params, ctx) => {
      requireToolOrgId(ctx);
      // Validate even for direct registry callers, not just the CREW function-call path.
      const result = await execute(parameters.parse(params), ctx);
      if (result === undefined || result === null) throw new Error('Resource not found in this organization');
      return JSON.stringify({ success: true, resource: result });
    },
  };
}
const form = async () => (await import('@domain/pipeline/core/form-studio.service.js')).formStudioService;
const scribe = async () => (await import('@domain/scribe/core/scribe.service.js')).scribeService;
const media = async () => (await import('@domain/media-studio/core/media-studio.service.js')).mediaStudio;
const feeds = async () => (await import('@domain/signal-intelligence/core/signal-feeds.service.js')).signalFeedsService;
const projects = async () => (await import('@domain/projects/core/project.service.js')).projectService;
const agents = async () => (await import('@domain/agent-cards/core/agent-card.service.js')).agentCardService;
const skills = async () => (await import('@domain/integrations/trycua/learned-skills.service.js')).learnedSkillsService;
async function manageAgents(ctx: ToolContext) {
  const { canManageOrganization } = await import('@server/utils/auth-context.js');
  if (!ctx.userId || !await canManageOrganization(ctx.userId, requireToolOrgId(ctx))) throw new Error('Organization management permission is required to change agents');
  return agents();
}
async function publicFeed(row: any) {
  if (!row) throw new Error('Feed not found in this organization');
  const { redactFeedCredentials } = await import('@domain/signal-intelligence/core/feed-credentials.service.js');
  return redactFeedCredentials(row);
}
const feedInput = z.object({ name: title, sourceType: z.enum(feedSourceTypes).refine(v => v !== 'internal_event', 'Use the internal-event feed workflow for event subscriptions'), url: z.string().url(), pollingIntervalSeconds: z.number().int().min(30).max(86400), enabled: z.boolean().default(false) }).strict();
const agentInput = z.object({ name: title.max(100), description: z.string().min(1).max(500), personaType: z.string().min(1), capabilities: z.array(z.string()).min(1), tools: z.array(z.string()).default([]), enabled: z.boolean().default(true) }).strict();

export const STUDIO_CRUD_TOOLS: Record<string, ToolDefinition> = {
  form_list: tool('form_list', 'List accessible Form Studio drafts and IDs before editing.', z.object({}), async (_,ctx) => (await import('@domain/pipeline/core/form-studio-library.service.js')).formStudioLibrary.list(context(ctx), {}), 'read'),
  form_get: tool('form_get', 'Read a Form Studio draft, schema and revision before editing.', z.object({ formId: id }), async (p,c) => (await form()).get(p.formId,context(c)), 'read'),
  form_create: tool('form_create', 'Create a saved Form Studio draft. Does not publish it.', z.object({ name: title, schema: z.record(z.unknown()).optional() }), async (p,c) => (await form()).create(p.name,context(c),{ schema: p.schema }), 'create'),
  form_update: tool('form_update', 'Save a form draft at the revision returned by form_get; rejects stale edits. Does not publish.', z.object({ formId: id, revision: z.number().int().nonnegative(), name: title.optional(), schema: z.record(z.unknown()).optional() }).refine(p => p.name !== undefined || p.schema !== undefined, 'Provide a change'), async (p,c) => (await form()).save(p.formId,p.revision,{ name:p.name,schema:p.schema },context(c),'Edited by Studio agent'), 'update'),
  form_archive: tool('form_archive', 'Archive a form while preserving history and existing references.', z.object({ formId: id, userConfirmed: confirmed }), async (p,c) => { await (await form()).get(p.formId,context(c)); return (await import('@domain/pipeline/core/hil-form-access.service.js')).hilFormAccess.archive(p.formId,context(c)); }, 'delete'),
  scribe_list_documents: tool('scribe_list_documents', 'List the organization manuscript tree.', z.object({}), async (_,c) => (await scribe()).listDocumentTree(requireToolOrgId(c)), 'read'),
  scribe_add_station: tool('scribe_add_station', 'Create a section in the active branch of an existing manuscript.', z.object({ documentId:id,title,content:z.string().max(200000).default('') }), async (p,c) => (await scribe()).addStation(p.documentId,requireToolOrgId(c),{ title:p.title,content:p.content }), 'create'),
  scribe_rename_station: tool('scribe_rename_station', 'Rename an existing manuscript section without changing its prose.', z.object({ nodeId:id,title }), async (p,c) => (await scribe()).renameStation(p.nodeId,requireToolOrgId(c),p.title), 'update'),
  scribe_delete_station: tool('scribe_delete_station', 'Delete the explicitly requested manuscript section and refresh its table of contents.', z.object({ nodeId:id,userConfirmed:confirmed }), async (p,c) => (await scribe()).deleteStation(p.nodeId,requireToolOrgId(c)), 'delete'),
  media_list_productions: tool('media_list_productions', 'List accessible Media Studio productions.', z.object({}), async (_,c) => (await media()).listProductions(context(c)), 'read'),
  media_get_production: tool('media_get_production', 'Read a production including its scenes and shots before editing.', z.object({ productionId:id }), async (p,c) => (await media()).getProduction(context(c),p.productionId), 'read'),
  media_create_production: tool('media_create_production', 'Create a Media Studio production draft without rendering or spending.', z.object({ title,style:z.string().max(1000).optional() }), async (p,c) => (await media()).createProduction(context(c),{ ...p, ...(c.sessionKey ? { crewSessionKey:c.sessionKey } : {}) }), 'create'),
  media_update_production: tool('media_update_production', 'Update the title or style of a production without rendering.', z.object({ productionId:id,title:title.optional(),style:z.string().max(1000).optional() }), async ({productionId,...p},c) => (await media()).updateProduction(context(c),productionId,p), 'update'),
  media_add_scene: tool('media_add_scene', 'Create a storyboard scene in a production.', z.object({ productionId:id,title,synopsis:z.string().max(4000).optional() }), async ({productionId,...p},c) => (await media()).addScene(context(c),productionId,p), 'create'),
  media_update_scene: tool('media_update_scene', 'Update a storyboard scene.', z.object({ sceneId:id,title:title.optional(),synopsis:z.string().max(4000).optional(),location:z.string().max(200).optional(),mood:z.string().max(300).optional() }), async ({sceneId,...p},c) => (await media()).updateScene(context(c),sceneId,p), 'update'),
  media_delete_scene: tool('media_delete_scene', 'Delete an explicitly requested storyboard scene using Media Studio lifecycle checks.', z.object({ sceneId:id,userConfirmed:confirmed }), async (p,c) => (await media()).deleteScene(context(c),p.sceneId), 'delete'),
  signal_get_feed: tool('signal_get_feed', 'Read feed configuration with authentication credentials redacted.', z.object({ feedId:id }), async (p,c) => publicFeed(await (await feeds()).getForOrg(p.feedId,requireToolOrgId(c))), 'read'),
  signal_create_feed: tool('signal_create_feed', 'Create a validated signal feed. Disabled by default; credentials are managed separately.', feedInput, async (p,c) => publicFeed(await (await import('@domain/signal-intelligence/core/signal-ingestion.service.js')).signalIngestionService.configureFeed(requireToolOrgId(c),p)), 'create'),
  signal_update_feed: tool('signal_update_feed', 'Update a signal feed name, polling interval or enabled state. Credentials and tenant identity cannot be changed.', z.object({ feedId:id,name:title.optional(),pollingIntervalSeconds:z.number().int().min(30).max(86400).optional(),enabled:z.boolean().optional() }).refine(p => p.name !== undefined || p.pollingIntervalSeconds !== undefined || p.enabled !== undefined,'Provide a change'), async ({feedId,...p},c) => publicFeed(await (await feeds()).updateForOrg(feedId,requireToolOrgId(c),p)), 'update'),
  signal_disable_feed: tool('signal_disable_feed', 'Soft-delete a signal feed by disabling polling, retaining history.', z.object({ feedId:id,userConfirmed:confirmed }), async (p,c) => { const svc = await feeds(); if (!await svc.getForOrg(p.feedId,requireToolOrgId(c))) throw new Error('Feed not found'); await svc.disableForOrg(p.feedId,requireToolOrgId(c)); return { id:p.feedId,enabled:false,status:'disabled' }; }, 'delete'),
  project_list: tool('project_list', 'List projects accessible to the caller.', z.object({}), async (_,c) => (await projects()).listProjects(projectContext(c)), 'read'),
  project_get: tool('project_get', 'Read a project with membership checks.', z.object({ projectId:id }), async (p,c) => (await projects()).getProject(projectContext(c),p.projectId), 'read'),
  project_create: tool('project_create', 'Create a project owned by the caller.', z.object({ name:title,description:z.string().max(4000).optional(),objective:z.string().max(2000).optional() }), async (p,c) => (await projects()).createProject(projectContext(c),{ ...p,status:'active',visibility:'org',metadata:{} }), 'create'),
  project_update: tool('project_update', 'Update project name, description or objective; requires project edit permission.', z.object({ projectId:id,name:title.optional(),description:z.string().max(4000).optional(),objective:z.string().max(2000).optional() }), async ({projectId,...p},c) => (await projects()).updateProject(projectContext(c),projectId,p), 'update'),
  project_archive: tool('project_archive', 'Archive a project; requires ownership and no open cycles.', z.object({ projectId:id,userConfirmed:confirmed }), async (p,c) => (await projects()).archiveProject(projectContext(c),p.projectId), 'delete'),
  agent_list_cards: tool('agent_list_cards', 'List agent cards in the current organization.', z.object({}), async (_,c) => (await agents()).list(requireToolOrgId(c)), 'read'),
  agent_get_card: tool('agent_get_card', 'Read an agent card before updating it.', z.object({ agentId:id }), async (p,c) => (await agents()).getById(requireToolOrgId(c),p.agentId), 'read'),
  agent_create_card: tool('agent_create_card', 'Create an agent card; requires the caller to manage this organization.', agentInput, async (p,c) => (await manageAgents(c)).create(requireToolOrgId(c),p), 'create'),
  agent_update_card: tool('agent_update_card', 'Update an agent card; organization management permission is checked from the caller identity.', agentInput.partial().extend({ agentId:id }), async ({agentId,...p},c) => (await manageAgents(c)).update(requireToolOrgId(c),agentId,p), 'update'),
  agent_disable_card: tool('agent_disable_card', 'Soft-delete an agent card, with organization management permission.', z.object({ agentId:id,userConfirmed:confirmed }), async (p,c) => { await (await manageAgents(c)).softDelete(requireToolOrgId(c),p.agentId); return { id:p.agentId,enabled:false }; }, 'delete'),
  computer_get_skill: tool('computer_get_skill', 'Read a saved computer-use skill without running it.', z.object({ skillId:z.string().uuid() }), async (p,c) => (await skills()).getSkill(requireToolOrgId(c),p.skillId), 'read'),
  computer_create_skill: tool('computer_create_skill', 'Create a draft skill from an existing recording in this organization; does not replay it.', z.object({ recordingId:z.string().uuid(),name:title.optional(),goal:z.string().max(4000).optional() }), async (p,c) => (await skills()).createSkillFromRecording({ ...p, organizationId:requireToolOrgId(c),userId:c.userId ?? 'crew' }), 'create'),
  computer_update_skill: tool('computer_update_skill', 'Update a saved skill name, description or goal without executing it.', z.object({ skillId:z.string().uuid(),name:title.optional(),description:z.string().max(4000).optional(),goalExample:z.string().max(4000).optional() }), async ({skillId,...p},c) => (await skills()).updateSkill(requireToolOrgId(c),skillId,p), 'update'),
  computer_archive_skill: tool('computer_archive_skill', 'Archive a saved skill without running a desktop action.', z.object({ skillId:z.string().uuid(),userConfirmed:confirmed }), async (p,c) => (await skills()).archiveSkill(requireToolOrgId(c),p.skillId), 'delete'),
};
