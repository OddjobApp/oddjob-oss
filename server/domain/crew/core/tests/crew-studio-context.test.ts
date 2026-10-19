import { describe, expect, it } from 'vitest';
import { crewStudioForTurns, normalizeCrewStudio, resolveCrewStudio, STUDIO_AGENT_TOOLS } from '../crew-studio-tools.js';

describe('Studio editing context', () => {
  const history = [{ artifacts: [{ tool: 'mount_form_studio' }] }];
  it('uses the currently visible studio over a historical mount', () => {
    expect(resolveCrewStudio('media', history, 'form')).toBe('media');
  });
  it('revokes the implicit studio context after the user exits', () => {
    expect(resolveCrewStudio(null, history, 'form')).toBeUndefined();
  });
  it('preserves historical context for clients that omit selection', () => {
    expect(resolveCrewStudio(undefined, history)).toBe('form');
    expect(crewStudioForTurns([], 'forge')).toBe('app');
  });
  it('rejects unknown studio names and does not inherit old grants', () => {
    expect(resolveCrewStudio('administrator', history)).toBeUndefined();
    expect(normalizeCrewStudio('__proto__')).toBeUndefined();
  });
  it('keeps resource mutations within their respective studio grants', () => {
    expect(STUDIO_AGENT_TOOLS.form).toContain('form_update');
    expect(STUDIO_AGENT_TOOLS.media).not.toContain('form_update');
    expect(Object.values(STUDIO_AGENT_TOOLS).flat()).not.toContain('project_archive');
  });
});
