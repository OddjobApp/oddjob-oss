import { STUDIOS, STUDIO_KINDS } from '@shared/studio-registry.js';

/**
 * Curated editing reach, scoped to the studio the room is actually working in.
 *
 * Read and create/update verbs are granted; destructive verbs (`delete_*`,
 * `*_archive`, `*_disable`) are deliberately NOT — the grant is conferred
 * silently by an artifact appearing in room history and persists for the
 * session, so irreversible operations need a stronger gate than "a studio was
 * once mounted here". Supported deletions instead go through the contribution
 * card's resource-specific approval path below.
 */
export const STUDIO_AGENT_TOOLS: Record<string, readonly string[]> = {
  form: ['form_list','form_get','form_create','form_update'],
  scribe: ['scribe_list_documents','scribe_get_document','scribe_add_station','scribe_update_node','scribe_rename_station'],
  media: ['media_list_productions','media_get_production','media_create_production','media_update_production','media_add_scene','media_update_scene'],
  signal: ['list_signal_feeds','signal_get_feed','signal_create_feed','signal_update_feed'],
  flow: ['list_pipelines','get_pipeline_details','create_pipeline','update_pipeline','add_pipeline_step','update_pipeline_step'],
  prediction: ['list_jobs','get_job_details','create_job','update_job','mount_prediction_studio'],
  project: ['project_list','project_get','project_create','project_update'],
  agent: ['agent_list_cards','agent_get_card','agent_create_card','agent_update_card'],
  computer: ['trycua_list_skills','computer_get_skill','computer_create_skill','computer_update_skill'],
  app: ['studio_list_files','studio_read_file','forge_edit_file','apply_app_change','revert_app_change','propose_app_draft','inspect_app_scaffold'],
};
/** Destructive tools require the contribution card's explicit apply message. */
export const STUDIO_DESTRUCTIVE_ACTIONS: Record<string, { studio: string; idField: string }> = {
  form_archive: { studio: 'form', idField: 'formId' },
  scribe_delete_station: { studio: 'scribe', idField: 'nodeId' },
  media_delete_scene: { studio: 'media', idField: 'sceneId' },
  signal_disable_feed: { studio: 'signal', idField: 'feedId' },
  project_archive: { studio: 'project', idField: 'projectId' },
  agent_disable_card: { studio: 'agent', idField: 'agentId' },
  computer_archive_skill: { studio: 'computer', idField: 'skillId' },
};
export function normalizeCrewStudio(studio?: string | null): string | undefined {
  if (studio === 'forge' || studio === 'builder') return 'app';
  return studio && Object.hasOwn(STUDIO_AGENT_TOOLS,studio) ? studio : undefined;
}
export function crewStudioForTurns(turns: Array<{ artifacts?: any }>, initial?: string | null): string | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const artifacts = Array.isArray(turns[i].artifacts) ? turns[i].artifacts : [];
    for (let j = artifacts.length - 1; j >= 0; j--) {
      const artifact = artifacts[j], payload = artifact?.payload;
      for (const kind of STUDIO_KINDS) {
        const spec = STUDIOS[kind];
        if ((spec.mountedVia === 'tool' && (artifact?.tool === spec.mountTool || payload?.type === spec.podType)) ||
          ('podComponent' in spec && payload?.podComponent === spec.podComponent)) return kind;
      }
    }
  }
  return normalizeCrewStudio(initial);
}

/** Explicit UI selection wins; null means the user has left the studio. */
export function resolveCrewStudio(active: string | null | undefined, turns: Array<{ artifacts?: any }>, initial?: string | null): string | undefined {
  return active !== undefined ? normalizeCrewStudio(active) : crewStudioForTurns(turns, initial);
}
