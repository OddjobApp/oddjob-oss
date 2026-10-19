import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CrewAgentHat, HATS, hatFor } from './CrewAgentHat';

describe('hatFor', () => {
  it.each([
    ['Copilot', 'copilot', 'bowler'],
    ['AI Trainer', 'general', 'cowboy'],
    ['Security Vulnerability & Compliance Auditor', 'general', 'deerstalker'],
    ['Knowledge Architect', 'knowledge-architect', 'mortarboard'],
    ['Creative Director', 'creative-director', 'beret'],
    ['Site Reliability Engineer', 'devops', 'hard-hat'],
    ['Finance Analyst', 'general', 'fedora'],
    ['Service Dispatch Coordinator', 'general', 'flat-cap'],
    ['Producer', 'producer', 'top-hat'],
  ])('%s (%s) wears a %s', (name, persona, hat) => {
    expect(hatFor(name, persona)).toBe(hat);
  });

  it('gives an unmatched agent the same hat from its name alone, wherever it is drawn', () => {
    const hat = hatFor('Zed');
    expect(HATS).toContain(hat);
    expect(hatFor('Zed', null)).toBe(hat);
  });

  it('draws in the agent accent and is decorative unless titled', () => {
    const { container } = render(<CrewAgentHat name="AI Trainer" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('data-hat')).toBe('cowboy');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toMatch(/text-\w+-500/);
  });
});
