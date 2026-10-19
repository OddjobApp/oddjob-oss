import { describe, it, expect } from 'vitest';
import { PrivacyRouterService } from './privacy-router.service.js';
import { ForbiddenError } from '@server/utils/errors.js';

const router = new PrivacyRouterService();

const cloudModel = { model: 'claude-3-5-sonnet', provider: 'anthropic' };
const localModel  = { model: 'llama3.1:latest',   provider: 'ollama' };
const localOpenai = { model: 'mistral-7b',         provider: 'local_openai' };

describe('PrivacyRouterService', () => {

    describe('public classification', () => {
        it('allows cloud models', () => {
            const result = router.enforce('public', cloudModel);
            expect(result.allowed).toBe(true);
        });

        it('allows local models', () => {
            const result = router.enforce('public', localModel);
            expect(result.allowed).toBe(true);
        });
    });

    describe('internal classification', () => {
        it('allows cloud models with a notice (no throw)', () => {
            const result = router.enforce('internal', cloudModel);
            expect(result.allowed).toBe(true);
        });

        it('allows local models', () => {
            const result = router.enforce('internal', localModel);
            expect(result.allowed).toBe(true);
        });
    });

    describe('sensitive classification', () => {
        it('allows cloud models with a compliance warning (no throw)', () => {
            const result = router.enforce('sensitive', cloudModel);
            expect(result.allowed).toBe(true);
            expect(result.reason).toContain('compliance warning');
        });

        it('allows local models', () => {
            const result = router.enforce('sensitive', localModel);
            expect(result.allowed).toBe(true);
        });
    });

    describe('restricted classification', () => {
        it('allows local/ollama models', () => {
            const result = router.enforce('restricted', localModel);
            expect(result.allowed).toBe(true);
        });

        it('allows local_openai provider models', () => {
            const result = router.enforce('restricted', localOpenai);
            expect(result.allowed).toBe(true);
        });

        it('allows models with local: prefix regardless of provider', () => {
            const result = router.enforce('restricted', { model: 'local:deepseek-coder', provider: 'custom' });
            expect(result.allowed).toBe(true);
        });

        it('throws ForbiddenError for cloud models', () => {
            expect(() => router.enforce('restricted', cloudModel)).toThrow(ForbiddenError);
        });

        it('throws ForbiddenError for gpt-4o on openai', () => {
            expect(() => router.enforce('restricted', { model: 'gpt-4o', provider: 'openai' })).toThrow(ForbiddenError);
        });

        it('throws ForbiddenError for gemini-2.0-flash on google', () => {
            expect(() => router.enforce('restricted', { model: 'gemini-2.0-flash', provider: 'google' })).toThrow(ForbiddenError);
        });
    });

    describe('isLocal helper', () => {
        it('detects ollama provider as local', () => {
            expect(router.isLocal({ model: 'anything', provider: 'ollama' })).toBe(true);
        });

        it('detects llama prefix as local', () => {
            expect(router.isLocal({ model: 'llama3.2:latest', provider: 'openai' })).toBe(true);
        });

        it('detects anthropic as non-local', () => {
            expect(router.isLocal({ model: 'claude-3-5-haiku', provider: 'anthropic' })).toBe(false);
        });
    });

    describe('getLocalFallback', () => {
        it('returns a non-empty string', () => {
            expect(router.getLocalFallback()).toBeTruthy();
        });
    });
});
