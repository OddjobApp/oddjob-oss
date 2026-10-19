import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('SandboxProfileService');

export interface SandboxSecurityProfile {
  profileName: string;
  readOnlyRootFilesystem: boolean;
  dropCapabilities: string[];
  memoryLimitMb: number;
  cpuLimitCores: number;
  networkPolicy: 'default_deny' | 'restricted_egress' | 'open';
  seccompProfile: string;
}

export class SandboxProfileService {
  /**
   * Generates a strict ephemeral sandbox profile for executing agent code tasks safely.
   */
  generateProfile(agentRole: string, riskLevel: 'low' | 'medium' | 'high' = 'medium'): SandboxSecurityProfile {
    logger.info(`Generating security sandbox profile for agent role '${agentRole}' [riskLevel: ${riskLevel}]`);

    const isHighRisk = riskLevel === 'high';

    return {
      profileName: `sandbox_${agentRole}_${riskLevel}`,
      readOnlyRootFilesystem: true,
      dropCapabilities: ['ALL', 'CAP_NET_RAW', 'CAP_SYS_ADMIN'],
      memoryLimitMb: isHighRisk ? 1024 : 2048,
      cpuLimitCores: isHighRisk ? 1 : 2,
      networkPolicy: isHighRisk ? 'default_deny' : 'restricted_egress',
      seccompProfile: 'runtime/default'
    };
  }

  /**
   * Generates Docker container run parameters corresponding to the sandbox profile.
   */
  toDockerRunArgs(profile: SandboxSecurityProfile): string[] {
    const args: string[] = [
      '--read-only',
      '--cap-drop=ALL',
      `--memory=${profile.memoryLimitMb}m`,
      `--cpus=${profile.cpuLimitCores}`,
      '--security-opt=no-new-privileges:true'
    ];

    if (profile.networkPolicy === 'default_deny') {
      args.push('--network=none');
    }

    return args;
  }
}

export const sandboxProfileService = new SandboxProfileService();
