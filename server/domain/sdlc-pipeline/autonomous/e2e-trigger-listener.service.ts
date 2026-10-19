import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { changeValidationOrchestratorService } from "./change-validation-orchestrator.service.js";

const logger = createLogger("E2ETriggerListener");

class E2ETriggerListenerService {
  private unsubscribe: (() => void) | null = null;
  private readonly inFlight = new Set<string>();

  async initialize(): Promise<void> {
    if (this.unsubscribe) return;
    logger.info("[E2ETriggerListener] Initializing governed version.commit validation subscription");

    this.unsubscribe = eventStream.onEvent(
      async (event) => {
        const payload = event.payload ?? {};
        const versionId = String(payload.versionId ?? "");
        if (!versionId || this.inFlight.has(versionId)) return;

        const organizationId = Number(payload.organizationId);
        const appId = Number(payload.appId);
        const snapshotPath = String(payload.snapshotPath ?? "");
        const changedFiles = Array.isArray(payload.changedFiles)
          ? payload.changedFiles.map(String)
          : [];

        if (!Number.isInteger(organizationId) || organizationId <= 0 || !Number.isInteger(appId) || appId <= 0 || !snapshotPath) {
          logger.error(`[E2ETriggerListener] Version ${versionId} is missing organization, app, or snapshot context; validation cannot run safely`);
          await eventStream.publish("version.validation.blocked", {
            versionId,
            status: "blocked",
            reason: "version.commit payload is missing organizationId, appId, or snapshotPath",
          }, { organizationId: Number.isInteger(organizationId) ? organizationId : undefined, subject: versionId }, "pipeline");
          return;
        }

        this.inFlight.add(versionId);
        try {
          logger.info(`[E2ETriggerListener] Orchestrating validation for ${versionId}`);
          await changeValidationOrchestratorService.processChange({
            versionId,
            appId,
            appSlug: payload.appSlug ? String(payload.appSlug) : undefined,
            organizationId,
            changedFiles,
            snapshotPath,
            previousSnapshotPath: payload.previousSnapshotPath ? String(payload.previousSnapshotPath) : null,
            message: payload.message ? String(payload.message) : undefined,
          });
        } catch (error) {
          logger.error(`[E2ETriggerListener] Validation failed for ${versionId}`, error);
          await eventStream.publish("version.validation.blocked", {
            versionId,
            status: "blocked",
            reason: error instanceof Error ? error.message : String(error),
          }, { organizationId, subject: versionId }, "pipeline");
        } finally {
          this.inFlight.delete(versionId);
        }
      },
      { type: "version.commit" },
    );
  }

  close(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.inFlight.clear();
  }
}

export const e2eTriggerListenerService = new E2ETriggerListenerService();
