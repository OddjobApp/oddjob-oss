import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * These exercise the two things the workstream HUD has to do beyond listing:
 * say what the unit DOES in one line, and let a detail be edited.
 *
 * The HUD is internal to AgentChatPanel, so the summary and editor are covered
 * through the exported helpers rather than by mounting the whole panel with a
 * live session — the panel needs a query client, SSE and a session fetch, none
 * of which this behaviour depends on.
 */

// The helpers under test are module-private; re-import them via the test hook
// the module exposes for exactly this reason.
import { __assemblyHudTestHooks as hooks } from './AgentChatPanel';

const pipelineUnit = {
  id: 'piece-pipeline',
  label: '2. Pipeline DAG',
  sublabel: 'Tip Calculator Execution',
  type: 'pipeline' as const,
  jobSteps: [
    { name: 'Extract Ingestion Payload', jobType: 'data_extract' },
    { name: 'Classify Business', jobType: 'ai_inference', isConditional: true, condition: 'guestCount > 2' },
    { name: 'Persist to Dataset', jobType: 'action_dispatch' },
  ],
  decisions: [
    { type: 'cel' as const, label: 'Classify Business', expression: 'guestCount > 2' },
  ],
  properties: [],
};

describe('business logic summary', () => {
  it('states the flow and the rules applied', () => {
    const summary = hooks.summariseBusinessLogic(pipelineUnit);

    expect(summary).toContain('Extract Ingestion Payload → Classify Business → Persist to Dataset');
    expect(summary).toContain('1 of 3 steps are conditional');
    expect(summary).toContain('guestCount > 2');
  });

  it('says plainly when nothing gates the flow, rather than leaving it ambiguous', () => {
    const summary = hooks.summariseBusinessLogic({
      ...pipelineUnit,
      jobSteps: [{ name: 'Extract', jobType: 'data_extract' }],
      decisions: [],
    });

    expect(summary).toContain('No conditional rules or formulas are applied.');
  });

  it('describes a dataset in Oddjob terms, not storage-engine terms', () => {
    const summary = hooks.summariseBusinessLogic({
      id: 'piece-dataset',
      label: '3. Dataset',
      sublabel: 'tip_calculator_records',
      type: 'dataset' as const,
      properties: [
        { label: 'Dataset', value: 'tip_calculator_records' },
        { label: 'bill', value: 'number' },
        { label: 'tip', value: 'number' },
      ],
    });

    expect(summary).toContain('2 fields');
    expect(summary).toContain('dataset');
    expect(summary).not.toMatch(/postgres|table|column/i);
  });
});

describe('assembly detail editor', () => {
  const openEditor = () => {
    const onApply = vi.fn();
    render(
      <hooks.AssemblyDetailEditor
        unit={pipelineUnit}
        open
        onOpenChange={() => {}}
        onApply={onApply}
      />,
    );
    return onApply;
  };

  it('cannot apply until something actually changed', () => {
    openEditor();
    expect(screen.getByTestId('assembly-editor-apply')).toBeDisabled();
  });

  it('sends a scoped instruction describing only what changed', () => {
    const onApply = openEditor();

    // Every step row exposes a condition field — that is the point, since a
    // step with no condition is exactly what you want to be able to gate. Pick
    // the second row's, matching "Classify Business".
    const conditionInputs = screen.getAllByPlaceholderText('e.g. guestCount > 2');
    expect(conditionInputs).toHaveLength(3);
    fireEvent.change(conditionInputs[1], { target: { value: 'guestCount > 4' } });

    const applyBtn = screen.getByTestId('assembly-editor-apply');
    expect(applyBtn).not.toBeDisabled();
    fireEvent.click(applyBtn);

    expect(onApply).toHaveBeenCalledTimes(1);
    const instruction = onApply.mock.calls[0][0];

    // Scoped, so the room applies it to the pipeline and not to whatever was
    // last discussed.
    expect(instruction).toContain('[Applies to the pipeline DAG of "Tip Calculator Execution"]');
    expect(instruction).toContain('guestCount > 4');
    // Untouched rows must not appear, or the instruction reads as a rewrite of
    // the whole unit.
    expect(instruction).not.toContain('Extract Ingestion Payload');
  });

  it('prevents incomplete surface edits and lets the user reset safely', () => {
    openEditor();
    const name = screen.getByLabelText('Extract Ingestion Payload name');
    fireEvent.change(name, { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Names and values cannot be empty');
    expect(screen.getByTestId('assembly-editor-apply')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Extract Ingestion Payload name')).toHaveValue('Extract Ingestion Payload');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows ontology identity and semantic role for ontology-backed surfaces', () => {
    render(
      <hooks.AssemblyDetailEditor
        unit={{
          id: 'ontology-mission-42', label: 'Mission', sublabel: 'Launch Readiness', type: 'ontology',
          semanticRole: 'execution', ontologyRef: { objectType: 'Mission', objectId: 42 },
          properties: [{ label: 'status', value: 'active' }],
        }}
        open onOpenChange={() => {}} onApply={() => {}}
      />,
    );
    expect(screen.getByText('execution')).toBeInTheDocument();
    expect(screen.getByText('Mission · 42')).toBeInTheDocument();
  });
});

/**
 * The editor used to render every property as two free-text boxes, which made a
 * measured fact look like a setting and left closed vocabularies to be recalled
 * and retyped exactly.
 */
describe('assembly detail editor — selection and read-only surfaces', () => {
  const documentUnit = {
    id: 'report-format-presentation_deck',
    label: 'Document Format',
    sublabel: 'presentation deck',
    type: 'document' as const,
    properties: [
      { label: 'Format', value: 'presentation_deck' },
      { label: 'Theme', value: 'Glass Corporate' },
      { label: 'Human Sign-off', value: 'Not required' },
    ],
  };

  const resultUnit = {
    id: 'query-result-open-incidents',
    label: 'Query Result',
    sublabel: 'Open Incidents',
    type: 'result' as const,
    properties: [
      { label: 'Rows', value: '2' },
      { label: 'Columns', value: 'Severity' },
      { label: 'Execution', value: '12 ms' },
      { label: 'Completeness', value: 'Complete result' },
    ],
  };

  const open = (unit: any) => {
    const onApply = vi.fn();
    render(<hooks.AssemblyDetailEditor unit={unit} open onOpenChange={() => {}} onApply={onApply} />);
    return onApply;
  };

  it('offers closed vocabularies as a menu rather than a text box', () => {
    open(documentUnit);

    for (const field of ['Format', 'Theme', 'Human Sign-off']) {
      const control = screen.getByLabelText(`${field} value`);
      expect(control).toHaveAttribute('role', 'combobox');
    }
  });

  it('keeps an agent-produced value outside the known set selectable', () => {
    open({ ...documentUnit, properties: [{ label: 'Format', value: 'zine_spread' }] });

    // Folded into the options rather than dropped, so opening the menu cannot
    // silently rewrite what the agents actually produced.
    expect(screen.getByLabelText('Format value')).toHaveTextContent('zine_spread');
  });

  it('does not offer to rename a system field name', () => {
    open(documentUnit);

    expect(screen.queryByLabelText('Format name')).not.toBeInTheDocument();
    expect(screen.getByText('Format')).toBeInTheDocument();
  });

  it('presents measured evidence as fact, not as an editable setting', () => {
    open(resultUnit);

    for (const field of ['Rows', 'Columns', 'Execution', 'Completeness']) {
      expect(screen.queryByLabelText(`${field} value`)).not.toBeInTheDocument();
    }
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getAllByText('Measured from the run').length).toBe(4);
  });

  it('says a fully measured surface has nothing to change instead of showing a dead form', () => {
    open(resultUnit);

    expect(screen.getByText(/nothing to change/i)).toBeInTheDocument();
    expect(screen.getByText('Nothing on this surface can be edited.')).toBeInTheDocument();
    expect(screen.getByTestId('assembly-editor-apply')).toBeDisabled();
  });

  it('still renames a user-authored step label', () => {
    openEditorForPipeline();
    expect(screen.getByLabelText('Extract Ingestion Payload name')).toBeInTheDocument();
  });

  function openEditorForPipeline() {
    render(
      <hooks.AssemblyDetailEditor unit={pipelineUnit} open onOpenChange={() => {}} onApply={() => {}} />,
    );
  }
});

/**
 * An adapter mixes settings with observed state, and the two must not look alike:
 * the sync cadence is a decision, the last sync is a report.
 */
describe('assembly detail editor — SaaS adapter surface', () => {
  const adapterUnit = {
    id: 'adapter-4',
    label: 'SaaS Adapter',
    sublabel: 'confluence · ENG',
    type: 'adapter' as const,
    semanticRole: 'reference' as const,
    properties: [
      { label: 'Platform', value: 'confluence' },
      { label: 'Connection', value: 'connected' },
      { label: 'Scope', value: 'This project' },
      { label: 'Confluence space', value: 'ENG' },
      { label: 'Sync', value: 'Every 15 min' },
      { label: 'Conflict Resolution', value: 'last_write_wins' },
      { label: 'Last Sync', value: 'Never synced' },
      { label: 'Schema Snapshot', value: 'No schema captured' },
    ],
  };

  const openAdapter = () => {
    const onApply = vi.fn();
    render(<hooks.AssemblyDetailEditor unit={adapterUnit} open onOpenChange={() => {}} onApply={onApply} />);
    return onApply;
  };

  it('locks what the connector reports rather than inviting an edit', () => {
    openAdapter();

    for (const reported of ['Platform', 'Connection', 'Last Sync', 'Schema Snapshot', 'Sync']) {
      expect(screen.queryByLabelText(`${reported} value`)).not.toBeInTheDocument();
    }
    expect(screen.getByText('No schema captured')).toBeInTheDocument();
    expect(screen.getByText('Never synced')).toBeInTheDocument();
  });

  it('offers scope and conflict policy as choices', () => {
    openAdapter();

    expect(screen.getByLabelText('Scope value')).toHaveAttribute('role', 'combobox');
    expect(screen.getByLabelText('Conflict Resolution value')).toHaveAttribute('role', 'combobox');
  });

  it('lets the bound Confluence space be retargeted', () => {
    const onApply = openAdapter();

    const space = screen.getByLabelText('Confluence space value');
    fireEvent.change(space, { target: { value: 'OPS' } });
    fireEvent.click(screen.getByTestId('assembly-editor-apply'));

    const instruction = onApply.mock.calls[0][0];
    expect(instruction).toContain('[Applies to the SaaS adapter of "confluence · ENG"]');
    expect(instruction).toContain('"OPS"');
  });
});
