import { describe, it, expect } from 'vitest';
import { DeploymentProfileService, PROFILE_CATALOGUE } from './deployment-profile.service.js';

const svc = new DeploymentProfileService();

describe('DeploymentProfileService', () => {

    describe('get() — static profile resolution', () => {
        it('laptop profile has lowest concurrency', () => {
            const spec = svc.get('laptop');
            expect(spec.missionConcurrency).toBe(1);
        });

        it('cluster profile has highest concurrency', () => {
            const spec = svc.get('cluster');
            expect(spec.missionConcurrency).toBe(20);
        });

        it('workstation prefers local models', () => {
            expect(svc.get('workstation').preferLocalModels).toBe(true);
        });

        it('laptop does not prefer local models', () => {
            expect(svc.get('laptop').preferLocalModels).toBe(false);
        });

        it('server and cluster enable fine-tuning', () => {
            expect(svc.get('server').fineTuningEnabled).toBe(true);
            expect(svc.get('cluster').fineTuningEnabled).toBe(true);
        });

        it('laptop and workstation disable fine-tuning', () => {
            expect(svc.get('laptop').fineTuningEnabled).toBe(false);
            expect(svc.get('workstation').fineTuningEnabled).toBe(false);
        });

        it('token limits increase with profile tier', () => {
            const tokens = (['laptop', 'workstation', 'server', 'cluster'] as const)
                .map(p => svc.get(p).maxTokensPerRequest);
            for (let i = 1; i < tokens.length; i++) {
                expect(tokens[i]).toBeGreaterThan(tokens[i - 1]);
            }
        });
    });

    describe('get() — override merging', () => {
        it('applies partial overrides on top of base profile', () => {
            const spec = svc.get('laptop', { missionConcurrency: 5 });
            expect(spec.missionConcurrency).toBe(5);
            // Other fields untouched
            expect(spec.maxTokensPerRequest).toBe(PROFILE_CATALOGUE.laptop.maxTokensPerRequest);
        });

        it('override does not mutate the catalogue', () => {
            svc.get('laptop', { missionConcurrency: 99 });
            expect(PROFILE_CATALOGUE.laptop.missionConcurrency).toBe(1);
        });
    });

    describe('PROFILE_CATALOGUE completeness', () => {
        const profiles = ['laptop', 'workstation', 'server', 'cluster'] as const;

        it('all profiles have required fields', () => {
            for (const profile of profiles) {
                const spec = PROFILE_CATALOGUE[profile];
                expect(spec.missionConcurrency).toBeGreaterThan(0);
                expect(spec.maxTokensPerRequest).toBeGreaterThan(0);
                expect(spec.maxParallelTools).toBeGreaterThan(0);
                expect(spec.streamingChunkSize).toBeGreaterThan(0);
                expect(typeof spec.preferLocalModels).toBe('boolean');
                expect(typeof spec.fineTuningEnabled).toBe('boolean');
                expect(spec.label).toBeTruthy();
            }
        });
    });
});
