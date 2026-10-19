import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TurnRow } from './TurnRow';
afterEach(cleanup);
const turn = (content: string) => ({ id: 1, speakerType: 'agent', speakerName: 'Copilot', content, artifacts: [], toolsUsed: [] }) as any;
describe('Links in crew responses', () => {
  it('renders bare-domain URLs as clickable external links', () => {
    render(<TurnRow turn={turn('Watch youtube.com/watch?v=abc123 for the walkthrough.')} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    const link = screen.getByRole('link', { name: 'youtube.com/watch?v=abc123' });
    expect(link.getAttribute('href')).toBe('https://youtube.com/watch?v=abc123');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
  it('renders raw HTML anchors and keeps filenames as text', () => {
    render(<TurnRow turn={turn('See <a href="https://youtu.be/xyz">this clip</a>, then edit src/index.ts.')} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    expect(screen.getByRole('link', { name: 'this clip' }).getAttribute('href')).toBe('https://youtu.be/xyz');
    expect(screen.queryByRole('link', { name: /src\/index/ })).toBeNull();
    expect(screen.getByText(/src\/index\.ts/)).toBeTruthy();
  });
  it('opens same-origin links without forcing a new tab and keeps internal knowledge paths', () => {
    render(<TurnRow turn={turn('[Source](/knowledge/store?documentId=7617) covers it.')} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    const link = screen.getByRole('link', { name: 'Source' });
    expect(link.getAttribute('href')).toBe('/knowledge/store?documentId=7617');
    expect(link.getAttribute('target')).toBeNull();
  });
  it('does not render javascript: links as navigable', () => {
    render(<TurnRow turn={turn('[Click](javascript:alert(1))')} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Click')).toBeTruthy();
  });
});
