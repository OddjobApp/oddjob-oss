/**
 * Jira Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraClient } from '../../server/domain/integrations/jira-service.js';

const mockGetProjects = vi.fn();
const mockSearchIssues = vi.fn();
const mockGetIssuesInProject = vi.fn();
const mockGetIssue = vi.fn();
const mockGetFields = vi.fn();
const mockCreateIssue = vi.fn();
const mockAddComment = vi.fn();

vi.mock('../../server/integrations/jira-gateway.js', () => ({
    JiraGateway: class MockJiraGateway {
        getBaseUrl = () => 'https://test.atlassian.net';
        getProjects = (...args: unknown[]) => mockGetProjects(...args);
        searchIssues = (...args: unknown[]) => mockSearchIssues(...args);
        getIssuesInProject = (...args: unknown[]) => mockGetIssuesInProject(...args);
        getIssue = (...args: unknown[]) => mockGetIssue(...args);
        getFields = (...args: unknown[]) => mockGetFields(...args);
        createIssue = (...args: unknown[]) => mockCreateIssue(...args);
        addComment = (...args: unknown[]) => mockAddComment(...args);
    },
}));

describe('JiraClient', () => {
    let client: JiraClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new JiraClient('https://test.atlassian.net', 'user', 'token');
    });

    describe('getBaseUrl', () => {
        it('returns base URL', () => {
            expect(client.getBaseUrl()).toBe('https://test.atlassian.net');
        });
    });

    describe('getProjects', () => {
        it('returns projects from gateway', async () => {
            const projects = [{ id: '1', key: 'PROJ', name: 'Project 1' }];
            mockGetProjects.mockResolvedValue(projects);

            const result = await client.getProjects(10, 0);
            expect(result).toEqual(projects);
            expect(mockGetProjects).toHaveBeenCalledWith(10, 0);
        });
    });

    describe('searchIssues', () => {
        it('returns search result from gateway', async () => {
            const searchResult = { issues: [], total: 0 };
            mockSearchIssues.mockResolvedValue(searchResult);

            const result = await client.searchIssues('project = PROJ');
            expect(result).toEqual(searchResult);
            expect(mockSearchIssues).toHaveBeenCalledWith('project = PROJ', 50, 0, []);
        });
    });

    describe('getIssue', () => {
        it('returns issue by key', async () => {
            const issue = { key: 'PROJ-1', fields: { summary: 'Test' } };
            mockGetIssue.mockResolvedValue(issue);

            const result = await client.getIssue('PROJ-1');
            expect(result).toEqual(issue);
            expect(mockGetIssue).toHaveBeenCalledWith('PROJ-1', []);
        });
    });

    describe('getFields', () => {
        it('returns fields from gateway', async () => {
            const fields = [{ id: 'summary', name: 'Summary' }];
            mockGetFields.mockResolvedValue(fields);

            const result = await client.getFields();
            expect(result).toEqual(fields);
            expect(mockGetFields).toHaveBeenCalled();
        });
    });

    describe('createIssue', () => {
        it('creates issue via gateway', async () => {
            const fields = { summary: 'New Issue' };
            const response = { key: 'PROJ-2' };
            mockCreateIssue.mockResolvedValue(response);

            const result = await client.createIssue(fields);
            expect(result).toEqual(response);
            expect(mockCreateIssue).toHaveBeenCalledWith(fields);
        });
    });

    describe('addComment', () => {
        it('adds comment via gateway', async () => {
            mockAddComment.mockResolvedValue({ id: '123' });

            const result = await client.addComment('PROJ-1', 'Hello world');
            expect(result).toEqual({ id: '123' });
            expect(mockAddComment).toHaveBeenCalledWith('PROJ-1', 'Hello world');
        });
    });

    describe('issueToMarkdown', () => {
        it('converts issue to markdown', () => {
            const issue = {
                key: 'PROJ-1',
                fields: {
                    summary: 'Test Issue',
                    status: { name: 'Open' },
                    issuetype: { name: 'Task' },
                    project: { key: 'PROJ', name: 'Project' },
                    created: '2024-01-01',
                    updated: '2024-01-02',
                },
            };

            const result = client.issueToMarkdown(issue as any);
            expect(result).toContain('# PROJ-1: Test Issue');
            expect(result).toContain('**Status:** Open');
            expect(result).toContain('**Type:** Task');
        });
    });
});
