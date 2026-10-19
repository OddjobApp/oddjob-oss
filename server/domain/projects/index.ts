/**
 * Project Spaces — the durable scope between orgs (tenant) and operational cycles
 * (iteration). See docs/PROJECT_SPACES_DESIGN.md.
 */
export { ProjectService, projectService, requireOrg, type ProjectCtx, type ProjectWithSpend } from "./core/project.service.js";
export { backfillOrg, backfillAllOrgs, type BackfillReport } from "./core/project-backfill.service.js";
export { default as projectsRouter } from "./routes/projects.route.js";
