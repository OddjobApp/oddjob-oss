import { describe, it, expect } from 'vitest';
import { requestPrefersMultiTokenPrediction, requestRequiresMultiTokenPrediction } from '../../server/domain/ai/core/multi-token-prediction.js';

describe('MTP routing', () => {
    it('prefers MTP for long speed-oriented generations', () => {
        expect(requestPrefersMultiTokenPrediction({ routingStrategy: 'speed', maxTokens: 1024 })).toBe(true);
    });
    it('does not prefer MTP for short generations', () => {
        expect(requestPrefersMultiTokenPrediction({ routingStrategy: 'speed', maxTokens: 512 })).toBe(false);
    });
    it('respects explicit preferred: false', () => {
        expect(requestPrefersMultiTokenPrediction({ routingStrategy: 'speed', maxTokens: 2048, multiTokenPrediction: { preferred: false } })).toBe(false);
    });
    it('requires MTP when required: true', () => {
        expect(requestRequiresMultiTokenPrediction({ multiTokenPrediction: { required: true } })).toBe(true);
    });
});
