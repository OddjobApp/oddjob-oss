/**
 * Embed Profile Circuit Breaker tests
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
    isOpen,
    recordSuccess,
    recordFailure,
} from "@domain/auth/core/embed-profile-circuit-breaker.js";

describe('Embed Profile Circuit Breaker', () => {
    const deploymentId = 999;

    it('is not open initially', () => {
        expect(isOpen(deploymentId)).toBe(false);
    });

    it('opens after N failures', () => {
        const threshold = 3;
        recordFailure(deploymentId, { failureThreshold: threshold, cooldownSeconds: 60 });
        recordFailure(deploymentId, { failureThreshold: threshold, cooldownSeconds: 60 });
        expect(isOpen(deploymentId, { failureThreshold: threshold })).toBe(false);
        recordFailure(deploymentId, { failureThreshold: threshold, cooldownSeconds: 60 });
        expect(isOpen(deploymentId, { failureThreshold: threshold })).toBe(true);
    });

    it('success resets failure count', () => {
        recordFailure(deploymentId, { failureThreshold: 2, cooldownSeconds: 1 });
        recordFailure(deploymentId, { failureThreshold: 2, cooldownSeconds: 1 });
        expect(isOpen(deploymentId, { failureThreshold: 2 })).toBe(true);
        recordSuccess(deploymentId);
        expect(isOpen(deploymentId, { failureThreshold: 2 })).toBe(false);
    });

    it('closes after cooldown expires', async () => {
        recordFailure(deploymentId, { failureThreshold: 1, cooldownSeconds: 1 });
        recordFailure(deploymentId, { failureThreshold: 1, cooldownSeconds: 1 });
        expect(isOpen(deploymentId, { failureThreshold: 1, cooldownSeconds: 1 })).toBe(true);
        await new Promise((r) => setTimeout(r, 1100));
        expect(isOpen(deploymentId, { failureThreshold: 1, cooldownSeconds: 1 })).toBe(false);
    });
});
