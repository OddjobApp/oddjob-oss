/**
 * Variable Resolver tests — pipeline variable substitution
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveVariables, resolveJobConfig, VariableResolverError } from '../../../server/core/variable-resolver.js';

describe('Variable Resolver', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describe('resolveVariables', () => {
        it('returns empty string for empty template', () => {
            expect(resolveVariables('', { named: {}, positional: {} })).toBe('');
        });

        it('resolves {{pipeline.name}} from named context', () => {
            const result = resolveVariables('Hello {{pipeline.greeting}}', {
                named: { greeting: 'World' },
                positional: {},
            });
            expect(result).toBe('Hello World');
        });

        it('throws when named output not found', () => {
            expect(() =>
                resolveVariables('{{pipeline.missing}}', { named: {}, positional: {} })
            ).toThrow(VariableResolverError);
            expect(() =>
                resolveVariables('{{pipeline.missing}}', { named: {}, positional: {} })
            ).toThrow(/not found/);
        });

        it('resolves {{step.N.output}} from positional context', () => {
            const result = resolveVariables('Step 0: {{step.0.output}}', {
                named: {},
                positional: { 0: 'first output' },
            });
            expect(result).toBe('Step 0: first output');
        });

        it('resolves {{step.N.output.path}} with JSON path', () => {
            const output = JSON.stringify({ data: { id: 42, name: 'test' } });
            const result = resolveVariables('ID: {{step.0.output.data.id}}', {
                named: {},
                positional: { 0: output },
            });
            expect(result).toBe('ID: 42');
        });

        it('throws when step output not found', () => {
            expect(() =>
                resolveVariables('{{step.99.output}}', { named: {}, positional: {} })
            ).toThrow(VariableResolverError);
        });

        it('resolves {{item.key}} from item context', () => {
            const result = resolveVariables('Item: {{item.name}}', {
                named: {},
                positional: {},
                item: { name: 'Product', price: 10 },
            });
            expect(result).toBe('Item: Product');
        });

        it('resolves {{data.key}} when data context present', () => {
            const result = resolveVariables('Data: {{data.foo}}', {
                named: {},
                positional: {},
                data: { foo: 'bar' },
            });
            expect(result).toBe('Data: bar');
        });

        it('leaves unknown patterns unchanged when no match', () => {
            const result = resolveVariables('Plain text {{unknown}}', {
                named: {},
                positional: {},
            });
            expect(result).toBe('Plain text {{unknown}}');
        });

        it('handles multiple replacements', () => {
            const result = resolveVariables(
                'A: {{pipeline.a}} B: {{pipeline.b}}',
                { named: { a: '1', b: '2' }, positional: {} }
            );
            expect(result).toBe('A: 1 B: 2');
        });

        it('resolves {{step.name.output}} from named step', () => {
            const result = resolveVariables('Output: {{step.fetch_data.output}}', {
                named: { fetch_data: '{"result":"ok"}' },
                positional: {},
            });
            expect(result).toBe('Output: {"result":"ok"}');
        });

        it('resolves {{step.name.output.path}} with JSON path', () => {
            const result = resolveVariables('Value: {{step.my_step.output.data.value}}', {
                named: { my_step: '{"data":{"value":42}}' },
                positional: {},
            });
            expect(result).toBe('Value: 42');
        });

        it('resolves {{env.VAR}} when env context present', () => {
            const result = resolveVariables('Env: {{env.MY_VAR}}', {
                named: {},
                positional: {},
                env: { MY_VAR: 'secret' },
            });
            expect(result).toBe('Env: secret');
        });

        it('resolves nested {{item.nested.key}}', () => {
            const result = resolveVariables('Nested: {{item.user.email}}', {
                named: {},
                positional: {},
                item: { user: { email: 'a@b.com', name: 'Alice' } },
            });
            expect(result).toBe('Nested: a@b.com');
        });

        it('resolves {{data.nested.path}}', () => {
            const result = resolveVariables('Config: {{data.config.timeout}}', {
                named: {},
                positional: {},
                data: { config: { timeout: 30 } },
            });
            expect(result).toBe('Config: 30');
        });
    });

    describe('resolveJobConfig', () => {
        const baseContext = { named: {}, positional: {} };

        it('resolves ai_api_call systemPrompt and userPrompt', () => {
            const config = {
                systemPrompt: 'System: {{pipeline.sys}}',
                userPrompt: 'User: {{pipeline.usr}}',
            };
            const result = resolveJobConfig('ai_api_call', config, {
                ...baseContext,
                named: { sys: 'S1', usr: 'U1' },
            });
            expect(result.systemPrompt).toBe('System: S1');
            expect(result.userPrompt).toBe('User: U1');
        });

        it('resolves shell executable and parameters', () => {
            const config = { executable: '{{pipeline.cmd}}', parameters: 'arg={{pipeline.arg}}' };
            const result = resolveJobConfig('shell', config, {
                ...baseContext,
                named: { cmd: '/bin/echo', arg: 'hello' },
            });
            expect(result.executable).toBe('/bin/echo');
            expect(result.parameters).toBe('arg=hello');
        });

        it('resolves curl/api url, body, queryParams, headers', () => {
            const config = {
                url: 'https://{{pipeline.host}}/api',
                body: '{"id":"{{pipeline.id}}"}',
                queryParams: { q: '{{pipeline.q}}' },
                headers: { 'X-Token': '{{pipeline.token}}' },
            };
            const result = resolveJobConfig('curl', config, {
                ...baseContext,
                named: { host: 'example.com', id: '123', q: 'search', token: 'secret' },
            });
            expect(result.url).toBe('https://example.com/api');
            expect(result.body).toBe('{"id":"123"}');
            expect(result.queryParams).toEqual({ q: 'search' });
            expect(result.headers).toEqual({ 'X-Token': 'secret' });
        });

        it('resolves ai_agent goal and systemPrompt', () => {
            const config = { goal: '{{pipeline.goal}}', systemPrompt: '{{pipeline.prompt}}' };
            const result = resolveJobConfig('ai_agent', config, {
                ...baseContext,
                named: { goal: 'Analyze data', prompt: 'You are helpful' },
            });
            expect(result.goal).toBe('Analyze data');
            expect(result.systemPrompt).toBe('You are helpful');
        });

        it('resolves static_response content', () => {
            const config = { content: 'Result: {{pipeline.value}}' };
            const result = resolveJobConfig('static_response', config, {
                ...baseContext,
                named: { value: '42' },
            });
            expect(result.content).toBe('Result: 42');
        });

        it('resolves file_writer content and path', () => {
            const config = { content: '{{pipeline.body}}', path: '/out/{{pipeline.name}}.txt' };
            const result = resolveJobConfig('file_writer', config, {
                ...baseContext,
                named: { body: 'Hello', name: 'report' },
            });
            expect(result.content).toBe('Hello');
            expect(result.path).toBe('/out/report.txt');
        });

        it('resolves python scriptContent', () => {
            const config = { scriptContent: 'print("{{pipeline.msg}}")' };
            const result = resolveJobConfig('python', config, {
                ...baseContext,
                named: { msg: 'hello' },
            });
            expect(result.scriptContent).toBe('print("hello")');
        });

        it('resolves iterator inputArray', () => {
            const config = { inputArray: '{{step.0.output.items}}' };
            const result = resolveJobConfig('iterator', config, {
                ...baseContext,
                positional: { 0: JSON.stringify({ items: ['a', 'b'] }) },
            });
            expect(result.inputArray).toBe('["a","b"]');
        });

        it('resolves sql_query query and parameters', () => {
            const config = {
                query: 'SELECT * FROM t WHERE id = {{pipeline.id}}',
                parameters: { limit: '{{pipeline.limit}}' },
            };
            const result = resolveJobConfig('sql_query', config, {
                ...baseContext,
                named: { id: '42', limit: '10' },
            });
            expect(result.query).toBe('SELECT * FROM t WHERE id = 42');
            expect(result.parameters).toEqual({ limit: '10' });
        });

        it('returns config unchanged for unknown job type', () => {
            const config = { foo: 'bar' };
            const result = resolveJobConfig('unknown_type', config, baseContext);
            expect(result).toEqual(config);
        });
    });
});
