import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StudioMountNotice, studioMountKind } from './StudioMountNotice';

/**
 * A mounted studio appears in the rail. The chat turn gets a short pointer to
 * it, not a second copy of the whole studio.
 */

describe('studioMountKind', () => {
  it('recognizes Agent Studio mounts instead of rendering an unknown inline app', () => {
    expect(studioMountKind({ tool: 'mount_agent_studio' })).toBe('agent');
    expect(studioMountKind({ payload: { type: 'agent_studio_pod', props: { agentId: 42 } } })).toBe('agent');
  });
  it('recognises App Studio and Form Studio mounts by tool, payload type or module', () => {
    expect(studioMountKind({ tool: 'mount_app_studio', payload: {} })).toBe('app');
    expect(studioMountKind({ tool: 'other', payload: { type: 'app_studio_pod' } })).toBe('app');
    expect(studioMountKind({ payload: { module: 'FormStudioPod' } })).toBe('form');
    expect(studioMountKind({ tool: 'mount_form_studio' })).toBe('form');
    expect(studioMountKind({ tool: 'mount_scribe_studio', payload: { module: 'ScribeStudioPod' } })).toBeNull();
    expect(studioMountKind({ tool: 'render_intake_form', payload: { module: 'PlatformFormBlock' } })).toBeNull();
  });
});

describe('StudioMountNotice', () => {
  it('points to the studio in the rail', () => {
    render(<StudioMountNotice kind="form" title="Successor readiness" />);
    expect(screen.getByText('Form Studio is open beside the conversation')).toBeInTheDocument();
    expect(screen.getByText(/Successor readiness\./)).toBeInTheDocument();
  });
});
