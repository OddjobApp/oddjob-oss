import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import PipelineFormHeader from './PipelineFormHeader.js';
import { useForm } from 'react-hook-form';

// Mock react-hook-form
vi.mock('react-hook-form', () => ({
    useForm: vi.fn(),
    FormProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useFormContext: () => ({}),
}));

// Mock UI components
vi.mock('@domain-ui/core/ui/components/ui/card', () => ({
    Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
    CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
    CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
    CardTitle: ({ children }: { children: React.ReactNode }) => <div data-testid="card-title">{children}</div>,
    CardDescription: ({ children }: { children: React.ReactNode }) => <div data-testid="card-description">{children}</div>,
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

vi.mock('@domain-ui/core/ui/components/ui/textarea', () => ({
    Textarea: (props: any) => <textarea data-testid="textarea" {...props} />,
}));

vi.mock('@domain-ui/core/ui/components/ui/switch', () => ({
    Switch: (props: any) => <input type="checkbox" data-testid="switch" {...props} />,
}));

vi.mock('@domain-ui/core/ui/components/ui/badge', () => ({
    Badge: ({ children }: { children: React.ReactNode }) => <div data-testid="badge">{children}</div>,
}));

describe('PipelineFormHeader', () => {
    const mockForm = {
        control: {},
        watch: vi.fn((field: string): any => {
            if (field === 'triggerType') return 'manual';
            return '';
        }),
        getValues: vi.fn(),
        setValue: vi.fn(),
        reset: vi.fn(),
        handleSubmit: vi.fn(),
        formState: { errors: {} },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useForm as any).mockReturnValue(mockForm);
    });

    it('renders create mode correctly', () => {
        render(<PipelineFormHeader form={mockForm as any} isEdit={false} />);

        expect(screen.getByText('Create New Pipeline')).toBeInTheDocument();
        expect(screen.getByText('Define a workflow by connecting jobs in a sequence.')).toBeInTheDocument();
        expect(screen.getByText('1. Pipeline Details')).toBeInTheDocument();
    });

    it('renders edit mode correctly', () => {
        const pipeline = { name: 'Test Pipeline', id: 1 };
        render(<PipelineFormHeader form={mockForm as any} isEdit={true} pipeline={pipeline} />);

        expect(screen.getByText('Edit Pipeline: Test Pipeline')).toBeInTheDocument();
    });

    it('renders all form fields', () => {
        render(<PipelineFormHeader form={mockForm as any} isEdit={false} />);

        expect(screen.getByText('Pipeline Name')).toBeInTheDocument();
        expect(screen.getByText('Description')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Monthly Budget (USD)')).toBeInTheDocument();
        expect(screen.getByText('Labels (Comma Separated)')).toBeInTheDocument();
    });

    it('has proper accessibility attributes', () => {
        render(<PipelineFormHeader form={mockForm as any} isEdit={false} />);

        const pipelineNameInput = screen.getByTestId('input-pipeline-name');
        expect(pipelineNameInput).toBeInTheDocument();
        expect(pipelineNameInput).toHaveAttribute('data-testid', 'input-pipeline-name');
    });
});
