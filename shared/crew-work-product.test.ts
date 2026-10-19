import { describe, expect, it } from 'vitest';
import { collectWorkProducts, crewWorkProductSchema } from './crew-work-product';
import { crewRoomBriefSchema, formatCrewRoomBrief } from './crew-room-brief';

const product = { type: 'crew_work_product', documentKey: 'brief', title: 'Research brief', content: 'Original finding', changeSummary: 'Initial draft' };
describe('room work products and briefs', () => {
  it('orders immutable versions from recorded turns, including user corrections', () => {
    const versions = collectWorkProducts([
      { id: 5, speakerName: 'Human', artifacts: [{ payload: { ...product, content: 'Corrected finding', sourceTurnId: 2 } }] },
      { id: 2, speakerName: 'Researcher', artifacts: [{ payload: product }] },
      { id: 1, speakerName: 'Agent', artifacts: [{ payload: { type: 'crew_work_product' } }] },
    ]);
    expect(versions.map(version => version.content)).toEqual(['Original finding', 'Corrected finding']);
    expect(versions[1].sourceTurnId).toBe(2);
    expect(versions[1].author).toBe('Human');
  });
  it('requires a real objective and explicit bounded success criteria', () => {
    expect(crewRoomBriefSchema.safeParse({ objective: ' ', successCriteria: [] }).success).toBe(false);
    const brief = crewRoomBriefSchema.parse({ objective: 'Compare options', successCriteria: ['Cite evidence'], constraints: ['No external publication'] });
    expect(formatCrewRoomBrief(brief)).toContain('Cite evidence');
    expect(formatCrewRoomBrief(brief)).toContain('No external publication');
    expect(formatCrewRoomBrief()).toBe('');
  });
  it('rejects empty work products and oversized content', () => {
    expect(crewWorkProductSchema.safeParse({ ...product, content: '' }).success).toBe(false);
    expect(crewWorkProductSchema.safeParse({ ...product, content: 'x'.repeat(50001) }).success).toBe(false);
  });
});
