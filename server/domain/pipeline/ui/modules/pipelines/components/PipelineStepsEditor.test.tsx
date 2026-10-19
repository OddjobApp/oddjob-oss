import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import PipelineStepsEditor from './PipelineStepsEditor.js';

// Mock UI components
vi.mock('@domain-ui/core/ui/components/ui/button', () => ({
    Button: ({ children, onClick, disabled, variant, ...props }: any) => (
        <button onClick={onClick} disabled={disabled} data-testid={props['data-testid'] || "button"}>
            {children}
        </button>
    ),
}));

vi.mock('@domain-ui/core/ui/components/ui/card', () => ({
    Card: ({ children, className, onClick, ...props }: any) => (
        <div data-testid={props['data-testid'] || "card"} className={className} onClick={onClick}>
            {children}
        </div>
    ),
    CardContent: ({ children, onClick }: any) => <div data-testid="card-content" onClick={onClick}>{children}</div>,
}));

vi.mock('@domain-ui/core/ui/components/ui/label', () => ({
    Label: ({ children }: any) => <label>{children}</label>,
}));

vi.mock('@domain-ui/core/ui/components/ui/select', () => ({
    Select: ({ children, value, onValueChange }: any) => <div data-testid="select" data-value={value}>{children}</div>,
    SelectTrigger: ({ children }: any) => <button>{children}</button>,
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => <div data-testid={`select-item-${value}`}>{children}</div>,
}));

// Mock icons
vi.mock('lucide-react', () => ({
    Plus: () => <span data-testid="plus-icon">Plus</span>,
    Zap: () => <span data-testid="zap-icon">Zap</span>,
    GitBranch: () => <span data-testid="branch-icon">Branch</span>,
    MoveUp: () => <span data-testid="up-icon">Up</span>,
    MoveDown: () => <span data-testid="down-icon">Down</span>,
    X: () => <span data-testid="x-icon">X</span>,
    Info: () => <span data-testid="info-icon">Info</span>,
}));

describe('PipelineStepsEditor', () => {
    const mockJobs = [
        { id: 1, name: 'Test Job 1', type: 'shell' },
        { id: 2, name: 'Test Job 2', type: 'api' },
    ];

    const mockSteps = [
        { tempId: 'step-1', jobId: 1, order: 0, outputName: 'out1' },
    ];

    const defaultProps = {
        steps: mockSteps,
        jobs: mockJobs,
        jobsLoading: false,
        onAddStep: vi.fn(),
        onAddTransformationStep: vi.fn(),
        onRemoveStep: vi.fn(),
        onUpdateStep: vi.fn(),
        onMoveStep: vi.fn(),
        onStepClick: vi.fn(),
        selectedStepIndex: null,
        canAddTransformer: false,
        validationError: '',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the steps editor correctly', () => {
        render(<PipelineStepsEditor {...defaultProps} />);
        expect(screen.getByText('Pipeline Steps *')).toBeInTheDocument();
        expect(screen.getByText('Add Step')).toBeInTheDocument();
        expect(screen.getByTestId('step-card-0')).toBeInTheDocument();
    });

    it('handles adding a step', async () => {
        const user = userEvent.setup();
        render(<PipelineStepsEditor {...defaultProps} />);
        await user.click(screen.getByText('Add Step'));
        expect(defaultProps.onAddStep).toHaveBeenCalled();
    });

    it('handles removing a step', async () => {
        const user = userEvent.setup();
        render(<PipelineStepsEditor {...defaultProps} />);
        // Click the X button in the first step
        const removeButton = screen.getByTestId('button-remove-step-0');
        await user.click(removeButton);
        expect(defaultProps.onRemoveStep).toHaveBeenCalledWith('step-1');
    });

    it('handles clicking a step card', async () => {
        const user = userEvent.setup();
        render(<PipelineStepsEditor {...defaultProps} />);
        const card = screen.getByTestId('step-card-0');
        await user.click(card);
        expect(defaultProps.onStepClick).toHaveBeenCalledWith(0);
    });

    it('shows transformer button when allowed', () => {
        render(<PipelineStepsEditor {...defaultProps} canAddTransformer={true} />);
        expect(screen.getByText('Add Transformation Step')).toBeInTheDocument();
    });

    it('shows validation error', () => {
        render(<PipelineStepsEditor {...defaultProps} validationError="Something is wrong" />);
        expect(screen.getByText('Something is wrong')).toBeInTheDocument();
    });
});
