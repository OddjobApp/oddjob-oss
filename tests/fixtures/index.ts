export const fixtures = {
    jiraResponse: {
        issues: [
            {
                key: 'TEST-1',
                fields: {
                    summary: 'Test Issue 1',
                    description: 'This is a test issue',
                    status: { name: 'In Progress' },
                    assignee: { displayName: 'Test User' },
                    created: '2024-01-01T00:00:00.000Z',
                    updated: '2024-01-02T00:00:00.000Z'
                }
            },
            {
                key: 'TEST-2',
                fields: {
                    summary: 'Test Issue 2',
                    description: 'Another test issue',
                    status: { name: 'To Do' },
                    assignee: null,
                    created: '2024-01-03T00:00:00.000Z',
                    updated: '2024-01-03T00:00:00.000Z'
                }
            }
        ],
        total: 2,
        maxResults: 50
    },

    slackResponse: {
        ok: true,
        channel: 'C1234567890',
        ts: '1234567890.123456',
        message: {
            text: 'Test message',
            type: 'message',
            user: 'U1234567890'
        }
    },

    apiResponse: {
        status: 'success',
        data: {
            id: 1,
            name: 'Test Data',
            value: 42
        }
    },

    transformedData: {
        entities: [
            {
                type: 'Ticket',
                name: 'TEST-1',
                externalId: 'TEST-1',
                data: {
                    summary: 'Test Issue 1',
                    status: 'In Progress'
                }
            }
        ],
        relationships: [
            {
                source: 'TEST-1',
                target: 'USER-1',
                relation: 'ASSIGNED_TO'
            }
        ]
    },

    pipelineInput: {
        query: 'project = TEST',
        limit: 10,
        fields: ['summary', 'status', 'assignee']
    },

    pipelineOutput: {
        processed: 2,
        created: 1,
        updated: 1,
        errors: 0
    }
};

export default fixtures;
