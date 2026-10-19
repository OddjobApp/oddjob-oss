import { vi } from 'vitest';

// ============================================================================
// MOCK DATA FACTORIES
// ============================================================================

export const createMockJob = (overrides = {}) => ({
    id: 1,
    name: 'Test Job',
    type: 'shell',
    config: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
});

export const createMockPipeline = (overrides = {}) => ({
    id: 1,
    name: 'Test Pipeline',
    description: 'A test pipeline',
    triggerType: 'manual',
    isActive: true,
    createdBy: 'test-user',
    createdAt: new Date().toISOString(),
    steps: [],
    ...overrides
});

export const createMockPipelineStep = (overrides = {}) => ({
    id: 1,
    pipelineId: 1,
    jobId: 1,
    order: 0,
    outputName: null,
    runOnCondition: 'on_success',
    waitDurationSeconds: 0,
    onFailureAction: 'Stop Pipeline',
    parallelGroup: null,
    conditionExpression: null,
    ...overrides
});

export const createMockUser = (overrides = {}) => ({
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    role: 'user',
    isActive: true,
    createdAt: new Date().toISOString(),
    ...overrides
});

// ============================================================================
// REACT HOOK FORM MOCKS
// ============================================================================

export const createMockForm = (initialValues = {}) => ({
    control: {},
    handleSubmit: vi.fn((onValid, onInvalid) => async (e?: any) => {
        if (e) e.preventDefault();
        if (onValid) await onValid(initialValues);
    }),
    watch: vi.fn((field) => initialValues[field]),
    getValues: vi.fn(() => initialValues),
    setValue: vi.fn(),
    reset: vi.fn(),
    trigger: vi.fn(),
    formState: {
        errors: {},
        isSubmitting: false,
        isValid: true,
        isDirty: false,
        dirtyFields: {},
        touchedFields: {},
        defaultValues: initialValues,
    },
    ...initialValues
});

export const createMockFieldArray = (fields = []) => ({
    fields,
    append: vi.fn(),
    prepend: vi.fn(),
    insert: vi.fn(),
    remove: vi.fn(),
    swap: vi.fn(),
    move: vi.fn(),
    update: vi.fn(),
    replace: vi.fn(),
});

// ============================================================================
// API RESPONSE MOCKS
// ============================================================================

export const createMockApiResponse = (data: any, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Map([['content-type', 'application/json']]),
});

export const createMockApiError = (message: string, status = 400) => ({
    ok: false,
    status,
    statusText: 'Bad Request',
    json: vi.fn().mockResolvedValue({ error: { message } }),
    text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message } })),
});

// ============================================================================
// SERVICE MOCKS
// ============================================================================

export const createMockEmbedderService = () => ({
    generate_embedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    generate_batch_embeddings: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]),
    get_model_name: vi.fn().mockReturnValue('test-model'),
    get_model_info: vi.fn().mockReturnValue({
        loaded: true,
        model_name: 'test-model',
        embedding_dimension: 3
    }),
});

export const createMockScraperService = () => ({
    scrape_url: vi.fn().mockResolvedValue({
        title: 'Test Page',
        text_content: 'This is test content',
        links: ['https://example.com/page1', 'https://example.com/page2'],
        metadata: {
            status_code: 200,
            content_type: 'text/html',
            content_length: 1000,
        },
        processing_time: 1.5
    }),
});

export const createMockPdfService = () => ({
    parse_pdf: vi.fn().mockResolvedValue({
        filename: 'test.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        text_content: 'Extracted PDF text content',
        metadata: {
            pages: 5,
            title: 'Test Document',
        },
        processing_time: 2.1
    }),
});

// ============================================================================
// TEST UTILITIES
// ============================================================================

export const waitForNextTick = () => new Promise(resolve => setTimeout(resolve, 0));

export const createMockEvent = (overrides = {}) => ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: { value: '', checked: false },
    currentTarget: { value: '', checked: false },
    ...overrides
});

export const createMockFile = (name = 'test.txt', size = 1024, type = 'text/plain') => {
    const file = new File(['test content'], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
};

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

export const expectApiCall = (mockFn: any, expectedArgs?: any[]) => {
    expect(mockFn).toHaveBeenCalled();
    if (expectedArgs) {
        expect(mockFn).toHaveBeenCalledWith(...expectedArgs);
    }
};

export const expectFormValidationError = (form: any, field: string, message?: string) => {
    expect(form.formState.errors[field]).toBeDefined();
    if (message) {
        expect(form.formState.errors[field].message).toContain(message);
    }
};

export const expectToastMessage = (toast: any, title?: string, description?: string) => {
    if (title) expect(toast.title).toHaveBeenCalledWith(title);
    if (description) expect(toast.description).toHaveBeenCalledWith(description);
};

// ============================================================================
// CLEANUP UTILITIES
// ============================================================================

export const cleanupMocks = (...mocks: any[]) => {
    mocks.forEach(mock => {
        if (typeof mock === 'function') {
            mock.mockClear();
        } else if (mock && typeof mock === 'object') {
            Object.values(mock).forEach(value => {
                if (typeof value === 'function' && value.mockClear) {
                    value.mockClear();
                }
            });
        }
    });
};

// ============================================================================
// PERFORMANCE TESTING HELPERS
// ============================================================================

export const measurePerformance = async (fn: () => Promise<any>) => {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    return {
        result,
        duration: end - start
    };
};

export const expectPerformance = (duration: number, maxDuration: number) => {
    expect(duration).toBeLessThan(maxDuration);
};
