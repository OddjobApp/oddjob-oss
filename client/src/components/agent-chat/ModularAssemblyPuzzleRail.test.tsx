import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModularAssemblyPuzzleRail } from './ModularAssemblyPuzzleRail';
import type { AssemblyTurn } from './ModularAssemblyPuzzleRail';

describe('ModularAssemblyPuzzleRail Component', () => {
  /*
   * The four-layer UI / pipeline / dataset / project stack was built from
   * FullStackAssemblyPod artifacts. That pod was retired when calculators and
   * intake forms moved to Form Studio, so an old artifact must not bring the
   * stack, or its Deploy Full Stack button, back.
   */
  it('builds no stack from a retired FullStackAssemblyPod artifact', () => {
    const retired: AssemblyTurn[] = [{
      artifacts: [{
        tool: 'mount_builder_pod',
        payload: {
          module: 'FullStackAssemblyPod',
          component: 'FullStackAssemblyPod',
          props: { appName: 'Mortgage Calculator', uiFields: [{ name: 'principal', label: 'Loan Amount ($)', type: 'number' }], steps: [], datasetFields: [] },
        },
      }],
    }];

    render(<ModularAssemblyPuzzleRail turns={retired} />);

    expect(screen.queryByTestId('crew-assembly-puzzle-rail')).not.toBeInTheDocument();
    expect(screen.queryByText('1. UI Input Form')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy Full Stack')).not.toBeInTheDocument();
  });

  it('keeps the scaffold rail visible after Scribe exits without builder artifacts', () => {
    const scribeOnlyTurns: AssemblyTurn[] = [{
      artifacts: [{
        tool: 'mount_scribe_studio',
        payload: { type: 'scribe_foundry_pod', documentId: 12, title: 'Agreement' },
      }],
    }];

    render(<ModularAssemblyPuzzleRail turns={scribeOnlyTurns} isScribeVisible={false} />);

    expect(screen.getByTestId('crew-assembly-puzzle-rail')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-scaffold-empty-state')).toBeInTheDocument();
    expect(screen.getByText('Scaffold mode')).toBeInTheDocument();
  });

  it('does not mount an empty assembly stack for ordinary conversation', () => {
    render(<ModularAssemblyPuzzleRail turns={[{ artifacts: null, content: 'Discuss quarterly priorities' }]} />);

    expect(screen.queryByTestId('crew-assembly-puzzle-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assembly-scaffold-empty-state')).not.toBeInTheDocument();
  });

  it('renders ontology results as selectable assembly units with stable identity', () => {
    const onSelectionChange = vi.fn();
    const ontologyTurns: AssemblyTurn[] = [{
      artifacts: [{
        tool: 'ontology_get_object',
        payload: {
          type: 'ontology_object',
          title: 'Ontology Object',
          data: { id: 42, objectType: 'Mission', name: 'Launch Readiness', status: 'active' },
        },
      }],
    }];

    render(<ModularAssemblyPuzzleRail turns={ontologyTurns} onSelectionChange={onSelectionChange} />);
    expect(screen.getByText('Launch Readiness')).toBeInTheDocument();
    expect(screen.getByText('1 Units')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Mission'));
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ontology',
      semanticRole: 'execution',
      ontologyRef: { objectType: 'Mission', objectId: 42 },
    }));
  });

  it('shows saved-query lineage, result evidence, report composition, and document format', () => {
    const onSelectionChange = vi.fn();
    const reportTurns: AssemblyTurn[] = [
      {
        artifacts: [{
          tool: 'run_saved_query',
          payload: {
            type: 'assistant_table',
            title: 'Open Incidents',
            description: '2 rows',
            queryId: 11,
            queryDefinition: {
              nodes: [{ id: 'incident', label: 'Incident' }],
              relationships: [],
            },
            columns: [{ key: 'severity', label: 'Severity', type: 'text' }],
            rows: [{ severity: 'high' }, { severity: 'medium' }],
            executionTimeMs: 12,
            truncated: false,
          },
        }],
      },
      {
        artifacts: [{
          tool: 'generate_presentation_deck',
          payload: {
            type: 'presentation_deck',
            title: 'Incident Brief',
            formatCategory: 'executive_brief',
            theme: 'Clean Minimalist',
            blockCount: 4,
            blocks: [{}, {}, {}, {}],
            requiresHilSignoff: false,
            lineage: {
              source: { type: 'saved_query', id: 11, name: 'Open Incidents' },
              output: { type: 'document', formatCategory: 'executive_brief' },
            },
          },
        }],
      },
    ];

    render(<ModularAssemblyPuzzleRail turns={reportTurns} onSelectionChange={onSelectionChange} />);

    expect(screen.getByText('Query Source')).toBeInTheDocument();
    expect(screen.getByText('Query Result')).toBeInTheDocument();
    expect(screen.getByText('Report Composition')).toBeInTheDocument();
    expect(screen.getByText('Document Format')).toBeInTheDocument();
    expect(screen.getByText('2 Rows · 1 Columns')).toBeInTheDocument();
    expect(screen.getAllByText('executive brief')).toHaveLength(2);
    expect(screen.getByText('4 Units')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Query Source'));
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'query',
      semanticRole: 'input',
      sublabel: 'Open Incidents',
    }));
  });

  // The Creative Crew reports executionPhases as objects, not strings. `details`
  // is rendered as raw children, so spreading them in threw "Objects are not
  // valid as a React child" the moment Report Composition was expanded.
  it('flattens creative-crew execution phases into readable detail lines', () => {
    const deckTurns: AssemblyTurn[] = [
      {
        artifacts: [{
          tool: 'generate_presentation_deck',
          payload: {
            type: 'presentation_deck',
            title: 'Incident Brief',
            formatCategory: 'executive_brief',
            theme: 'Clean Minimalist',
            blockCount: 2,
            blocks: [{}, {}],
            requiresHilSignoff: false,
            executionPhases: [
              {
                phase: '1. Information Architecture & Block Sculpting',
                agentId: 'information_architect',
                agentName: 'Information Architect',
                status: 'completed',
                summary: 'Sculpted raw content into 2 atomic document blocks.',
              },
              {
                phase: '2. Brand Alignment',
                agentId: 'brand_steward',
                agentName: 'Brand Steward',
                status: 'skipped',
                summary: 'No brand kit supplied.',
              },
            ],
          },
        }],
      },
    ];

    render(<ModularAssemblyPuzzleRail turns={deckTurns} />);

    fireEvent.click(screen.getByText('Report Composition'));

    expect(
      screen.getByText('Information Architect — Sculpted raw content into 2 atomic document blocks.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Brand Steward — skipped')).toBeInTheDocument();
  });

  /**
   * A room could discuss syncing to a Confluence space with no piece standing
   * for the connection that makes it possible.
   */
  describe('SaaS adapter surface', () => {
    const adapterTurns: AssemblyTurn[] = [
      {
        artifacts: [{
          tool: 'list_saas_adapters',
          payload: {
            type: 'saas_adapters',
            title: 'SaaS Adapters · techhead7',
            projectKey: 'techhead7',
            adapters: [
              {
                connectorId: 4,
                platform: 'confluence',
                status: 'connected',
                projectId: 2,
                projectKey: 'techhead7',
                scope: 'project',
                boundResource: { kind: 'Confluence space', value: 'ENG' },
                lastSync: null,
                syncConfig: { enabled: true, syncIntervalMinutes: 15, conflictResolution: 'last_write_wins' },
                schemaSnapshot: null,
              },
              {
                connectorId: 1,
                platform: 'slack',
                status: 'connected',
                projectId: null,
                projectKey: null,
                scope: 'organization',
                boundResource: null,
                lastSync: '2026-08-15T12:00:00.000Z',
                syncConfig: null,
                schemaSnapshot: { name: 'slack', version: 3, fieldCount: 7, capturedAt: '2026-08-15T12:00:00.000Z' },
              },
            ],
          },
        }],
      },
    ];

    it('gives each adapter a piece, named by the resource it is bound to', () => {
      render(<ModularAssemblyPuzzleRail turns={adapterTurns} />);

      expect(screen.getAllByText('SaaS Adapter')).toHaveLength(2);
      expect(screen.getByText('confluence · ENG')).toBeInTheDocument();
      expect(screen.getByText('slack')).toBeInTheDocument();
    });

    it('distinguishes a project-owned adapter from an inherited one', () => {
      render(<ModularAssemblyPuzzleRail turns={adapterTurns} />);

      expect(screen.getByText('Project')).toBeInTheDocument();
      expect(screen.getByText('Org')).toBeInTheDocument();
    });

    it('reports a never-run sync and an uncaptured schema as absent, not as zero', () => {
      const onSelectionChange = vi.fn();
      render(<ModularAssemblyPuzzleRail turns={adapterTurns} onSelectionChange={onSelectionChange} />);

      fireEvent.click(screen.getByText('confluence · ENG'));

      const selection = onSelectionChange.mock.calls[0][0];
      const byLabel = Object.fromEntries(selection.properties.map((p: any) => [p.label, p.value]));
      // "0 fields" would read as a measurement; none was ever taken.
      expect(byLabel['Schema Snapshot']).toBe('No schema captured');
      expect(byLabel['Last Sync']).toBe('Never synced');
      expect(byLabel['Confluence space']).toBe('ENG');
      expect(byLabel['Scope']).toBe('This project');
    });

    it('reports a captured schema with its version once one exists', () => {
      const onSelectionChange = vi.fn();
      render(<ModularAssemblyPuzzleRail turns={adapterTurns} onSelectionChange={onSelectionChange} />);

      fireEvent.click(screen.getByText('slack'));

      const selection = onSelectionChange.mock.calls[0][0];
      const byLabel = Object.fromEntries(selection.properties.map((p: any) => [p.label, p.value]));
      expect(byLabel['Schema Snapshot']).toBe('v3 · 7 fields');
      expect(byLabel['Scope']).toBe('Organization-wide');
    });
  });

  it('mounts Media Studio when a media studio turn artifact is present', () => {
    const mediaTurns: AssemblyTurn[] = [
      {
        artifacts: [
          {
            tool: 'mount_media_studio',
            payload: {
              type: 'media_studio_pod',
              sceneId: 'SCENE-03',
              sceneTitle: 'High-Speed Chase Sequence',
              mode: 'film',
              aspectRatio: '2.39:1',
            },
          },
        ],
      },
    ];

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
        <ModularAssemblyPuzzleRail turns={mediaTurns} />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('media-studio-rail')).toBeInTheDocument();
    expect(screen.getByTestId('media-studio')).toBeInTheDocument();
  });
});

