import { localProcessService } from "./local-process.service.js";
import { dockerBridgeService } from "@domain/core/infrastructure/docker/docker-bridge.service.js";

function isLocalProcess(instance: { containerId: string; port: number }) {
  return (
    instance.containerId.startsWith("oddjob-app-") &&
    instance.containerId.endsWith(`-${instance.port}`)
  );
}

/** A port being occupied is not evidence that the intended app owns it. */
export async function runtimeInstanceIsRunning(instance: {
  containerId: string;
  port: number;
}) {
  if (!instance.containerId) return false;
  if (isLocalProcess(instance)) {
    return localProcessService.isProcessRunning(instance.containerId);
  }
  return dockerBridgeService.isContainerRunning(instance.containerId);
}

// The preview proxy verifies instances on every request, including each asset
// of a page load. A Docker check shells out to `docker inspect`, so its answer
// is reused briefly; local-process checks are an in-memory lookup and are not.
const DOCKER_CHECK_TTL_MS = 2500;
const dockerChecks = new Map<string, { at: number; running: Promise<boolean> }>();

function cachedRuntimeCheck(instance: { containerId: string; port: number }) {
  if (!instance.containerId || isLocalProcess(instance)) {
    return runtimeInstanceIsRunning(instance);
  }
  const now = Date.now();
  const hit = dockerChecks.get(instance.containerId);
  if (hit && now - hit.at < DOCKER_CHECK_TTL_MS) return hit.running;
  const running = dockerBridgeService.isContainerRunning(instance.containerId);
  dockerChecks.set(instance.containerId, { at: now, running });
  if (dockerChecks.size > 500) {
    for (const [id, check] of dockerChecks) {
      if (now - check.at >= DOCKER_CHECK_TTL_MS) dockerChecks.delete(id);
    }
  }
  return running;
}

/** Test seam: forget memoized Docker checks. */
export function resetRuntimeCheckCache() {
  dockerChecks.clear();
}

export async function verifiedRuntimeInstances<
  T extends { containerId: string; port: number },
>(instances: T[]): Promise<T[]> {
  const checks = await Promise.all(
    instances.map(async (instance) => ({
      instance,
      running: await cachedRuntimeCheck(instance),
    })),
  );
  return checks.filter((check) => check.running).map((check) => check.instance);
}
