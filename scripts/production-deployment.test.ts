// Exercise release scripts with fake CLIs: never contact Docker or Kubernetes.
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repository = process.cwd();
const bash = process.platform === "win32"
  ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe")
  : "bash";
const directories: string[] = [];
const shellPath = (value: string) => process.platform === "win32"
  ? value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
  : value;

function run(script: string, mocks: Record<string, string>, environment: Record<string, string> = {}, arguments_: string[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), "oddjob-deploy-test-"));
  directories.push(directory);
  for (const [name, content] of Object.entries(mocks)) {
    writeFileSync(path.join(directory, name), `#!/usr/bin/env bash\nset -eu\n${content}\n`, { mode: 0o755 });
  }
  writeFileSync(path.join(directory, "docker-compose.prod.yml"), "services: {}\n");
  const log = path.join(directory, "commands.log");
  const manifest = path.join(directory, "job.json");
  const result = spawnSync(bash, ["-c", 'export PATH="$1:$PATH"; bash "$2" "${@:3}"', "--",
    shellPath(directory), shellPath(path.join(repository, script)), ...arguments_], {
    cwd: directory,
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      DEPLOYMENT_WEBHOOK_URL: "",
      GITHUB_REPOSITORY: "example/oddjob",
      IMAGE_TAG: "release",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      COMMAND_LOG: shellPath(log),
      CAPTURE_JOB_PATH: shellPath(manifest),
      ...environment,
    },
  });
  return { result, commands: existsSync(log) ? readFileSync(log, "utf8") : "", manifest };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const kubectl = `
echo "$*" >> "$COMMAND_LOG"
case "$1" in
  create) echo '{"spec":{"template":{"spec":{"containers":[{"name":"migration","image":"release","command":["node","dist/migrate.js"]}]}}}}' ;;
  apply) while [ "$1" != "-f" ]; do shift; done; cp "$2" "$CAPTURE_JOB_PATH" ;;
  wait) exit "\${MOCK_WAIT_EXIT:-0}" ;;
esac`;

const docker = `
echo "tag=\${IMAGE_TAG:-} $*" >> "$COMMAND_LOG"
case "$*" in
  *"ps -q oddjob"*) echo old-container ;;
  inspect*) echo sha256:old-image ;;
  *"run --rm migrate"*) exit "\${MOCK_MIGRATION_EXIT:-0}" ;;
  *"up -d --no-deps oddjob worker"*)
    if [ "\${MOCK_RECREATE_FAILURE:-0}" = 1 ] && [[ "\${IMAGE_TAG:-}" != rollback-* ]]; then exit 1; fi ;;
  *"curl -fsS"*)
    if [ "\${MOCK_UNHEALTHY:-0}" = 1 ] && [[ "\${IMAGE_TAG:-}" != rollback-* ]]; then exit 1; fi ;;
esac`;

describe("production release scripts", () => {
  it("configures the migration database secret and awaits completion", () => {
    const { result, commands, manifest } = run("scripts/run-k8s-migrations.sh", { kubectl }, {}, ["production", "release"]);
    expect(result.status, result.stderr).toBe(0);
    const job = JSON.parse(readFileSync(manifest, "utf8"));
    expect(job.spec.template.spec.containers[0].env).toContainEqual({
      name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: "oddjob-secrets", key: "DATABASE_URL" } },
    });
    expect(job.spec.backoffLimit).toBe(0);
    expect(commands).toContain("--for=condition=complete");
    expect(commands.indexOf("apply ")).toBeLessThan(commands.indexOf("wait "));
  });

  it("fails the release when the migration job does not complete", () => {
    const { result, commands } = run("scripts/run-k8s-migrations.sh", { kubectl }, { MOCK_WAIT_EXIT: "1" }, ["staging", "release"]);
    expect(result.status).toBe(1);
    expect(commands).toContain("describe job");
  });

  it("migrates before replacing the application without stopping data services", () => {
    const { result, commands } = run("scripts/deploy-production.sh", { docker, sleep: "exit 0" });
    expect(result.status, result.stderr).toBe(0);
    expect(commands.indexOf("run --rm migrate")).toBeLessThan(commands.indexOf("up -d --no-deps oddjob worker"));
    expect(commands).toContain("http://localhost:5000/api/health");
    expect(commands).not.toMatch(/\bdown\b|FLUSHALL/);
  });

  it("does not replace the application after a failed migration", () => {
    const { result, commands } = run("scripts/deploy-production.sh", { docker }, { MOCK_MIGRATION_EXIT: "1" });
    expect(result.status).toBe(1);
    expect(commands).not.toContain("up -d --no-deps oddjob worker");
  });

  it("rolls back to the saved image when the new application is unhealthy", () => {
    const { result, commands } = run("scripts/deploy-production.sh", { docker, sleep: "exit 0" }, { MOCK_UNHEALTHY: "1" });
    expect(result.status).toBe(1);
    expect(commands).toContain("tag sha256:old-image ghcr.io/example/oddjob:rollback-");
    expect(commands).toMatch(/tag=rollback-\d+ compose .*up -d --no-deps oddjob worker/);
    expect(commands).not.toMatch(/\bdown\b|\bpsql\b|FLUSHALL/);
  });

  it("rolls back when application recreation fails", () => {
    const { result, commands } = run("scripts/deploy-production.sh", { docker }, { MOCK_RECREATE_FAILURE: "1" });
    expect(result.status).toBe(1);
    expect(commands).toMatch(/tag=rollback-\d+ compose .*up -d --no-deps oddjob worker/);
  });
});
