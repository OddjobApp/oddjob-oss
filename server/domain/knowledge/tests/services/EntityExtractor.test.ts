/**
 * EntityExtractor tests (evaluateSimpleCondition, extractEntities)
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
    evaluateSimpleCondition,
    extractEntities,
    type ExtractedEntity,
} from '@domain/knowledge/core/extraction/EntityExtractor.js';
import type { EntityRule } from '@shared/schema/knowledge-config.js';

describe('evaluateSimpleCondition', () => {
    it('returns true for simple equality match', () => {
        expect(evaluateSimpleCondition("{{status}} == 'active'", { status: 'active' })).toBe(true);
        expect(evaluateSimpleCondition("{{status}} == 'active'", { status: 'inactive' })).toBe(false);
    });

    it('returns true for strict equality', () => {
        expect(evaluateSimpleCondition("{{count}} === 5", { count: 5 })).toBe(true);
        expect(evaluateSimpleCondition("{{count}} === 5", { count: '5' })).toBe(false);
    });

    it('handles inequality operators', () => {
        expect(evaluateSimpleCondition("{{count}} > 3", { count: 5 })).toBe(true);
        expect(evaluateSimpleCondition("{{count}} > 3", { count: 2 })).toBe(false);
        expect(evaluateSimpleCondition("{{count}} >= 3", { count: 3 })).toBe(true);
        expect(evaluateSimpleCondition("{{count}} < 10", { count: 5 })).toBe(true);
        expect(evaluateSimpleCondition("{{count}} <= 5", { count: 5 })).toBe(true);
    });

    it('handles AND logic', () => {
        expect(evaluateSimpleCondition("{{a}} == 'x' && {{b}} == 'y'", { a: 'x', b: 'y' })).toBe(true);
        expect(evaluateSimpleCondition("{{a}} == 'x' && {{b}} == 'y'", { a: 'x', b: 'z' })).toBe(false);
    });

    it('handles OR logic', () => {
        expect(evaluateSimpleCondition("{{status}} == 'active' || {{status}} == 'pending'", { status: 'active' })).toBe(true);
        expect(evaluateSimpleCondition("{{status}} == 'active' || {{status}} == 'pending'", { status: 'pending' })).toBe(true);
        expect(evaluateSimpleCondition("{{status}} == 'active' || {{status}} == 'pending'", { status: 'done' })).toBe(false);
    });

    it('handles nested paths', () => {
        expect(evaluateSimpleCondition("{{user.role}} == 'admin'", { user: { role: 'admin' } })).toBe(true);
        expect(evaluateSimpleCondition("{{user.role}} == 'admin'", { user: { role: 'user' } })).toBe(false);
    });

    it('returns false for invalid condition', () => {
        expect(evaluateSimpleCondition("{{broken", {})).toBe(false);
    });

    it('handles parentheses', () => {
        expect(evaluateSimpleCondition("({{a}} == 'x') && ({{b}} == 'y')", { a: 'x', b: 'y' })).toBe(true);
    });

    it('handles booleans', () => {
        expect(evaluateSimpleCondition("{{flag}} == true", { flag: true })).toBe(true);
        expect(evaluateSimpleCondition("{{flag}} == false", { flag: false })).toBe(true);
    });
});

describe('extractEntities', () => {
    const baseRule: EntityRule = {
        entityType: 'User',
        label: 'User',
        mappings: { name: 'name' },
    };

    it('extracts single entity from flat object', () => {
        const data = { name: 'Alice' };
        const rules: EntityRule[] = [{ ...baseRule }];
        const result = extractEntities(data, rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            entityType: 'User',
            label: 'User',
            name: 'Alice',
            data: {},
        });
    });

    it('extracts entities from array at root', () => {
        const data = [{ name: 'Alice' }, { name: 'Bob' }];
        const rules: EntityRule[] = [{ ...baseRule }];
        const result = extractEntities(data, rules);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('Alice');
        expect(result[1].name).toBe('Bob');
    });

    it('uses rootPath to iterate over nested array', () => {
        const data = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
        const rules: EntityRule[] = [{ ...baseRule, rootPath: 'users' }];
        const result = extractEntities(data, rules);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('Alice');
        expect(result[1].name).toBe('Bob');
    });

    it('skips items failing condition', () => {
        const data = [
            { name: 'Alice', status: 'active' },
            { name: 'Bob', status: 'inactive' },
        ];
        const rules: EntityRule[] = [
            { ...baseRule, condition: "{{status}} == 'active'" },
        ];
        const result = extractEntities(data, rules);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Alice');
    });

    it('extracts externalId and data mappings', () => {
        const data = { name: 'Alice', id: 'ext-123', email: 'a@b.com' };
        const rules: EntityRule[] = [
            {
                ...baseRule,
                mappings: {
                    name: 'name',
                    externalId: 'id',
                    data: { email: 'email' },
                },
            },
        ];
        const result = extractEntities(data, rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            name: 'Alice',
            externalId: 'ext-123',
            data: { email: 'a@b.com' },
        });
    });

    it('skips items with missing name', () => {
        const data = [{ name: 'Alice' }, { email: 'b@b.com' }];
        const rules: EntityRule[] = [{ ...baseRule }];
        const result = extractEntities(data, rules);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Alice');
    });

    it('returns empty array for empty data', () => {
        const result = extractEntities({}, [{ ...baseRule }]);
        expect(result).toHaveLength(0);
    });
});
