
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAuth, validateInput, validateUrl } from "@domain/core/auth/security.service.js";
import type { Request, Response, NextFunction } from 'express';

describe('Security Hardening Checks', () => {

    describe('requireAuth Middleware', () => {
        let mockReq: Partial<Request>;
        let mockRes: Partial<Response>;
        let next: NextFunction;

        beforeEach(() => {
            mockReq = {
                session: {} as any,
                originalUrl: "/api/test",
                path: "/api/test",
                method: "GET",
                headers: {},
            };
            mockRes = {
                status: vi.fn().mockReturnThis(),
                json: vi.fn()
            };
            next = vi.fn();
        });

        it('should block request if session is missing', () => {
            mockReq.session = undefined;
            requireAuth(mockReq as Request, mockRes as Response, next);
            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication required' }));
            expect(next).not.toHaveBeenCalled();
        });

        it('should block request if userId is missing in session', () => {
            (mockReq.session as any).userId = undefined;
            requireAuth(mockReq as Request, mockRes as Response, next);
            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        it('should call next() if userId is present', () => {
            (mockReq.session as any).userId = 'user_123';
            (mockReq as any).user = { id: 'user_123' };
            requireAuth(mockReq as Request, mockRes as Response, next);
            expect(next).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });
    });

    describe('validateInput Helper', () => {
        it('should validate required fields', () => {
            const result = validateInput(undefined, { required: true, type: 'string' });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Field is required');
        });

        it('should validate type correctness', () => {
            const result = validateInput(123, { type: 'string' });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('Expected type string');
        });

        it('should validate string length', () => {
            const result = validateInput('abc', { type: 'string', minLength: 5 });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Minimum length is 5');
        });

        it('should pass valid input', () => {
            const result = validateInput('valid_input', { type: 'string', minLength: 5 });
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate maxLength', () => {
            const result = validateInput('toolong', { type: 'string', maxLength: 5 });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Maximum length is 5');
        });

        it('should validate enum', () => {
            const result = validateInput('invalid', { type: 'string', enum: ['a', 'b', 'c'] });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('Must be one of');
        });

        it('should pass valid enum value', () => {
            const result = validateInput('b', { type: 'string', enum: ['a', 'b', 'c'] });
            expect(result.valid).toBe(true);
        });
    });

    describe('validateUrl Helper', () => {
        it('should accept https URLs', () => {
            expect(validateUrl('https://example.com')).toBe(true);
            expect(validateUrl('https://api.example.com/path')).toBe(true);
        });

        it('should accept http URLs', () => {
            expect(validateUrl('http://localhost:3000')).toBe(true);
        });

        it('should reject javascript URLs', () => {
            expect(validateUrl('javascript:alert(1)')).toBe(false);
        });

        it('should reject invalid URLs', () => {
            expect(validateUrl('not-a-url')).toBe(false);
            expect(validateUrl('')).toBe(false);
        });
    });
});
