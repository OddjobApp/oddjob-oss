/**
 * input-validation-service.ts tests — safeParseJson and validation helpers
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@server/database_service.js', () => ({
    db: {
        query: {
            pipelineInputParams: { findMany: vi.fn().mockResolvedValue([]) },
            pipelineOutputParams: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                leftJoin: vi.fn(() => ({
                    where: vi.fn(() => ({ orderBy: vi.fn(() => Promise.resolve([])) })),
                })),
            })),
        })),
    },
}));

import { InputValidationService } from "@domain/core/input-validation.service.js";

describe('InputValidationService', () => {
    describe('safeParseJson', () => {
        it('returns value as-is when not a string', () => {
            expect(InputValidationService.safeParseJson(42)).toBe(42);
            expect(InputValidationService.safeParseJson(null)).toBe(null);
            expect(InputValidationService.safeParseJson({ a: 1 })).toEqual({ a: 1 });
        });

        it('parses valid JSON string', () => {
            expect(InputValidationService.safeParseJson('{"foo":"bar"}')).toEqual({ foo: 'bar' });
            expect(InputValidationService.safeParseJson('[1,2,3]')).toEqual([1, 2, 3]);
        });

        it('strips ```json code blocks before parsing', () => {
            const wrapped = '```json\n{"x":1}\n```';
            expect(InputValidationService.safeParseJson(wrapped)).toEqual({ x: 1 });
        });

        it('strips generic ``` code blocks before parsing', () => {
            const wrapped = '```\n{"y":2}\n```';
            expect(InputValidationService.safeParseJson(wrapped)).toEqual({ y: 2 });
        });

        it('returns original value when JSON is invalid', () => {
            const invalid = 'not valid json';
            expect(InputValidationService.safeParseJson(invalid)).toBe(invalid);
        });

        it('trims whitespace', () => {
            expect(InputValidationService.safeParseJson('  {"a":1}  ')).toEqual({ a: 1 });
        });
    });
});
