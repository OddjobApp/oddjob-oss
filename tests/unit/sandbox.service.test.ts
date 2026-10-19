/**
 * SandboxService tests
 *
 * Verifies the shell-free execution model (no host command injection) and the
 * fail-closed behavior when Docker is unavailable.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
    execFileCalls: [] as Array<{ file: string; args: string[] }>,
    execCalls: [] as string[],
    dockerAvailable: true,
}));

vi.mock('child_process', () => ({
    execFile: (file: string, args: string[], _opts: any, cb: Function) => {
        h.execFileCalls.push({ file, args });
        if (file === 'docker' && args[0] === 'ps') {
            if (h.dockerAvailable) cb(null, '', '');
            else cb(new Error('docker: command not found'));
            return;
        }
        cb(null, 'stdout-ok', '');
    },
    exec: (command: string, _opts: any, cb: Function) => {
        h.execCalls.push(command);
        cb(null, 'shell-ok', '');
    },
}));

vi.mock('@server/utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { sandboxService } from '@server/services/sandbox.service.js';

describe('SandboxService', () => {
    beforeEach(() => {
        h.execFileCalls.length = 0;
        h.execCalls.length = 0;
        h.dockerAvailable = true;
    });

    describe('Docker available', () => {
        it('runPython invokes docker via argv with network isolation (no shell)', async () => {
            const res = await sandboxService.runPython('print(1)');
            expect(res.stdout).toBe('stdout-ok');

            const dockerRun = h.execFileCalls.find(c => c.file === 'docker' && c.args[0] === 'run');
            expect(dockerRun).toBeDefined();
            expect(dockerRun!.args).toContain('--network');
            expect(dockerRun!.args).toContain('none');
            expect(dockerRun!.args).toContain('python:3.10-slim');
            // no exec() (shell) was ever used
            expect(h.execCalls).toHaveLength(0);
        });

        it('runShell passes the command as a single argv element to `sh -c` (injection-proof)', async () => {
            // Injection-shaped, but not on the dangerous-pattern list:
            // SandboxSafety.validateShell now refuses `rm -rf ~` outright, so
            // the original payload never reached Docker and this test failed on
            // the guard rather than proving anything about argv handling. The
            // guard itself is asserted separately below.
            const malicious = '`whoami`; echo "pwned" && $(id)';
            await sandboxService.runShell(malicious);

            const dockerRun = h.execFileCalls.find(c => c.file === 'docker' && c.args[0] === 'run');
            expect(dockerRun).toBeDefined();
            const shIdx = dockerRun!.args.indexOf('sh');
            expect(shIdx).toBeGreaterThan(-1);
            expect(dockerRun!.args[shIdx + 1]).toBe('-c');
            // The whole malicious string is ONE argument — never split or interpolated
            // into a host shell command line.
            expect(dockerRun!.args[shIdx + 2]).toBe(malicious);
            expect(h.execCalls).toHaveLength(0);
        });

        it('refuses a destructive command before Docker is ever invoked', async () => {
            await expect(sandboxService.runShell('$(rm -rf ~) `whoami`'))
                .rejects.toThrow(/SandboxSecurityError/);

            // The point is that nothing ran, not merely that it threw.
            expect(h.execFileCalls.filter(c => c.file === 'docker')).toHaveLength(0);
            expect(h.execCalls).toHaveLength(0);
        });

        it('applies memory and cpu limits from options', async () => {
            await sandboxService.runShell('echo hi', { memoryLimitMb: 256, cpuLimit: 1 });
            const dockerRun = h.execFileCalls.find(c => c.file === 'docker' && c.args[0] === 'run');
            expect(dockerRun!.args).toContain('--memory=256m');
            expect(dockerRun!.args).toContain('--cpus=1');
        });
    });

    describe('Docker unavailable (fail-closed by default)', () => {
        beforeEach(() => { h.dockerAvailable = false; });

        it('runPython refuses to run unsandboxed', async () => {
            await expect(sandboxService.runPython('print(1)')).rejects.toThrow(/SANDBOX_ALLOW_UNSANDBOXED/);
            // never fell back to a local python execution
            expect(h.execFileCalls.some(c => c.file === 'python3')).toBe(false);
        });

        it('runShell refuses to run unsandboxed', async () => {
            await expect(sandboxService.runShell('echo hi')).rejects.toThrow(/SANDBOX_ALLOW_UNSANDBOXED/);
            expect(h.execCalls).toHaveLength(0);
        });
    });

    describe('Docker unavailable with explicit opt-in', () => {
        afterEach(() => vi.unstubAllEnvs());

        it('runs on the host only when SANDBOX_ALLOW_UNSANDBOXED=true', async () => {
            h.dockerAvailable = false;
            vi.stubEnv('SANDBOX_ALLOW_UNSANDBOXED', 'true');
            vi.resetModules();
            const { sandboxService: svc } = await import('@server/services/sandbox.service.js');

            const res = await svc.runShell('echo hi');
            expect(res.stdout).toBe('shell-ok');
            expect(h.execCalls).toContain('echo hi');
        });
    });
});
