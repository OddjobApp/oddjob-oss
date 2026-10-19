import { describe, it, expect } from 'vitest';
import { sandboxProfileService } from '@domain/infrastructure/sandbox-profile.service.js';
import fs from 'fs';
import path from 'path';

describe('Phase 6 Kubernetes & Sandboxing Execution Suite', () => {
  describe('Sandbox Profile Service', () => {
    it('generates a strict security sandbox profile for agent execution', () => {
      const profile = sandboxProfileService.generateProfile('developer', 'high');
      expect(profile.readOnlyRootFilesystem).toBe(true);
      expect(profile.dropCapabilities).toContain('ALL');
      expect(profile.networkPolicy).toBe('default_deny');
      expect(profile.memoryLimitMb).toBe(1024);
    });

    it('converts sandbox profile to Docker CLI flags', () => {
      const profile = sandboxProfileService.generateProfile('devops', 'high');
      const dockerArgs = sandboxProfileService.toDockerRunArgs(profile);

      expect(dockerArgs).toContain('--read-only');
      expect(dockerArgs).toContain('--cap-drop=ALL');
      expect(dockerArgs).toContain('--network=none');
    });
  });

  describe('Helm Chart & K8s Manifest Integrity', () => {
    it('verifies presence of Helm Chart.yaml and values.yaml', () => {
      const chartPath = path.join(process.cwd(), 'k8s', 'charts', 'oddjob', 'Chart.yaml');
      const valuesPath = path.join(process.cwd(), 'k8s', 'charts', 'oddjob', 'values.yaml');
      const deploymentPath = path.join(process.cwd(), 'k8s', 'charts', 'oddjob', 'templates', 'deployment.yaml');
      const hpaPath = path.join(process.cwd(), 'k8s', 'charts', 'oddjob', 'templates', 'hpa.yaml');

      expect(fs.existsSync(chartPath)).toBe(true);
      expect(fs.existsSync(valuesPath)).toBe(true);
      expect(fs.existsSync(deploymentPath)).toBe(true);
      expect(fs.existsSync(hpaPath)).toBe(true);

      const chartContent = fs.readFileSync(chartPath, 'utf-8');
      expect(chartContent).toContain('name: oddjob');
      expect(chartContent).toContain('apiVersion: v2');
    });
  });
});
