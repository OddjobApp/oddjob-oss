import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CyclePipelineRightRail } from './CyclePipelineRightRail';

describe('CyclePipelineRightRail', () => {
    it('renders all 4 cycle pipeline workflow stages', () => {
        render(<CyclePipelineRightRail activeTopic="Test Operational Deliberation" />);

        expect(screen.getByText('Cycle Pipeline')).toBeInTheDocument();
        expect(screen.getByText('1. Ingest')).toBeInTheDocument();
        expect(screen.getByText('2. Triage & Deliberation')).toBeInTheDocument();
        expect(screen.getByText('3. Squad Dispatch')).toBeInTheDocument();
        expect(screen.getByText('4. Telemetry Handshake')).toBeInTheDocument();
        expect(screen.getByText(/Test Operational Deliberation/)).toBeInTheDocument();
    });

    it('renders all 4 modular assembly stack layers', () => {
        render(<CyclePipelineRightRail />);

        expect(screen.getByText('Assembly Stack')).toBeInTheDocument();
        expect(screen.getByText('1. UI / View Component')).toBeInTheDocument();
        expect(screen.getByText('2. Pipeline / Logic DAG')).toBeInTheDocument();
        expect(screen.getByText('3. Dataset Schema')).toBeInTheDocument();
        expect(screen.getByText('4. Project Scope')).toBeInTheDocument();
    });

    it('collapses and expands smoothly with toggle buttons', () => {
        render(<CyclePipelineRightRail />);

        // Rail is initially expanded
        const collapseBtn = screen.getByTestId('collapse-cycle-pipeline-rail-btn');
        fireEvent.click(collapseBtn);

        // Rail is now collapsed
        expect(screen.getByTestId('cycle-pipeline-right-rail-collapsed')).toBeInTheDocument();

        // Click expand button
        const expandBtn = screen.getByTestId('expand-cycle-pipeline-rail-btn');
        fireEvent.click(expandBtn);

        // Rail is expanded again
        expect(screen.getByTestId('cycle-pipeline-right-rail')).toBeInTheDocument();
    });

    it('renders cycle fleet telemetry when cycleFleetData is provided', () => {
        render(
            <CyclePipelineRightRail
                cycleFleetData={{
                    cycleSlug: 'cycle-telemetry-99',
                    cycleName: 'Mission Apollo',
                    apps: [{ id: 1 }, { id: 2 }],
                }}
            />
        );

        expect(screen.getByText('cycle-telemetry-99')).toBeInTheDocument();
        expect(screen.getByText('Mission Apollo')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('honors controlled isCollapsed and calls onToggleCollapse', () => {
        const toggleSpy = vi.fn();
        const { rerender } = render(
            <CyclePipelineRightRail
                isCollapsed={false}
                onToggleCollapse={toggleSpy}
            />
        );

        expect(screen.getByTestId('cycle-pipeline-right-rail')).toBeInTheDocument();
        const collapseBtn = screen.getByTestId('collapse-cycle-pipeline-rail-btn');
        fireEvent.click(collapseBtn);
        expect(toggleSpy).toHaveBeenCalledTimes(1);

        rerender(
            <CyclePipelineRightRail
                isCollapsed={true}
                onToggleCollapse={toggleSpy}
            />
        );
        expect(screen.getByTestId('cycle-pipeline-right-rail-collapsed')).toBeInTheDocument();
        const expandBtn = screen.getByTestId('expand-cycle-pipeline-rail-btn');
        fireEvent.click(expandBtn);
        expect(toggleSpy).toHaveBeenCalledTimes(2);
    });
});
