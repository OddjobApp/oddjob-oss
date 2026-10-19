import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import PipelineTriggerConfig from './PipelineTriggerConfig.js';

// Mock UI components
vi.mock('@domain-ui/core/ui/components/ui/button', () => ({
    Button: ({ children, onClick, variant, ...props }: any) => (
        <button onClick={onClick} data-variant={variant} {...props}>
            {children}
        </button>
    ),
}));

vi.mock('@domain-ui/core/ui/components/ui/form', () => ({
    FormField: ({ render }: { render: (props: any) => React.ReactNode }) => render({
        field: {
            value: '',
            onChange: vi.fn(),
            name: 'test'
        }
    }),
    FormItem: ({ children }: { children: React.ReactNode }) => <div data-testid="form-item">{children}</div>,
    FormLabel: ({ children }: { children: React.ReactNode }) => <div data-testid="form-label">{children}</div>,
    FormControl: ({ children }: { children: React.ReactNode }) => <div data-testid="form-control">{children}</div>,
    FormMessage: () => <div data-testid="form-message" />,
    FormDescription: ({ children }: { children: React.ReactNode }) => <div data-testid="form-description">{children}</div>,
}));

vi.mock('@domain-ui/core/ui/components/ui/input', () => ({
    Input: (props: any) => <input data-testid="input" {...props} />,
}));

describe('PipelineTriggerConfig', () => {
    const mockForm = {
        control: {},
    };
    const mockOnChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders all trigger type buttons', () => {
        render(
            <PipelineTriggerConfig
                triggerType="manual"
                onChange={mockOnChange}
                form={mockForm as any}
            />
        );

        expect(screen.getByText('Manual')).toBeInTheDocument();
        expect(screen.getByText('Schedule')).toBeInTheDocument();
        expect(screen.getByText('Webhook')).toBeInTheDocument();
        expect(screen.getByText('Event')).toBeInTheDocument();
    });

    it('highlights the active trigger type', () => {
        render(
            <PipelineTriggerConfig
                triggerType="webhook"
                onChange={mockOnChange}
                form={mockForm as any}
            />
        );

        const webhookButton = screen.getByTestId('button-trigger-webhook');
        expect(webhookButton).toHaveAttribute('data-variant', 'default');

        const manualButton = screen.getByTestId('button-trigger-manual');
        expect(manualButton).toHaveAttribute('data-variant', 'outline');
    });

    it('calls onChange when a button is clicked', () => {
        render(
            <PipelineTriggerConfig
                triggerType="manual"
                onChange={mockOnChange}
                form={mockForm as any}
            />
        );

        fireEvent.click(screen.getByTestId('button-trigger-schedule'));
        expect(mockOnChange).toHaveBeenCalledWith('schedule');
    });

    it('shows configuration fields for event trigger', () => {
        render(
            <PipelineTriggerConfig
                triggerType="event"
                onChange={mockOnChange}
                form={mockForm as any}
            />
        );

        expect(screen.getByText('Event Type (Exact Match)')).toBeInTheDocument();
        expect(screen.getByText('Filter Condition (JS Expression)')).toBeInTheDocument();
    });

    it('shows configuration fields for webhook trigger', () => {
        render(
            <PipelineTriggerConfig
                triggerType="webhook"
                onChange={mockOnChange}
                form={mockForm as any}
            />
        );

        expect(screen.getByText('Webhook Credential (Optional)')).toBeInTheDocument();
    });
});
