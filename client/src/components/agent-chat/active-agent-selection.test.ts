import { beforeEach, describe, expect, it } from 'vitest';
import { activeAgentSelectionKey, loadActiveAgentSelection } from './active-agent-selection';
describe('saved active roster', () => {
  beforeEach(() => localStorage.clear());
  it('preserves empty selection and isolates users, organizations and rooms', () => {
    const key = activeAgentSelectionKey(342, 'u1', 'room');
    localStorage.setItem(key, '[]');
    expect(loadActiveAgentSelection(key, [1, 2])).toEqual([]);
    expect(loadActiveAgentSelection(activeAgentSelectionKey(342, 'u2', 'room'), [1])).toBeNull();
    expect(loadActiveAgentSelection(activeAgentSelectionKey(473, 'u1', 'room'), [1])).toBeNull();
    expect(loadActiveAgentSelection(activeAgentSelectionKey(342, 'u1', 'other'), [1])).toBeNull();
  });
  it('removes unavailable agents and ignores invalid data', () => {
    localStorage.setItem('roster', '[1,1,3]');
    expect(loadActiveAgentSelection('roster', [1, 2])).toEqual([1]);
    localStorage.setItem('roster', '{}');
    expect(loadActiveAgentSelection('roster', [1])).toBeNull();
  });
});
