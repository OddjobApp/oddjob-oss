import { describe, expect, it } from 'vitest';
import { createEmptyRuleTree } from './rule-builder-state';

describe('new rule state', () => {
  it('contains no inferred conditions or customer-specific data', () => {
    expect(createEmptyRuleTree()).toEqual({
      id: 'root-and',
      type: 'group',
      logic: 'AND',
      children: [],
    });
  });

  it('returns isolated state for each builder instance', () => {
    const first = createEmptyRuleTree();
    const second = createEmptyRuleTree();
    expect(first).not.toBe(second);
    expect(first.children).not.toBe(second.children);
  });
});
