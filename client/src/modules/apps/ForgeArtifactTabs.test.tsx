import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ForgeArtifactTabs, groupForFile } from './ForgeArtifactTabs';
import { initialForgeStudioState, type ForgeStudioState } from '@shared/forge-studio-events';

afterEach(cleanup);

const withState = (over: Partial<ForgeStudioState> = {}): ForgeStudioState => ({
  ...initialForgeStudioState(),
  ...over,
});

const FULL = withState({
  components: [
    { module: 'MetricGrid', componentName: 'MetricGrid', category: 'data', status: 'mounted' },
    { module: 'StatusTimeline', componentName: 'StatusTimeline', category: 'feedback', status: 'selected' },
  ],
  files: [
    { path: 'app/page.tsx', status: 'written' },
    { path: 'app/api/orders/route.ts', status: 'writing' },
    { path: 'tailwind.config.ts', status: 'written' },
  ],
  apiContract: {
    openapi: '3.1.0',
    basePath: '/api',
    status: 'validating',
    endpoints: [{ id: '1', method: 'GET', path: '/api/orders', auth: 'bearer', status: 'ready' }],
    schemas: [{ name: 'Order', fields: [{ name: 'id' }, { name: 'total' }] }],
    generatedFiles: ['app/api/orders/route.ts'],
  },
  log: [{ message: 'Ignition: launching', level: 'info' }],
});

describe('ForgeArtifactTabs — the five surfaces', () => {
  it('exposes exactly the tabs the spec names', () => {
    render(<ForgeArtifactTabs studio={FULL} />);
    for (const id of ['preview', 'api', 'components', 'files', 'diagnostics']) {
      expect(screen.getByTestId(`forge-tab-${id}`)).toBeInTheDocument();
    }
  });

  it('opens on the preview', () => {
    render(<ForgeArtifactTabs studio={FULL} />);
    expect(screen.getByTestId('forge-panel-preview')).toBeInTheDocument();
  });

  it('can be opened directly on the view a request routed to', () => {
    render(<ForgeArtifactTabs studio={FULL} initialTab="api" />);
    expect(screen.getByTestId('forge-panel-api')).toBeInTheDocument();
  });
});

describe('Live Preview', () => {
  /*
   * "Show the runnable application as early as possible" — but a frame with no
   * URL is a blank white box, which reads as a broken app rather than an
   * unfinished one.
   */
  it('shows skeletons for what is still being generated, not an empty frame', () => {
    render(<ForgeArtifactTabs studio={FULL} previewUrl={null} />);
    expect(screen.getByTestId('forge-preview-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('forge-preview-frame')).not.toBeInTheDocument();
  });

  it('mounts the runnable app once there is something to show', () => {
    render(<ForgeArtifactTabs studio={FULL} previewUrl="/forged/ops" />);
    expect(screen.getByTestId('forge-preview-frame')).toHaveAttribute('src', '/forged/ops');
  });

  it('offers desktop, tablet and mobile viewports', () => {
    render(<ForgeArtifactTabs studio={FULL} previewUrl="/forged/ops" />);

    const mobile = screen.getByTestId('forge-viewport-mobile');
    fireEvent.click(mobile);

    expect(mobile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('forge-preview-frame')).toHaveStyle({ width: '390px' });
  });

  /*
   * "Refresh affected regions without resetting the entire studio." The frame is
   * keyed on the revision, so a preview update reloads the iframe and nothing
   * above it.
   */
  it('reloads the frame on a new revision rather than resetting the studio', () => {
    const { rerender } = render(
      <ForgeArtifactTabs studio={withState({ ...FULL, previewRevision: 'r1' })} previewUrl="/forged/ops" />,
    );
    const first = screen.getByTestId('forge-preview-frame');

    rerender(
      <ForgeArtifactTabs studio={withState({ ...FULL, previewRevision: 'r2' })} previewUrl="/forged/ops" />,
    );

    expect(screen.getByTestId('forge-preview-frame')).not.toBe(first);
  });
});

describe('API', () => {
  it('shows the contract before its routes exist', () => {
    render(<ForgeArtifactTabs studio={FULL} initialTab="api" />);

    expect(screen.getByText(/OpenAPI 3\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Base path \/api/)).toBeInTheDocument();
    expect(screen.getByTestId('forge-api-endpoints')).toHaveTextContent('/api/orders');
    expect(screen.getByTestId('forge-api-schemas')).toHaveTextContent('Order');
  });

  it('shows the validating state the contract reports', () => {
    render(<ForgeArtifactTabs studio={FULL} initialTab="api" />);
    expect(screen.getByTestId('forge-panel-api')).toHaveTextContent('validating');
  });

  it('says the contract comes first when there is not one yet', () => {
    render(<ForgeArtifactTabs studio={withState()} initialTab="api" />);
    expect(screen.getByTestId('forge-panel-api')).toHaveTextContent(/specified before its routes/);
  });
});

describe('Components and Files', () => {
  it('names each gallery component, its category and its status', () => {
    render(<ForgeArtifactTabs studio={FULL} initialTab="components" />);

    const list = screen.getByTestId('forge-component-list');
    expect(list).toHaveTextContent('MetricGrid');
    expect(list).toHaveTextContent('data');
    expect(list).toHaveTextContent('mounted');
    expect(list).toHaveTextContent('selected');
  });

  it('groups files by the part of the app they belong to', () => {
    render(<ForgeArtifactTabs studio={FULL} initialTab="files" />);

    const groups = screen.getByTestId('forge-file-groups');
    expect(groups).toHaveTextContent('Pages (1)');
    expect(groups).toHaveTextContent('API (1)');
    expect(groups).toHaveTextContent('Configuration (1)');
  });

  it('shows write status per file, so a file in flight is not read as finished', () => {
    render(<ForgeArtifactTabs studio={FULL} initialTab="files" />);
    expect(screen.getByTestId('forge-file-groups')).toHaveTextContent('writing');
  });
});

describe('groupForFile', () => {
  it.each([
    ['app/page.tsx', 'Pages'],
    ['app/api/orders/route.ts', 'API'],
    ['src/components/Chart.tsx', 'Components'],
    ['lib/db.ts', 'Data'],
    ['tailwind.config.ts', 'Configuration'],
    ['package.json', 'Configuration'],
  ])('puts %s under %s', (path, group) => {
    expect(groupForFile(path)).toBe(group);
  });
});

describe('Diagnostics', () => {
  /*
   * The spec is explicit: SAT/DPLL keeps running internally and must not appear
   * in the primary build experience. It is useful when a build picks scaffolding
   * you did not expect, so it lives here and only here.
   */
  it('keeps the scaffold proof out of every panel except diagnostics', () => {
    const studio = withState({
      ...FULL,
      scaffoldProof: {
        requestedPacks: ['ui-oddjob-design-system'],
        selectedPacks: ['ui-oddjob-design-system', 'core-node-express'],
        executionOrder: ['core-node-express'],
        proofExplanation: 'Resolved by unit propagation',
      },
    });

    render(<ForgeArtifactTabs studio={studio} initialTab="preview" />);
    expect(screen.queryByTestId('forge-scaffold-proof')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('forge-tab-diagnostics'));
    expect(screen.getByTestId('forge-scaffold-proof')).toHaveTextContent('unit propagation');
  });

  it('preserves the detailed events rather than only the latest line', () => {
    const studio = withState({
      log: [
        { message: 'Discovery: reading the request', level: 'info' },
        { message: 'Hardening findings: missing alt text', level: 'warn' },
      ],
    });

    render(<ForgeArtifactTabs studio={studio} initialTab="diagnostics" />);
    const log = screen.getByTestId('forge-build-log');
    expect(log).toHaveTextContent('Discovery: reading the request');
    expect(log).toHaveTextContent('missing alt text');
  });

  it('shows a failure where the technical detail lives', () => {
    const studio = withState({ error: { message: 'tsc exited 1', stage: 4 } });
    render(<ForgeArtifactTabs studio={studio} initialTab="diagnostics" />);
    expect(screen.getByTestId('forge-panel-diagnostics')).toHaveTextContent('tsc exited 1');
  });
});
