import { describe, expect, it } from 'vitest';
import { RENDER_TOOLS } from '../render-tools';
import { ARTIFACT_TOOLS, UNIVERSAL_PRESENTATION_TOOLS, detectArtifact } from '../../../../crew/core/crew-tools.service';

describe('room work product tool contract', () => {
  it('is offered, retained and detected through the existing artifact pipeline', async () => {
    const name = 'publish_work_product';
    expect(ARTIFACT_TOOLS.has(name)).toBe(true);
    expect(UNIVERSAL_PRESENTATION_TOOLS).toContain(name);
    const output = await RENDER_TOOLS[name].execute({ documentKey: 'research', title: 'Findings', content: 'Sources and findings', changeSummary: 'Initial brief' }, {} as any);
    expect(detectArtifact(name, output)?.payload).toMatchObject({ type: 'crew_work_product', documentKey: 'research' });
  });
});
