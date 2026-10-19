import { Router } from "express";
import { datasetsRouter } from "./datasets.routes.js";
import { missionsRouter } from "./missions.routes.js";
import { knowledgeRouter } from "./knowledge.routes.js";
import { hilRouter } from "./hil.routes.js";
import { telemetryRouter } from "./telemetry.routes.js";
import { integrationsRouter } from "./integrations.routes.js";
import { pipelinesRouter } from "./pipelines.routes.js";
import { schedulesRouter } from "./schedules.routes.js";
import { jobsRouter } from "./jobs.routes.js";
import { agentsRouter } from "./agents.routes.js";
import { eventsRouter } from "./events.routes.js";
import { researchRouter } from "./research.routes.js";
import { synthesisRouter } from "./synthesis.routes.js";
import { outboundRouter } from "./outbound.routes.js";
import { onboardingRouter } from "./onboarding.routes.js";
import { fleetRouter } from "./fleet.routes.js";
import { complianceRouter } from "./compliance.routes.js";
import { formsRouter } from "./forms.routes.js";
import { handoffsRouter } from './handoffs.routes.js';
import { incidentsRouter } from './incidents.routes.js';
import { wayfareTripsRouter } from './wayfare.routes.js';

const router = Router();

// PlatformFormBlock's /api/oddjob/forms/* calls arrive here via the preview proxy.
router.use("/forms", formsRouter);
router.use('/handoffs', handoffsRouter);
router.use('/incidents', incidentsRouter);
router.use('/wayfare/trips', wayfareTripsRouter);

router.use("/datasets", datasetsRouter);
router.use("/research", researchRouter);
router.use("/missions", missionsRouter);
router.use("/knowledge", knowledgeRouter);
router.use("/hil", hilRouter);
router.use("/telemetry", telemetryRouter);
router.use("/integrations", integrationsRouter);
router.use("/pipelines", pipelinesRouter);
router.use("/schedules", schedulesRouter);
router.use("/jobs", jobsRouter);
router.use("/agents", agentsRouter);
router.use("/events", eventsRouter);
router.use("/synthesis", synthesisRouter);
router.use("/outbound", outboundRouter);
router.use("/onboarding", onboardingRouter);
router.use("/fleet", fleetRouter);
router.use("/compliance", complianceRouter);

export { router as appsPlatformRouter };
