import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { ontologyObjectTypes, ontologyObjects, ontologyActions, ontologyActionLog, ontologyLinkTypes } from "@shared/schema/ontology/ontology.js";
import { orgs } from "@shared/schema/auth.js";
import { alerts } from "@shared/schema/alerts.js";
import { apps, appDeployments } from "@shared/schema/apps.js";
import { missions } from "@shared/schema/missions/core.js";
import { missionRuns } from "@shared/schema/missions/runs.js";
import { projects, projectResources } from "@shared/schema/projects.js";
import { swarmTasks } from "@shared/schema/swarm.js";
import { approvalRequests } from "@shared/schema/hil.js";
import { jobs } from "@shared/schema/jobs/table.js";
import { pipelines } from "@shared/schema/pipelines/pipeline-core.js";
import { pipelineSteps } from "@shared/schema/pipelines/pipeline-steps.js";
import { pipelineExecutions, pipelineStepExecutions } from "@shared/schema/pipelines/pipeline-execution.js";
import { schedules, scheduledJobs } from "@shared/schema/schedules.js";
import { like } from "drizzle-orm";
import { ontologyService, OntologyService } from "../../core/ontology.service.js";
import { NotFoundError } from "@server/utils/errors.js";
import { ensureFixtureOrgs } from "../../../../../tests/helpers/fixture-orgs.js";

/**
 * Live, DB-backed integration test for the org-scoped Ontology (requires the migrated
 * ontology_* tables). Uses orgs 1 and 2, which beforeAll provisions: the suite used to
 * assume both were already present, org 2 was not, and the FK violation in beforeAll
 * reported all nine tests as SKIPPED rather than failed — so this file proved nothing
 * for as long as that was true.
 *
 * Isolation is proven deterministically on the MATERIALIZED path (rows we own here).
 * The VIRTUAL adapters read ambient domain tables (missions, jobs, ...) whose schema is
 * drifted in the test DB (e.g. missions lacks `description`), so their row-reads are
 * verified against the migrated dev DB, not here — this test only asserts the virtual
 * types are registered/wired. See tool/service unit tests for the pure gate logic.
 */

const ORG_A = { organizationId: 1, userId: "test:ontology" };
const ORG_B = { organizationId: 2, userId: "test:ontology" };
const MAT_TYPE = "IntegrationWidget"; // materialized type created just for this test
// Extra materialized types backing the polymorphic traversal case. Kept materialized
// on purpose: the virtual adapters read ambient domain tables whose contents this
// suite does not control, and the discriminator assertion has to be exact.
const HOLDER_TYPE = "IntegrationHolder";
const GADGET_TYPE = "IntegrationGadget";
const ALL_MAT_TYPES = [MAT_TYPE, HOLDER_TYPE, GADGET_TYPE];
const ECHO_ACTION = "test_echo_action";
const ECHO_REF = "ontology.test.echo";
const FIXTURE_TAG = "ontology-integration-fixture"; // prefixes alert messages we create
const FIXTURE_SLUG_PREFIX = "ontology-integration-app"; // prefixes app slugs we create

// A builtin handler registered just for this test.
OntologyService.registerBuiltin(ECHO_REF, async (_ctx, params) => ({ echoed: params }));

async function cleanup() {
    for (const org of [ORG_A, ORG_B]) {
        for (const typeName of ALL_MAT_TYPES) {
            const types = await db
                .select({ id: ontologyObjectTypes.id })
                .from(ontologyObjectTypes)
                .where(and(eq(ontologyObjectTypes.organizationId, org.organizationId), eq(ontologyObjectTypes.name, typeName)));
            for (const t of types) {
                await db.delete(ontologyObjects).where(eq(ontologyObjects.objectTypeId, t.id));
                // Link types FK to the object type, so they must go first or the
                // delete below fails on a restrict.
                await db
                    .delete(ontologyLinkTypes)
                    .where(eq(ontologyLinkTypes.sourceTypeId, t.id));
                await db.delete(ontologyObjectTypes).where(eq(ontologyObjectTypes.id, t.id));
            }
        }
        await db.delete(alerts).where(like(alerts.message, `${FIXTURE_TAG}%`));
        const fixtureApps = await db.select({ id: apps.id }).from(apps).where(like(apps.slug, `${FIXTURE_SLUG_PREFIX}%`));
        for (const a of fixtureApps) await db.delete(appDeployments).where(eq(appDeployments.appId, a.id));
        await db.delete(apps).where(like(apps.slug, `${FIXTURE_SLUG_PREFIX}%`));
        // Scheduled jobs before schedules and before missions: the mission FK has no
        // cascade, so leaving them would block the mission delete below.
        await db.delete(scheduledJobs).where(like(scheduledJobs.name, `${FIXTURE_TAG}%`));
        await db.delete(schedules).where(like(schedules.name, `${FIXTURE_TAG}%`));
        // Project rows cascade their resource memberships; both must go before the
        // missions those memberships point at.
        await db.delete(projects).where(like(projects.key, `${FIXTURE_SLUG_PREFIX}%`));
        // Explicit, though missions would cascade them: mission_runs.current_pipeline_id
        // is ON DELETE NO ACTION, so any run left alive here blocks the pipeline delete
        // further down with an error that names the wrong table.
        await db.delete(missionRuns).where(like(missionRuns.name, `${FIXTURE_TAG}%`));
        await db.delete(missions).where(like(missions.name, `${FIXTURE_TAG}%`)); // swarm_tasks cascades
        // Steps, executions and step executions all cascade from the pipeline.
        await db.delete(pipelines).where(like(pipelines.name, `${FIXTURE_TAG}%`));
        // Approvals reference jobs with ON DELETE set null / no action, so they go first.
        await db.delete(approvalRequests).where(like(approvalRequests.executionId, `${FIXTURE_TAG}%`));
        await db.delete(jobs).where(like(jobs.name, `${FIXTURE_TAG}%`));

        // Link declarations this suite creates. Left behind they would survive into
        // the next run and make the idempotency assertion pass for the wrong reason.
        await db
            .delete(ontologyLinkTypes)
            .where(and(
                eq(ontologyLinkTypes.organizationId, org.organizationId),
                like(ontologyLinkTypes.name, "integration_%"),
            ));

        const actions = await db
            .select({ id: ontologyActions.id })
            .from(ontologyActions)
            .where(and(eq(ontologyActions.organizationId, org.organizationId), eq(ontologyActions.name, ECHO_ACTION)));
        for (const a of actions) {
            await db.delete(ontologyActionLog).where(eq(ontologyActionLog.actionId, a.id));
            await db.delete(ontologyActions).where(eq(ontologyActions.id, a.id));
        }
    }
}

describe("OntologyService (live, org-scoped)", () => {
    beforeAll(async () => {
        // Provision the two orgs rather than assuming them: every ontology row FKs to
        // orgs, so a missing org takes the whole suite down before a single assertion.
        await ensureFixtureOrgs([[ORG_A.organizationId, "Ontology Integration Org A"], [ORG_B.organizationId, "Ontology Integration Org B"]]);

        await ontologyService.seedDefaultObjectTypes(ORG_A);
        await ontologyService.seedDefaultObjectTypes(ORG_B);
        await cleanup();

        // Create a materialized type + one object owned by ORG_A only.
        for (const org of [ORG_A, ORG_B]) {
            await db.insert(ontologyObjectTypes).values({
                organizationId: org.organizationId,
                name: MAT_TYPE,
                description: "Integration-test materialized type",
                backing: "materialized",
                titleProperty: "label",
            });
        }
        const [typeA] = await db
            .select({ id: ontologyObjectTypes.id })
            .from(ontologyObjectTypes)
            .where(and(eq(ontologyObjectTypes.organizationId, ORG_A.organizationId), eq(ontologyObjectTypes.name, MAT_TYPE)));
        await db.insert(ontologyObjects).values({
            organizationId: ORG_A.organizationId,
            objectTypeId: typeA.id,
            externalId: "w1",
            properties: { label: "Widget One", status: "active" },
        });

        // A write action owned by ORG_A only, requiresApproval=false so it runs
        // deterministically without the Redis-backed approval gate.
        await db.insert(ontologyActions).values({
            organizationId: ORG_A.organizationId,
            name: ECHO_ACTION,
            description: "Echoes its params (integration test).",
            parametersSchema: { msg: "string" },
            effect: "write",
            handlerKind: "builtin",
            handlerRef: ECHO_REF,
            requiresApproval: false,
        });
    });

    afterAll(cleanup);

    describe("Link Types", () => {
        const LINK = "integration_deploys";

        it("seeds define_link_type as a governed, approval-gated Action", async () => {
            // Reads funnel through ensureDefaultsSeeded, which back-fills actions too.
            await ontologyService.listObjectTypes(ORG_A);

            const [action] = await db
                .select()
                .from(ontologyActions)
                .where(and(
                    eq(ontologyActions.organizationId, ORG_A.organizationId),
                    eq(ontologyActions.name, "define_link_type"),
                ));

            expect(action).toBeDefined();
            expect(action.effect).toBe("write");
            // The gate is the whole point: a schema change must not bypass approval.
            expect(action.requiresApproval).toBe(true);
            expect(action.handlerKind).toBe("builtin");
            expect(action.handlerRef).toBe(OntologyService.DEFINE_LINK_TYPE_REF);
        });

        it("refuses a link whose source property does not exist on the source type", async () => {
            await expect(
                ontologyService.defineLinkType(ORG_A, {
                    sourceType: "App Deployment",
                    name: LINK,
                    inverseName: "integration_deployed_by",
                    sourceProperty: "nope_not_a_column",
                    targetType: "App",
                }),
            ).rejects.toThrow(/has no property 'nope_not_a_column'/);
        });

        it("declares a derived link and reads it back from both ends", async () => {
            const created = await ontologyService.defineLinkType(ORG_A, {
                sourceType: "App Deployment",
                name: LINK,
                inverseName: "integration_deployed_by",
                sourceProperty: "appId",
                targetType: "App",
                description: "Integration fixture link.",
            });
            expect(created.backing).toBe("derived");
            expect(created.sourceProperty).toBe("appId");

            // Visible from the source...
            const fromSource = await ontologyService.listLinkTypes(ORG_A, "App Deployment");
            expect(fromSource.map((l) => l.name)).toContain(LINK);
            // ...and from the target, which is what inverseName exists for.
            const fromTarget = await ontologyService.listLinkTypes(ORG_A, "App");
            const back = fromTarget.find((l) => l.name === LINK);
            expect(back?.inverseName).toBe("integration_deployed_by");
            expect(back?.sourceType).toBe("App Deployment");
            expect(back?.targetType).toBe("App");
        });

        it("is idempotent on (org, source type, name)", async () => {
            const opts = {
                sourceType: "App Deployment",
                name: LINK,
                inverseName: "integration_renamed_inverse",
                sourceProperty: "appId",
                targetType: "App",
            };
            await ontologyService.defineLinkType(ORG_A, opts);
            await ontologyService.defineLinkType(ORG_A, opts);

            const links = (await ontologyService.listLinkTypes(ORG_A, "App Deployment")).filter(
                (l) => l.name === LINK,
            );
            expect(links).toHaveLength(1);
            expect(links[0].inverseName).toBe("integration_renamed_inverse");
        });

        it("does not leak a link declaration to another org", async () => {
            const bLinks = await ontologyService.listLinkTypes(ORG_B);
            expect(bLinks.map((l) => l.name)).not.toContain(LINK);
        });

        it("rejects a polymorphic link that maps to a nonexistent Object Type", async () => {
            await expect(
                ontologyService.defineLinkType(ORG_A, {
                    sourceType: "Project Resource",
                    name: "integration_contains",
                    inverseName: "integration_contained_by",
                    sourceProperty: "resourceId",
                    targetTypeProperty: "resourceType",
                    targetTypeMap: { mission: "Mission", bogus: "NotAType" },
                }),
            ).rejects.toThrow(/NotAType/);
        });
    });

    describe("Link traversal", () => {
        const DEPLOY_LINK = "integration_traverse_deploys";
        const DEPLOY_INVERSE = "integration_traverse_deployed_by";
        const HOLD_LINK = "integration_holds";
        const HOLD_INVERSE = "integration_held_by";
        let appId: number;
        let deploymentId: number;
        let holderOneId: string;

        beforeAll(async () => {
            // An app this org can actually see, and its own installation of it, so a
            // forward traversal has somewhere to land.
            const [app] = await db
                .insert(apps)
                .values({
                    name: `${FIXTURE_TAG} traversal target`,
                    slug: `${FIXTURE_SLUG_PREFIX}-traverse`,
                    organizationId: ORG_A.organizationId,
                })
                .returning({ id: apps.id });
            appId = app.id;

            // One only: app_deployment_org_app_unq means an org installs a given app at
            // most once, so the inbound side of this link is one row by construction.
            const [deployment] = await db
                .insert(appDeployments)
                .values({ appId, organizationId: ORG_A.organizationId, status: "installed" })
                .returning({ id: appDeployments.id });
            deploymentId = deployment.id;

            await ontologyService.defineLinkType(ORG_A, {
                sourceType: "App Deployment",
                name: DEPLOY_LINK,
                inverseName: DEPLOY_INVERSE,
                sourceProperty: "appId",
                targetType: "App",
            });

            // Polymorphic fixtures, materialized so the discriminator assertion is exact.
            const [holderType] = await db
                .insert(ontologyObjectTypes)
                .values({
                    organizationId: ORG_A.organizationId,
                    name: HOLDER_TYPE,
                    backing: "materialized",
                    titleProperty: "label",
                    propertiesSchema: { label: "string", targetKind: "string", targetRef: "string" },
                })
                .returning({ id: ontologyObjectTypes.id });
            await db.insert(ontologyObjectTypes).values({
                organizationId: ORG_A.organizationId,
                name: GADGET_TYPE,
                backing: "materialized",
                titleProperty: "label",
            });

            await db.insert(ontologyObjects).values([
                {
                    organizationId: ORG_A.organizationId,
                    objectTypeId: holderType.id,
                    externalId: "h1",
                    properties: { label: "Holds a widget", targetKind: "widget", targetRef: "w1" },
                },
                {
                    // SAME ref, different kind. This is the row that must not come back
                    // when traversing inbound from the widget.
                    organizationId: ORG_A.organizationId,
                    objectTypeId: holderType.id,
                    externalId: "h2",
                    properties: { label: "Holds a gadget", targetKind: "gadget", targetRef: "w1" },
                },
                {
                    // A second genuine holder of the widget, so the inbound direction
                    // has more than one row and truncation is observable.
                    organizationId: ORG_A.organizationId,
                    objectTypeId: holderType.id,
                    externalId: "h3",
                    properties: { label: "Also holds the widget", targetKind: "widget", targetRef: "w1" },
                },
            ]);
            holderOneId = "h1";

            await ontologyService.defineLinkType(ORG_A, {
                sourceType: HOLDER_TYPE,
                name: HOLD_LINK,
                inverseName: HOLD_INVERSE,
                sourceProperty: "targetRef",
                targetTypeProperty: "targetKind",
                targetTypeMap: { widget: MAT_TYPE, gadget: GADGET_TYPE },
            });
        });

        it("follows a link forward, from the source to the object it names", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "App Deployment",
                id: deploymentId,
                link: DEPLOY_LINK,
            });

            expect(res.link.direction).toBe("forward");
            expect(res.link.toType).toBe("App");
            expect(res.objects).toHaveLength(1);
            expect(res.objects[0].id).toBe(appId);
            // A keyed fetch, not a scan — there is nothing it could have missed.
            expect(res.complete).toBe(true);
        });

        it("follows the same link backwards under its inverse name", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "App",
                id: appId,
                link: DEPLOY_INVERSE,
            });

            expect(res.link.direction).toBe("inverse");
            expect(res.link.toType).toBe("App Deployment");
            expect(res.objects.map((o) => o.id)).toContain(deploymentId);
            // app_deployments implements listBy, so the inbound side is an indexed
            // filter rather than a bounded scan.
            expect(res.complete).toBe(true);
        });

        it("reports a truncated answer as incomplete", async () => {
            // Two holders genuinely hold the widget; asking for one must not imply that
            // is all there is. A caller reading a partial answer as the whole set
            // concludes the exact opposite of the truth ("only one thing references
            // this, safe to remove").
            const partial = await ontologyService.traverse(ORG_A, {
                objectType: MAT_TYPE,
                id: "w1",
                link: HOLD_INVERSE,
                limit: 1,
            });
            expect(partial.objects).toHaveLength(1);
            expect(partial.complete).toBe(false);
            expect(partial.note).toMatch(/complete set/);

            const full = await ontologyService.traverse(ORG_A, {
                objectType: MAT_TYPE,
                id: "w1",
                link: HOLD_INVERSE,
            });
            expect(full.objects.map((o) => o.id).sort()).toEqual(["h1", "h3"]);
            expect(full.complete).toBe(true);
            expect(full.note).toBeUndefined();
        });

        it("still answers inbound on a property the adapter cannot filter on", async () => {
            // appName is joined in from the apps table: readable, but not a column of
            // app_deployments, so listBy refuses it. Forward traversal on such a
            // property works, and the inbound side must degrade to a bounded scan
            // rather than failing the whole traversal.
            await ontologyService.defineLinkType(ORG_A, {
                sourceType: "App Deployment",
                name: "integration_named_after",
                inverseName: "integration_names",
                sourceProperty: "appName",
                targetType: "App",
                targetProperty: "name",
            });

            const res = await ontologyService.traverse(ORG_A, {
                objectType: "App",
                id: appId,
                link: "integration_names",
            });

            expect(res.objects.map((o) => o.id)).toContain(deploymentId);
            // Complete because the scan did not fill its page, not because it was
            // exact: the flag reports what was actually established, so a fallback
            // that happened to see everything is not reported as partial.
            expect(res.complete).toBe(true);
        });

        it("names what IS traversable when the link is not", async () => {
            await expect(
                ontologyService.traverse(ORG_A, { objectType: "App Deployment", id: deploymentId, link: "nope" }),
            ).rejects.toThrow(new RegExp(`No relationship 'nope'[\\s\\S]*${DEPLOY_LINK}`));
        });

        it("cannot be used to reach another org's objects", async () => {
            // The deployment belongs to org A; org B may not even resolve it, so the
            // traversal fails at the object rather than leaking the app behind it.
            await expect(
                ontologyService.traverse(ORG_B, { objectType: "App Deployment", id: deploymentId, link: DEPLOY_LINK }),
            ).rejects.toThrow(NotFoundError);
        });

        it("resolves a polymorphic link through the row's own discriminator", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: HOLDER_TYPE,
                id: holderOneId,
                link: HOLD_LINK,
            });

            expect(res.link.toType).toBe(MAT_TYPE);
            expect(res.objects).toHaveLength(1);
            expect(res.objects[0].label).toBe("Widget One");
        });

        it("reports an unresolvable polymorphic target instead of an empty result", async () => {
            // h2 points at 'w1' but declares kind 'gadget'; no gadget has that id.
            const res = await ontologyService.traverse(ORG_A, {
                objectType: HOLDER_TYPE,
                id: "h2",
                link: HOLD_LINK,
            });

            expect(res.link.toType).toBe(GADGET_TYPE);
            expect(res.objects).toHaveLength(0);
            expect(res.complete).toBe(true);
        });

        it("does not treat a matching key with a different discriminator as related", async () => {
            // h1 and h2 carry the SAME targetRef. Matching on the join key alone would
            // report the gadget-holder as one of this widget's holders.
            const res = await ontologyService.traverse(ORG_A, {
                objectType: MAT_TYPE,
                id: "w1",
                link: HOLD_INVERSE,
            });

            expect(res.link.direction).toBe("inverse");
            expect(res.link.toType).toBe(HOLDER_TYPE);
            const ids = res.objects.map((o) => o.id);
            expect(ids.sort()).toEqual(["h1", "h3"]);
            expect(ids, "h2 carries the same ref but points at a gadget").not.toContain("h2");
        });
    });

    it("seeds and lists the default virtual Object Types per org", async () => {
        const types = await ontologyService.listObjectTypes(ORG_A);
        const names = types.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(["Dataset", "Job", "Mission", "Pipeline"]));
        const mission = types.find((t) => t.name === "Mission");
        expect(mission?.backing).toBe("virtual");
        expect(mission?.properties).toHaveProperty("name");
    });

    it("materialized objects are isolated: org B cannot read org A's object", async () => {
        const found = await ontologyService.getObject(ORG_A, MAT_TYPE, "w1");
        expect(found.label).toBe("Widget One");

        await expect(ontologyService.getObject(ORG_B, MAT_TYPE, "w1")).rejects.toThrow(NotFoundError);

        const aList = await ontologyService.listObjects(ORG_A, MAT_TYPE);
        const bList = await ontologyService.listObjects(ORG_B, MAT_TYPE);
        expect(aList.length).toBe(1);
        expect(bList.length).toBe(0);
    });

    it("executes a builtin write action and writes an audit-log row", async () => {
        const res = await ontologyService.executeAction(ORG_A, ECHO_ACTION, { msg: "hi" });
        expect(res.status).toBe("executed");
        expect(res.result).toEqual({ echoed: { msg: "hi" } });

        const [action] = await db
            .select({ id: ontologyActions.id })
            .from(ontologyActions)
            .where(and(eq(ontologyActions.organizationId, ORG_A.organizationId), eq(ontologyActions.name, ECHO_ACTION)));
        const logs = await db
            .select({ status: ontologyActionLog.status })
            .from(ontologyActionLog)
            .where(eq(ontologyActionLog.actionId, action.id));
        expect(logs.some((l) => l.status === "executed")).toBe(true);
    });

    it("validates action params (missing required param rejected)", async () => {
        await expect(ontologyService.executeAction(ORG_A, ECHO_ACTION, {})).rejects.toThrow(/Missing required parameter 'msg'/);
    });

    it("isolates actions: org B cannot invoke org A's action", async () => {
        await expect(ontologyService.executeAction(ORG_B, ECHO_ACTION, { msg: "hi" })).rejects.toThrow(NotFoundError);
    });

    it("refuses a call without an org context", async () => {
        await expect(ontologyService.listObjectTypes({} as any)).rejects.toThrow();
    });

    /**
     * Alert and App are the two primitives whose backing tables do NOT scope the way
     * every earlier adapter did, so their filters are proven against real rows rather
     * than assumed: alerts.organization_id is nullable and often left null, and an app
     * is owned by `developerOrgId ?? organizationId`, either of which may be the one
     * that is set.
     */
    describe("Alert primitive", () => {
        let linked: { scheduledJobId: number; pipelineRunId: number; alertIds: number[] };

        beforeAll(async () => {
            await db.insert(alerts).values([
                { organizationId: ORG_A.organizationId, severity: "warning", category: "system", message: `${FIXTURE_TAG} org A alert` },
                { organizationId: null, severity: "critical", category: "job_failure", message: `${FIXTURE_TAG} unowned alert` },
            ]);

            // The two ends an alert can actually reach. Built here rather than shared
            // with the scheduling block below because describe bodies run in file
            // order and that fixture does not exist yet.
            const [sched] = await db
                .insert(schedules)
                .values({
                    name: `${FIXTURE_TAG} alert schedule`,
                    organizationId: ORG_A.organizationId,
                    pattern: 4,
                    patternString: { cron: "0 4 * * *" },
                })
                .returning({ id: schedules.id });
            const [sj] = await db
                .insert(scheduledJobs)
                .values({
                    name: `${FIXTURE_TAG} failing nightly`,
                    organizationId: ORG_A.organizationId,
                    scheduleId: sched.id,
                })
                .returning({ id: scheduledJobs.id });

            const [pipe] = await db
                .insert(pipelines)
                .values({
                    name: `${FIXTURE_TAG} alerting pipeline`,
                    organizationId: ORG_A.organizationId,
                    triggerType: "manual",
                    createdBy: ORG_A.userId,
                })
                .returning({ id: pipelines.id });
            const [run] = await db
                .insert(pipelineExecutions)
                .values({ pipelineId: pipe.id, status: "failed", organizationId: null, createdBy: ORG_A.userId })
                .returning({ id: pipelineExecutions.id });

            const rows = await db
                .insert(alerts)
                .values([
                    {
                        organizationId: ORG_A.organizationId, severity: "error", category: "job_failure",
                        message: `${FIXTURE_TAG} scheduled job failed`, scheduledJobId: sj.id,
                    },
                    {
                        organizationId: ORG_A.organizationId, severity: "error", category: "pipeline_failure",
                        message: `${FIXTURE_TAG} pipeline run failed`, pipelineRunId: run.id,
                    },
                ])
                .returning({ id: alerts.id });

            linked = { scheduledJobId: sj.id, pipelineRunId: run.id, alertIds: rows.map((r) => r.id) };
        });

        it("lists this org's alerts and not another org's", async () => {
            const a = await ontologyService.listObjects(ORG_A, "Alert", { limit: 200 });
            const b = await ontologyService.listObjects(ORG_B, "Alert", { limit: 200 });
            expect(a.map((r) => r.message)).toContain(`${FIXTURE_TAG} org A alert`);
            expect(b.map((r) => r.message)).not.toContain(`${FIXTURE_TAG} org A alert`);
        });

        it("shows an alert belonging to no org to nobody, rather than to everyone", async () => {
            // Writers like the DLQ handler leave organization_id null. Surfacing those
            // per-org would hand every tenant an alert about someone else's job run.
            for (const org of [ORG_A, ORG_B]) {
                const rows = await ontologyService.listObjects(org, "Alert", { limit: 200 });
                expect(rows.map((r) => r.message)).not.toContain(`${FIXTURE_TAG} unowned alert`);
            }
        });

        it("titles an alert by its message", async () => {
            const types = await ontologyService.listObjectTypes(ORG_A);
            const alertType = types.find((t) => t.name === "Alert");
            expect(alertType?.titleProperty).toBe("message");
            expect(Object.keys(alertType?.properties ?? {})).toContain("severity");
        });

        it("attributes a recurring failure to the automation causing it", async () => {
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Alert", id: linked.alertIds[0], link: "raised_for_scheduled_job",
            });
            expect(fwd.link.toType).toBe("Scheduled Job");
            expect(fwd.objects.map((j) => j.id)).toEqual([linked.scheduledJobId]);

            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Scheduled Job", id: linked.scheduledJobId, link: "has_alert",
            });
            expect(back.objects.map((a) => a.id)).toEqual([linked.alertIds[0]]);
        });

        it("reaches the pipeline run an alert is about", async () => {
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Alert", id: linked.alertIds[1], link: "about_pipeline_run",
            });
            expect(fwd.objects.map((r) => r.id)).toEqual([linked.pipelineRunId]);

            // `has_alert` is reused as the inverse from two different target types.
            // That is legal because uniqueness is per target type, and it has to keep
            // meaning the same thing from both ends.
            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Run", id: linked.pipelineRunId, link: "has_alert",
            });
            expect(back.objects.map((a) => a.id)).toEqual([linked.alertIds[1]]);
        });

        it("declares no link on jobRunId, which is not a key", async () => {
            // No job_runs table exists and the only writer of a job run id uses
            // Date.now(). A link here would be a traversal that can never resolve.
            const links = await ontologyService.listLinkTypes(ORG_A, "Alert");
            expect(links.map((l) => l.sourceProperty)).not.toContain("jobRunId");
        });
    });

    describe("App and App Deployment primitives", () => {
        beforeAll(async () => {
            await db.insert(apps).values([
                { name: `${FIXTURE_TAG} developer-owned`, slug: `${FIXTURE_SLUG_PREFIX}-dev-owned`, developerOrgId: ORG_A.organizationId },
                { name: `${FIXTURE_TAG} organization-owned`, slug: `${FIXTURE_SLUG_PREFIX}-org-owned`, organizationId: ORG_A.organizationId },
                { name: `${FIXTURE_TAG} other org`, slug: `${FIXTURE_SLUG_PREFIX}-other-org`, developerOrgId: ORG_B.organizationId },
                // Another org's app flagged public: `is_public` means "not access
                // restricted", NOT "listed for sale", so it must not leak here.
                { name: `${FIXTURE_TAG} other org public`, slug: `${FIXTURE_SLUG_PREFIX}-other-public`, developerOrgId: ORG_B.organizationId, isPublic: true },
                { name: `${FIXTURE_TAG} standard built-in`, slug: `${FIXTURE_SLUG_PREFIX}-standard`, isSystem: true, distribution: "standard" },
                // A listing: authored by org B, on the shelf for everyone to demo or buy.
                { name: `${FIXTURE_TAG} listed for sale`, slug: `${FIXTURE_SLUG_PREFIX}-listed`, developerOrgId: ORG_B.organizationId, distribution: "listed", pricePerLaunchUsd: "4.00" },
            ]);

            // Org B installs org A's app: the buyer relation, which is what makes
            // App and App Deployment answer different questions.
            const [installed] = await db
                .select({ id: apps.id })
                .from(apps)
                .where(eq(apps.slug, `${FIXTURE_SLUG_PREFIX}-dev-owned`));
            await db.insert(appDeployments).values({
                appId: installed.id,
                organizationId: ORG_B.organizationId,
                status: "installed",
                currentSpendUsd: "1.50",
                plan: "trial",
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                budgetLimitUsd: "10.00",
            });
        });

        it("lists an app authored through developerOrgId OR organizationId", async () => {
            const slugs = (await ontologyService.listObjects(ORG_A, "App", { limit: 200 })).map((r) => r.slug);
            // Filtering on either column alone would drop one of these two.
            expect(slugs).toContain(`${FIXTURE_SLUG_PREFIX}-dev-owned`);
            expect(slugs).toContain(`${FIXTURE_SLUG_PREFIX}-org-owned`);
        });

        it("includes standard built-ins, which belong to no org but are everyone's", async () => {
            for (const org of [ORG_A, ORG_B]) {
                const rows = await ontologyService.listObjects(org, "App", { limit: 200 });
                const standard = rows.find((r) => r.slug === `${FIXTURE_SLUG_PREFIX}-standard`);
                expect(standard, "a standard app must be visible to every org").toBeDefined();
                expect(standard!.distribution).toBe("standard");
            }
        });

        it("classifies an org's own app as custom", async () => {
            const rows = await ontologyService.listObjects(ORG_A, "App", { limit: 200 });
            expect(rows.find((r) => r.slug === `${FIXTURE_SLUG_PREFIX}-dev-owned`)!.distribution).toBe("custom");
        });

        it("does not show another org's app, public or not", async () => {
            const slugs = (await ontologyService.listObjects(ORG_A, "App", { limit: 200 })).map((r) => r.slug);
            expect(slugs).not.toContain(`${FIXTURE_SLUG_PREFIX}-other-org`);
            expect(slugs, "is_public is not a marketplace listing").not.toContain(`${FIXTURE_SLUG_PREFIX}-other-public`);
        });

        it("fetches by slug as well as by id, still org-scoped", async () => {
            const bySlug = await ontologyService.getObject(ORG_A, "App", `${FIXTURE_SLUG_PREFIX}-dev-owned`);
            expect(bySlug.name).toBe(`${FIXTURE_TAG} developer-owned`);

            const byId = await ontologyService.getObject(ORG_A, "App", bySlug.id);
            expect(byId.slug).toBe(`${FIXTURE_SLUG_PREFIX}-dev-owned`);

            await expect(ontologyService.getObject(ORG_B, "App", `${FIXTURE_SLUG_PREFIX}-dev-owned`)).rejects.toThrow(NotFoundError);
        });

        it("answers 'what have I installed' separately from 'what did I author'", async () => {
            // Org B authored nothing of A's, but runs it — the case that makes the
            // catalogue view useless on its own once apps can be bought.
            const bDeployments = await ontologyService.listObjects(ORG_B, "App Deployment", { limit: 200 });
            const installed = bDeployments.find((d) => d.appSlug === `${FIXTURE_SLUG_PREFIX}-dev-owned`);
            expect(installed, "org B installed org A's app").toBeDefined();
            expect(installed!.appName).toBe(`${FIXTURE_TAG} developer-owned`);
            expect(installed!.currentSpendUsd).toBe("1.50");

            const bApps = (await ontologyService.listObjects(ORG_B, "App", { limit: 200 })).map((r) => r.slug);
            expect(bApps, "installing an app does not make you its author").not.toContain(`${FIXTURE_SLUG_PREFIX}-dev-owned`);
        });

        it("carries the licence on the installation, so a demo is not a second app", async () => {
            const [deployment] = await ontologyService.listObjects(ORG_B, "App Deployment", { limit: 200 });
            expect(deployment.plan).toBe("trial");
            expect(deployment.expiresAt, "a trial without an expiry is a giveaway").toBeTruthy();
            expect(deployment.budgetLimitUsd).toBe("10.00");

            // The app itself is untouched by org B trialling it.
            const app = await ontologyService.getObject(ORG_A, "App", `${FIXTURE_SLUG_PREFIX}-dev-owned`);
            expect(app.distribution).toBe("custom");
        });

        it("keeps deployments org-scoped", async () => {
            const aDeployments = await ontologyService.listObjects(ORG_A, "App Deployment", { limit: 200 });
            expect(aDeployments.map((d) => d.appSlug)).not.toContain(`${FIXTURE_SLUG_PREFIX}-dev-owned`);
        });

        it("titles a deployment by its app's name, since publicSlug is nullable", async () => {
            const types = await ontologyService.listObjectTypes(ORG_B);
            expect(types.find((t) => t.name === "App Deployment")?.titleProperty).toBe("appName");
        });
    });

    /**
     * Two adapters read tables with NO tenant column, and both used to read them with
     * no filter whatsoever — every org's rows, to every caller. The file's own contract
     * says an adapter MUST scope by ctx.organizationId, so these lock the two answers:
     * scope through an owner where one exists, refuse where none does.
     */
    describe("adapters over tables with no org column", () => {
        it("scopes swarm tasks through the mission that owns them", async () => {
            const [mission] = await db
                .insert(missions)
                .values({
                    name: `${FIXTURE_TAG} org A mission`,
                    organizationId: ORG_A.organizationId,
                    createdBy: ORG_A.userId, // NOT NULL with no default
                })
                .returning({ id: missions.id });
            await db.insert(swarmTasks).values({
                missionId: mission.id,
                description: `${FIXTURE_TAG} org A swarm task`,
            });

            const a = await ontologyService.listObjects(ORG_A, "Swarm Task", { limit: 200 });
            const b = await ontologyService.listObjects(ORG_B, "Swarm Task", { limit: 200 });
            expect(a.map((t) => t.description)).toContain(`${FIXTURE_TAG} org A swarm task`);
            expect(b.map((t) => t.description)).not.toContain(`${FIXTURE_TAG} org A swarm task`);

            const [task] = a.filter((t) => t.description === `${FIXTURE_TAG} org A swarm task`);
            await expect(ontologyService.getObject(ORG_B, "Swarm Task", task.id)).rejects.toThrow(NotFoundError);
        });

        it("shows platform-wide transference rules only to a super admin", async () => {
            // transference_rules has no org column at all — it is learned across the
            // whole installation — so a tenant gets nothing rather than everything.
            const asTenant = await ontologyService.listObjects(ORG_A, "Transference Rule", { limit: 5 });
            expect(asTenant).toEqual([]);

            const asSuper = await ontologyService.listObjects(
                { ...ORG_A, isSuperAdmin: true },
                "Transference Rule",
                { limit: 5 },
            );
            expect(Array.isArray(asSuper)).toBe(true);
        });
    });

    /**
     * The step spine: Pipeline -> Pipeline Step, and Pipeline Run -> Pipeline Step Run.
     *
     * Two things are being proven here. First that the org boundary holds when it is a
     * JOIN rather than a column — pipeline_steps and pipeline_step_executions have no
     * organization_id, which is precisely the shape that leaked every org's rows in the
     * transference/swarm adapters. Second that the derived links resolve in both
     * directions, since a Link Type that reads only forwards leaves the question people
     * actually ask ("which runs did this step have?") unanswerable.
     */
    describe("pipeline step spine", () => {
        // Built once and read by every assertion below; each one describes a different
        // hop of the same graph, so re-seeding per test would only slow it down.
        let fixture: {
            pipelineId: number;
            stepIds: number[];
            runId: number;
            stepRunIds: number[];
            otherOrgStepId: number;
        };

        beforeAll(async () => {
            const [pipeA] = await db
                .insert(pipelines)
                .values({
                    name: `${FIXTURE_TAG} org A pipeline`,
                    organizationId: ORG_A.organizationId,
                    triggerType: "manual", // NOT NULL, no default
                    createdBy: ORG_A.userId,
                })
                .returning({ id: pipelines.id });

            const stepRows = await db
                .insert(pipelineSteps)
                .values([
                    { pipelineId: pipeA.id, order: 0, outputName: `${FIXTURE_TAG} extract` },
                    // No outputName and no job: the label has to fall back to the
                    // ordinal, which is the case that would otherwise render as blank.
                    { pipelineId: pipeA.id, order: 1, toolName: null },
                ])
                .returning({ id: pipelineSteps.id });

            const [run] = await db
                .insert(pipelineExecutions)
                .values({
                    pipelineId: pipeA.id,
                    status: "failed",
                    // Deliberately NULL, which is what the overwhelming majority of
                    // real rows look like (20 of 22 in the dev database). Scoping this
                    // type on the execution's own org column instead of the pipeline's
                    // would hide almost every run and every step run behind it, and
                    // the type would read as empty rather than as broken.
                    organizationId: null,
                    createdBy: ORG_A.userId,
                })
                .returning({ id: pipelineExecutions.id });

            const stepRunRows = await db
                .insert(pipelineStepExecutions)
                .values([
                    { pipelineExecutionId: run.id, pipelineStepId: stepRows[0].id, stepOrder: 0, status: "success" },
                    { pipelineExecutionId: run.id, pipelineStepId: stepRows[1].id, stepOrder: 1, status: "failure", error: "boom" },
                ])
                .returning({ id: pipelineStepExecutions.id });

            // The other org's pipeline exists so isolation is proven against real
            // neighbouring rows rather than against an empty table.
            const [pipeB] = await db
                .insert(pipelines)
                .values({
                    name: `${FIXTURE_TAG} org B pipeline`,
                    organizationId: ORG_B.organizationId,
                    triggerType: "manual",
                    createdBy: ORG_B.userId,
                })
                .returning({ id: pipelines.id });
            const [stepB] = await db
                .insert(pipelineSteps)
                .values({ pipelineId: pipeB.id, order: 0, outputName: `${FIXTURE_TAG} org B step` })
                .returning({ id: pipelineSteps.id });

            fixture = {
                pipelineId: pipeA.id,
                stepIds: stepRows.map((r) => r.id),
                runId: run.id,
                stepRunIds: stepRunRows.map((r) => r.id),
                otherOrgStepId: stepB.id,
            };
        });

        it("registers the three step Object Types", async () => {
            const names = (await ontologyService.listObjectTypes(ORG_A)).map((t) => t.name);
            expect(names).toEqual(expect.arrayContaining(["Pipeline Step", "Pipeline Run", "Pipeline Step Run"]));
        });

        it("scopes steps through the pipeline that owns them", async () => {
            const a = await ontologyService.listObjects(ORG_A, "Pipeline Step", { limit: 200 });
            const b = await ontologyService.listObjects(ORG_B, "Pipeline Step", { limit: 200 });

            expect(a.map((s) => s.id)).toEqual(expect.arrayContaining(fixture.stepIds));
            expect(a.map((s) => s.id)).not.toContain(fixture.otherOrgStepId);
            expect(b.map((s) => s.id)).not.toContain(fixture.stepIds[0]);

            await expect(
                ontologyService.getObject(ORG_B, "Pipeline Step", fixture.stepIds[0]),
            ).rejects.toThrow(NotFoundError);
        });

        it("reaches a run whose own org column is null, through its pipeline", async () => {
            const a = await ontologyService.listObjects(ORG_A, "Pipeline Run", { limit: 200 });
            expect(a.map((r) => r.id)).toContain(fixture.runId);

            // Still isolated: the pipeline decides, and it belongs to A.
            const b = await ontologyService.listObjects(ORG_B, "Pipeline Run", { limit: 200 });
            expect(b.map((r) => r.id)).not.toContain(fixture.runId);
            await expect(
                ontologyService.getObject(ORG_B, "Pipeline Run", fixture.runId),
            ).rejects.toThrow(NotFoundError);
        });

        it("scopes step runs through the execution that owns them", async () => {
            const a = await ontologyService.listObjects(ORG_A, "Pipeline Step Run", { limit: 200 });
            expect(a.map((r) => r.id)).toEqual(expect.arrayContaining(fixture.stepRunIds));

            await expect(
                ontologyService.getObject(ORG_B, "Pipeline Step Run", fixture.stepRunIds[0]),
            ).rejects.toThrow(NotFoundError);
        });

        it("labels a step that has no name of its own", async () => {
            const named = await ontologyService.getObject(ORG_A, "Pipeline Step", fixture.stepIds[0]);
            const unnamed = await ontologyService.getObject(ORG_A, "Pipeline Step", fixture.stepIds[1]);
            expect(named.label).toBe(`${FIXTURE_TAG} extract`);
            expect(unnamed.label).toBe("Step 1");
        });

        it("keeps steps in execution order, not insertion order", async () => {
            const steps = await ontologyService.listObjects(ORG_A, "Pipeline Step", { limit: 200 });
            const ours = steps.filter((s) => s.pipelineId === fixture.pipelineId).map((s) => s.order);
            expect(ours).toEqual([...ours].sort((x, y) => x - y));
        });

        it("follows step_of forward to the pipeline", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Step",
                id: fixture.stepIds[0],
                link: "step_of",
            });
            expect(res.link.toType).toBe("Pipeline");
            expect(res.objects.map((p) => p.id)).toEqual([fixture.pipelineId]);
            expect(res.complete).toBe(true);
        });

        it("reads has_step from the pipeline back to its steps", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline",
                id: fixture.pipelineId,
                link: "has_step",
            });
            expect(res.link.direction).toBe("inverse");
            expect(res.objects.map((s) => s.id).sort()).toEqual([...fixture.stepIds].sort());
            // listBy on the adapter, so this is an indexed filter, not a capped scan.
            expect(res.complete).toBe(true);
        });

        it("follows a step run to the step definition it executed", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Step Run",
                id: fixture.stepRunIds[1],
                link: "executed_step",
            });
            expect(res.link.toType).toBe("Pipeline Step");
            expect(res.objects.map((s) => s.id)).toEqual([fixture.stepIds[1]]);
        });

        it("reads has_execution from a step to every run of it", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Step",
                id: fixture.stepIds[1],
                link: "has_execution",
            });
            expect(res.objects.map((r) => r.id)).toEqual([fixture.stepRunIds[1]]);
            expect(res.objects[0].status).toBe("failure");
            expect(res.objects[0].error).toBe("boom");
        });

        it("reads has_step_run from the run to its step runs", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Run",
                id: fixture.runId,
                link: "has_step_run",
            });
            expect(res.objects.map((r) => r.id).sort()).toEqual([...fixture.stepRunIds].sort());
        });

        it("resolves the whole spine: a failing step run back to its pipeline", async () => {
            // The question the step types exist to answer, hop by hop.
            const toStep = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Step Run",
                id: fixture.stepRunIds[1],
                link: "executed_step",
            });
            const toPipeline = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Step",
                id: toStep.objects[0].id,
                link: "step_of",
            });
            expect(toPipeline.objects[0].name).toBe(`${FIXTURE_TAG} org A pipeline`);
        });

        it("does not expose step output through the ontology", async () => {
            // Unbounded, often a whole document: it would land in every list and every
            // agent context that touches the type.
            const [run] = await ontologyService.listObjects(ORG_A, "Pipeline Step Run", { limit: 1 });
            expect(run).not.toHaveProperty("output");
            expect(run).not.toHaveProperty("outputUri");
        });

        it("namespaces a link name to its source type, so a custom link cannot displace a default", async () => {
            // The premise the seeding back-fill guard rests on: uniqueness is
            // (org, sourceType, name), so 'step_of' declared from a DIFFERENT source
            // type coexists with the default rather than standing in for it. The guard
            // therefore has to key on the pair — keyed on the name alone it would read
            // this custom link as the default already being present and skip seeding a
            // default that does not exist.
            const custom = await ontologyService.defineLinkType(ORG_A, {
                sourceType: "Pipeline Run",
                name: "step_of", // deliberately the default's name, different source
                inverseName: "integration_custom_has_run",
                sourceProperty: "pipelineId",
                targetType: "Pipeline",
            });
            expect(custom.sourceType).toBe("Pipeline Run");

            try {
                const fromStep = await ontologyService.listLinkTypes(ORG_A, "Pipeline Step");
                const theDefault = fromStep.find(
                    (l) => l.name === "step_of" && l.sourceType === "Pipeline Step",
                );
                expect(theDefault, "the default must survive alongside the custom link").toBeDefined();
                expect(theDefault!.inverseName).toBe("has_step");

                // Traversal still resolves the default, not the newcomer.
                const res = await ontologyService.traverse(ORG_A, {
                    objectType: "Pipeline Step",
                    id: fixture.stepIds[0],
                    link: "step_of",
                });
                expect(res.objects.map((p) => p.id)).toEqual([fixture.pipelineId]);
            } finally {
                // Not caught by the `integration_%` sweep, since the whole point is
                // that it shares the default's name.
                const [runType] = await db
                    .select({ id: ontologyObjectTypes.id })
                    .from(ontologyObjectTypes)
                    .where(and(
                        eq(ontologyObjectTypes.organizationId, ORG_A.organizationId),
                        eq(ontologyObjectTypes.name, "Pipeline Run"),
                    ));
                await db.delete(ontologyLinkTypes).where(and(
                    eq(ontologyLinkTypes.organizationId, ORG_A.organizationId),
                    eq(ontologyLinkTypes.sourceTypeId, runType.id),
                    eq(ontologyLinkTypes.name, "step_of"),
                ));
            }
        });

        it("refuses to filter a step property it has no column for", async () => {
            // The link declaration validates against `properties`, which includes the
            // computed label; the adapter must still refuse to filter on it rather
            // than drop the predicate and return the whole org.
            const { ONTOLOGY_ADAPTERS } = await import("../../core/ontology-adapters.js");
            await expect(
                ONTOLOGY_ADAPTERS.pipeline_steps.listBy!(ORG_A, "label", "anything"),
            ).rejects.toThrow(/cannot be filtered/);
        });
    });

    /**
     * Scheduling: WHEN something recurs (Schedule) apart from WHAT recurs
     * (Scheduled Job).
     *
     * Both tables carry a nullable organization_id that is populated on every row in
     * practice, so unlike Pipeline Run they take a plain equality — and that has to be
     * proven rather than assumed, because a filter that is wrong in the strict
     * direction makes the whole type read as empty.
     */
    describe("scheduling primitives", () => {
        let fixture: {
            scheduleId: number;
            missionId: number;
            byMissionId: number;
            targetlessId: number;
            otherOrgScheduleId: number;
        };

        beforeAll(async () => {
            const [sched] = await db
                .insert(schedules)
                .values({
                    name: `${FIXTURE_TAG} nightly`,
                    organizationId: ORG_A.organizationId,
                    pattern: 4,
                    // The real shape: pattern_label and timezone are null on every row
                    // in the dev database, and the cron lives in the jsonb.
                    patternString: { cron: "0 2 * * *", action: "run mission-nightly" },
                    createdBy: ORG_A.userId,
                })
                .returning({ id: schedules.id });

            const [otherSched] = await db
                .insert(schedules)
                .values({
                    name: `${FIXTURE_TAG} other org nightly`,
                    organizationId: ORG_B.organizationId,
                    pattern: 4,
                    patternString: { cron: "0 3 * * *" },
                })
                .returning({ id: schedules.id });

            const [mission] = await db
                .insert(missions)
                .values({
                    name: `${FIXTURE_TAG} scheduled mission`,
                    organizationId: ORG_A.organizationId,
                    createdBy: ORG_A.userId, // NOT NULL, no default
                })
                .returning({ id: missions.id });

            const rows = await db
                .insert(scheduledJobs)
                .values([
                    {
                        name: `${FIXTURE_TAG} runs the mission`,
                        organizationId: ORG_A.organizationId,
                        scheduleId: sched.id,
                        missionId: mission.id,
                    },
                    {
                        // 23 of 42 real rows look like this: no job, pipeline or
                        // mission column. They dispatch through the schedule's own
                        // patternString.action instead, so an empty target is a
                        // different mechanism, not an orphan.
                        name: `${FIXTURE_TAG} targetless trigger`,
                        organizationId: ORG_A.organizationId,
                        scheduleId: sched.id,
                    },
                ])
                .returning({ id: scheduledJobs.id });

            fixture = {
                scheduleId: sched.id,
                missionId: mission.id,
                byMissionId: rows[0].id,
                targetlessId: rows[1].id,
                otherOrgScheduleId: otherSched.id,
            };
        });

        it("registers both scheduling types", async () => {
            const names = (await ontologyService.listObjectTypes(ORG_A)).map((t) => t.name);
            expect(names).toEqual(expect.arrayContaining(["Schedule", "Scheduled Job"]));
        });

        it("lifts the cron expression out of the pattern jsonb", async () => {
            // patternLabel is the column that was meant to say this and is null on all
            // 42 rows; without lifting it, "when does this run" needs blob parsing.
            const s = await ontologyService.getObject(ORG_A, "Schedule", fixture.scheduleId);
            expect(s.cron).toBe("0 2 * * *");
            expect(s.dispatchAction).toBe("run mission-nightly");
        });

        it("scopes both types to the organization", async () => {
            const mine = (await ontologyService.listObjects(ORG_A, "Schedule", { limit: 200 })).map((s) => s.id);
            expect(mine).toContain(fixture.scheduleId);
            expect(mine).not.toContain(fixture.otherOrgScheduleId);

            await expect(
                ontologyService.getObject(ORG_B, "Schedule", fixture.scheduleId),
            ).rejects.toThrow(NotFoundError);
        });

        it("joins the schedule's name onto the scheduled job", async () => {
            const j = await ontologyService.getObject(ORG_A, "Scheduled Job", fixture.byMissionId);
            expect(j.scheduleName).toBe(`${FIXTURE_TAG} nightly`);
        });

        it("follows runs_on_schedule, and reads every job on a schedule back", async () => {
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Scheduled Job",
                id: fixture.byMissionId,
                link: "runs_on_schedule",
            });
            expect(fwd.link.toType).toBe("Schedule");
            expect(fwd.objects.map((s) => s.id)).toEqual([fixture.scheduleId]);

            // The reason Schedule is its own type: several jobs share one recurrence.
            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Schedule",
                id: fixture.scheduleId,
                link: "has_scheduled_job",
            });
            expect(back.objects.map((j) => j.id).sort()).toEqual(
                [fixture.byMissionId, fixture.targetlessId].sort(),
            );
            expect(back.complete).toBe(true);
        });

        it("answers why a mission ran when nobody asked for it", async () => {
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Scheduled Job",
                id: fixture.byMissionId,
                link: "starts_mission",
            });
            expect(fwd.objects.map((m) => m.id)).toEqual([fixture.missionId]);

            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Mission",
                id: fixture.missionId,
                link: "mission_schedules",
            });
            expect(back.link.direction).toBe("inverse");
            expect(back.objects.map((j) => j.id)).toEqual([fixture.byMissionId]);
        });

        it("explains an unset target rather than returning a bare empty list", async () => {
            // The common shape in real data. An empty result with no reason reads as
            // "nothing is scheduled", which is the opposite of what this row means.
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Scheduled Job",
                id: fixture.targetlessId,
                link: "starts_mission",
            });
            expect(res.objects).toHaveLength(0);
            expect(res.complete).toBe(true);
            expect(res.note).toMatch(/no value for 'missionId'/);
        });
    });

    /**
     * Mission Run — the record that a mission actually ran, and the counterpart to
     * Pipeline Run one level up.
     *
     * The link worth proving here is `has_pipeline_run`, the inverse of a foreign key
     * that pipeline_executions has carried all along (16 of 22 dev rows) and that
     * nothing could read: a mission run's own `pipelineExecutionId` names only the
     * execution it is on now, so the run's actual history is only reachable from the
     * other end.
     */
    describe("mission run spine", () => {
        let fixture: {
            missionId: number;
            pipelineId: number;
            parentRunId: number;
            childRunId: number;
            deletedRunId: number;
            pipelineRunId: number;
            otherOrgRunId: number;
        };

        beforeAll(async () => {
            const [mission] = await db
                .insert(missions)
                .values({
                    name: `${FIXTURE_TAG} run-bearing mission`,
                    organizationId: ORG_A.organizationId,
                    createdBy: ORG_A.userId,
                })
                .returning({ id: missions.id });

            const [pipeline] = await db
                .insert(pipelines)
                .values({
                    name: `${FIXTURE_TAG} mission run pipeline`,
                    organizationId: ORG_A.organizationId,
                    triggerType: "manual",
                    createdBy: ORG_A.userId,
                })
                .returning({ id: pipelines.id });

            const [parentRun] = await db
                .insert(missionRuns)
                .values({
                    name: `${FIXTURE_TAG} first attempt`,
                    organizationId: ORG_A.organizationId,
                    missionId: mission.id,
                    currentPipelineId: pipeline.id,
                    status: "failed",
                    isSuccess: false,
                    failureReason: "boom",
                    costUsd: "1.2500", // decimal: comes back as a STRING
                    createdBy: ORG_A.userId,
                })
                .returning({ id: missionRuns.id });

            const [childRun] = await db
                .insert(missionRuns)
                .values({
                    // What mission-replay.service.ts writes: a re-run pointing at the
                    // run it replays. No dev row has one, so the fixture is the only
                    // place this link is exercised at all.
                    name: `${FIXTURE_TAG} replay`,
                    organizationId: ORG_A.organizationId,
                    missionId: mission.id,
                    parentId: parentRun.id,
                    status: "active",
                    createdBy: ORG_A.userId,
                })
                .returning({ id: missionRuns.id });

            const [deletedRun] = await db
                .insert(missionRuns)
                .values({
                    name: `${FIXTURE_TAG} soft deleted`,
                    organizationId: ORG_A.organizationId,
                    missionId: mission.id,
                    status: "cancelled",
                    createdBy: ORG_A.userId,
                    deletedAt: new Date(),
                })
                .returning({ id: missionRuns.id });

            const [pipeRun] = await db
                .insert(pipelineExecutions)
                .values({
                    pipelineId: pipeline.id,
                    missionRunId: parentRun.id,
                    status: "failed",
                    organizationId: null, // the usual shape; scoped through the pipeline
                    createdBy: ORG_A.userId,
                })
                .returning({ id: pipelineExecutions.id });

            const [otherMission] = await db
                .insert(missions)
                .values({
                    name: `${FIXTURE_TAG} org B mission`,
                    organizationId: ORG_B.organizationId,
                    createdBy: ORG_B.userId,
                })
                .returning({ id: missions.id });
            const [otherRun] = await db
                .insert(missionRuns)
                .values({
                    name: `${FIXTURE_TAG} org B run`,
                    organizationId: ORG_B.organizationId,
                    missionId: otherMission.id,
                    createdBy: ORG_B.userId,
                })
                .returning({ id: missionRuns.id });

            fixture = {
                missionId: mission.id,
                pipelineId: pipeline.id,
                parentRunId: parentRun.id,
                childRunId: childRun.id,
                deletedRunId: deletedRun.id,
                pipelineRunId: pipeRun.id,
                otherOrgRunId: otherRun.id,
            };
        });

        it("registers the Mission Run type", async () => {
            const names = (await ontologyService.listObjectTypes(ORG_A)).map((t) => t.name);
            expect(names).toContain("Mission Run");
        });

        it("scopes runs to the organization and hides soft-deleted ones", async () => {
            const mine = (await ontologyService.listObjects(ORG_A, "Mission Run", { limit: 500 })).map((r) => r.id);
            expect(mine).toContain(fixture.parentRunId);
            expect(mine).not.toContain(fixture.otherOrgRunId);
            expect(mine).not.toContain(fixture.deletedRunId);

            await expect(
                ontologyService.getObject(ORG_A, "Mission Run", fixture.deletedRunId),
            ).rejects.toThrow(NotFoundError);
            await expect(
                ontologyService.getObject(ORG_B, "Mission Run", fixture.parentRunId),
            ).rejects.toThrow(NotFoundError);
        });

        it("returns cost as a string, because the column is a decimal", async () => {
            // Typed "string" in the adapter for this reason: a caller that assumes a
            // number gets concatenation instead of arithmetic, silently.
            const run = await ontologyService.getObject(ORG_A, "Mission Run", fixture.parentRunId);
            expect(run.costUsd).toBe("1.2500");
        });

        it("separates one failed run from a mission that always fails", async () => {
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Mission Run", id: fixture.parentRunId, link: "run_of",
            });
            expect(fwd.link.toType).toBe("Mission");
            expect(fwd.objects.map((m) => m.id)).toEqual([fixture.missionId]);

            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Mission", id: fixture.missionId, link: "has_run",
            });
            // The soft-deleted run is excluded here too: traversal reads through the
            // same adapter, so it cannot resurrect a row the type itself hides.
            expect(back.objects.map((r) => r.id).sort()).toEqual(
                [fixture.parentRunId, fixture.childRunId].sort(),
            );
        });

        it("walks a replay back to the run it replays", async () => {
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Mission Run", id: fixture.childRunId, link: "sub_run_of",
            });
            expect(fwd.link.toType).toBe("Mission Run"); // self-referential link
            expect(fwd.objects.map((r) => r.id)).toEqual([fixture.parentRunId]);

            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Mission Run", id: fixture.parentRunId, link: "has_sub_run",
            });
            expect(back.objects.map((r) => r.id)).toEqual([fixture.childRunId]);
        });

        it("reads a mission run's pipeline executions from the far end", async () => {
            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Mission Run", id: fixture.parentRunId, link: "has_pipeline_run",
            });
            expect(back.link.direction).toBe("inverse");
            expect(back.objects.map((r) => r.id)).toEqual([fixture.pipelineRunId]);

            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Pipeline Run", id: fixture.pipelineRunId, link: "ran_in_mission_run",
            });
            expect(fwd.objects.map((r) => r.id)).toEqual([fixture.parentRunId]);
        });

        it("says where a stalled run stopped", async () => {
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: "Mission Run", id: fixture.parentRunId, link: "on_pipeline",
            });
            expect(fwd.objects.map((p) => p.id)).toEqual([fixture.pipelineId]);
        });
    });

    /**
     * Stored edges — `backing = "materialized"`, the other half of the Link Type
     * design, which declared a table and then had no reader or writer at all.
     *
     * The endpoints must be materialized objects because `ontology_links` references
     * `ontology_objects`; a virtual type has no row there. That constraint is checked
     * at DECLARATION, so a link cannot be defined that accepts its own definition and
     * then rejects every edge.
     */
    describe("materialized links", () => {
        const STORED_LINK = "integration_depends_on";
        beforeAll(async () => {
            const [widgetType] = await db
                .select({ id: ontologyObjectTypes.id })
                .from(ontologyObjectTypes)
                .where(and(eq(ontologyObjectTypes.organizationId, ORG_A.organizationId), eq(ontologyObjectTypes.name, MAT_TYPE)));
            await db.insert(ontologyObjects).values(
                ["stored-a", "stored-b", "stored-c"].map((externalId) => ({
                    organizationId: ORG_A.organizationId,
                    objectTypeId: widgetType.id,
                    externalId,
                    properties: { label: externalId },
                })),
            );
            await ontologyService.defineLinkType(ORG_A, {
                sourceType: MAT_TYPE,
                name: STORED_LINK,
                inverseName: "integration_depended_on_by",
                targetType: MAT_TYPE,
                backing: "materialized",
                cardinality: "many_to_many",
                description: "A stored edge between two widgets.",
            });
        });

        it("declares a stored link with no source property, because there is no join key", async () => {
            const links = await ontologyService.listLinkTypes(ORG_A, MAT_TYPE);
            const stored = links.find((l) => l.name === STORED_LINK);
            expect(stored?.backing).toBe("materialized");
            expect(stored?.sourceProperty).toBeNull();
        });

        it("refuses a stored link onto a virtual type, at declaration", async () => {
            // A mission is a view over a domain table and has no ontology_objects row,
            // so an edge naming it could never be written.
            await expect(
                ontologyService.defineLinkType(ORG_A, {
                    sourceType: MAT_TYPE,
                    name: "integration_impossible",
                    inverseName: "integration_impossible_inverse",
                    targetType: "Mission",
                    backing: "materialized",
                }),
            ).rejects.toThrow(/has no stored row for an edge to reference/);
        });

        it("links, traverses both ways, and treats a repeat link as the same fact", async () => {
            const first = await ontologyService.link(ORG_A, {
                sourceType: MAT_TYPE, linkName: STORED_LINK,
                sourceId: "stored-a", targetId: "stored-b",
            });
            expect(first.created).toBe(true);

            const again = await ontologyService.link(ORG_A, {
                sourceType: MAT_TYPE, linkName: STORED_LINK,
                sourceId: "stored-a", targetId: "stored-b",
            });
            expect(again.created).toBe(false);

            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: MAT_TYPE, id: "stored-a", link: STORED_LINK,
            });
            expect(fwd.objects.map((o) => o.id)).toEqual(["stored-b"]);
            expect(fwd.complete).toBe(true);

            const back = await ontologyService.traverse(ORG_A, {
                objectType: MAT_TYPE, id: "stored-b", link: "integration_depended_on_by",
            });
            expect(back.link.direction).toBe("inverse");
            expect(back.objects.map((o) => o.id)).toEqual(["stored-a"]);
        });

        it("keeps edges directional", async () => {
            // a -> b was linked; b -> a was not. A stored edge that answered both
            // directions to the same name would make the inverse meaningless.
            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: MAT_TYPE, id: "stored-b", link: STORED_LINK,
            });
            expect(fwd.objects).toHaveLength(0);
        });

        it("unlinks, and removing a missing edge is not an error", async () => {
            await ontologyService.link(ORG_A, {
                sourceType: MAT_TYPE, linkName: STORED_LINK, sourceId: "stored-a", targetId: "stored-c",
            });
            const removed = await ontologyService.unlink(ORG_A, {
                sourceType: MAT_TYPE, linkName: STORED_LINK, sourceId: "stored-a", targetId: "stored-c",
            });
            expect(removed.removed).toBe(1);

            const again = await ontologyService.unlink(ORG_A, {
                sourceType: MAT_TYPE, linkName: STORED_LINK, sourceId: "stored-a", targetId: "stored-c",
            });
            expect(again.removed).toBe(0);

            const fwd = await ontologyService.traverse(ORG_A, {
                objectType: MAT_TYPE, id: "stored-a", link: STORED_LINK,
            });
            expect(fwd.objects.map((o) => o.id)).toEqual(["stored-b"]);
        });

        it("refuses to write an edge for a derived link", async () => {
            // The derived link's edge lives in the source table's foreign key. A
            // stored row would be a second, divergent answer to the same question.
            await expect(
                ontologyService.link(ORG_A, {
                    sourceType: "Mission Run", linkName: "run_of", sourceId: 1, targetId: 1,
                }),
            ).rejects.toThrow(/is derived from/);
        });

        it("will not link an object another org owns", async () => {
            await expect(
                ontologyService.link(ORG_B, {
                    sourceType: MAT_TYPE, linkName: STORED_LINK, sourceId: "stored-a", targetId: "stored-b",
                }),
            ).rejects.toThrow(NotFoundError);
        });
    });

    /**
     * Project containment, and the first polymorphic links to ship as defaults.
     *
     * Project Resource is a junction, so the walk is two hops — mission to its
     * membership row, membership row to the project. The engine cannot route a link
     * THROUGH a join table, which is exactly why the junction stays an Object Type
     * rather than being replaced by a direct Project -> Mission link.
     */
    describe("project containment", () => {
        let fixture: { projectId: number; missionId: number; memberIds: number[]; unmappedMemberId: number };

        beforeAll(async () => {
            const [project] = await db
                .insert(projects)
                .values({
                    key: `${FIXTURE_SLUG_PREFIX}-containment`,
                    name: `${FIXTURE_TAG} containment project`,
                    organizationId: ORG_A.organizationId,
                    createdBy: ORG_A.userId,
                })
                .returning({ id: projects.id });

            const [mission] = await db
                .insert(missions)
                .values({
                    name: `${FIXTURE_TAG} contained mission`,
                    organizationId: ORG_A.organizationId,
                    createdBy: ORG_A.userId,
                })
                .returning({ id: missions.id });

            const rows = await db
                .insert(projectResources)
                .values([
                    { projectId: project.id, resourceType: "mission", resourceId: mission.id, relation: "primary" },
                    // A resource type with no Object Type. Three of the six
                    // PROJECT_RESOURCE_TYPES are unmapped, so this is the common case,
                    // not an edge one.
                    // `form` has no Object Type, by design. This used `cycle` until Cycle was registered.
                    { projectId: project.id, resourceType: "form", resourceId: 999999, relation: "referenced" },
                ])
                .returning({ id: projectResources.id });

            fixture = {
                projectId: project.id,
                missionId: mission.id,
                memberIds: rows.map((r) => r.id),
                unmappedMemberId: rows[1].id,
            };
        });

        it("walks a membership row to the thing it points at", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Project Resource",
                id: fixture.memberIds[0],
                link: "resource_of",
            });
            // The discriminator on THIS row decides the type — that is what makes the
            // link polymorphic rather than four separate ones.
            expect(res.link.toType).toBe("Mission");
            expect(res.objects.map((m) => m.id)).toEqual([fixture.missionId]);
        });

        it("names an unmapped resource type instead of resolving it to the wrong table", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Project Resource",
                id: fixture.unmappedMemberId,
                link: "resource_of",
            });
            expect(res.link.toType).toBeNull();
            expect(res.objects).toHaveLength(0);
            expect(res.note).toMatch(/'form' is not mapped/);
        });

        it("answers which projects a mission belongs to, in two hops", async () => {
            // The question the junction exists to answer, and the one a direct link
            // could not express.
            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Mission",
                id: fixture.missionId,
                link: "project_links",
            });
            expect(back.link.direction).toBe("inverse");
            expect(back.objects.map((r) => r.id)).toEqual([fixture.memberIds[0]]);

            const hop = await ontologyService.traverse(ORG_A, {
                objectType: "Project Resource",
                id: back.objects[0].id,
                link: "in_project",
            });
            expect(hop.objects.map((p) => p.id)).toEqual([fixture.projectId]);
        });

        it("does not match another type's row that happens to share an id", async () => {
            // resourceId 999999 is a CYCLE. Matching on the join key alone would hand
            // back any Mission with that id, which is the whole hazard of a
            // polymorphic join key.
            const back = await ontologyService.traverse(ORG_A, {
                objectType: "Mission",
                id: fixture.missionId,
                link: "project_links",
            });
            expect(back.objects.map((r) => r.id)).not.toContain(fixture.unmappedMemberId);
        });

        it("reads every resource in a project from the project end", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Project",
                id: fixture.projectId,
                link: "has_resource",
            });
            expect(res.objects.map((r) => r.id).sort()).toEqual([...fixture.memberIds].sort());
        });

        /**
         * The same containment as ONE hop — `backing = "path"`, composing
         * has_resource then resource_of. This is what a junction-table link would
         * have been, expressed by reusing traversal instead of adding join SQL.
         */
        describe("composed into a single hop", () => {
            it("reaches a project's missions directly", async () => {
                const res = await ontologyService.traverse(ORG_A, {
                    objectType: "Project",
                    id: fixture.projectId,
                    link: "has_mission",
                });
                expect(res.link.toType).toBe("Mission");
                expect(res.objects.map((m) => m.id)).toEqual([fixture.missionId]);
                expect(res.complete).toBe(true);
            });

            it("returns only the type it promised, though the last hop is polymorphic", async () => {
                // resource_of lands on missions, apps and datasets. has_app must not
                // hand back the mission just because it was reachable.
                const res = await ontologyService.traverse(ORG_A, {
                    objectType: "Project",
                    id: fixture.projectId,
                    link: "has_app",
                });
                expect(res.link.toType).toBe("App");
                expect(res.objects).toHaveLength(0);
            });

            it("walks the composition backwards", async () => {
                const res = await ontologyService.traverse(ORG_A, {
                    objectType: "Mission",
                    id: fixture.missionId,
                    link: "mission_of_project",
                });
                expect(res.link.direction).toBe("inverse");
                expect(res.objects.map((p) => p.id)).toEqual([fixture.projectId]);
            });

            it("stays inside the organization across every hop", async () => {
                await expect(
                    ontologyService.traverse(ORG_B, {
                        objectType: "Project",
                        id: fixture.projectId,
                        link: "has_mission",
                    }),
                ).rejects.toThrow(NotFoundError);
            });
        });
    });

    /**
     * Approval, whose org boundary is three-way: its own column when set, then the
     * job's, then the mission's. Most rows in the wild have a null org column, so the
     * fallback is not an edge case — it is the common path — and getting it wrong in
     * either direction is serious: too strict and the type reads as empty, too loose
     * and one org sees another's pending decisions.
     */
    describe("Approval primitive", () => {
        let ownJobId: number;
        let approvals: { byOwnOrg: number; byJob: number; unowned: number };

        beforeAll(async () => {
            const [job] = await db
                .insert(jobs)
                .values({
                    name: `${FIXTURE_TAG} org A job`,
                    organizationId: ORG_A.organizationId,
                    type: "test",
                    config: {},
                    createdBy: ORG_A.userId,
                })
                .returning({ id: jobs.id });
            ownJobId = job.id;

            const rows = await db
                .insert(approvalRequests)
                .values([
                    {
                        executionId: `${FIXTURE_TAG} own-org`,
                        organizationId: ORG_A.organizationId,
                        approverType: "internal",
                        approverEmail: "a@example.test",
                        toolName: "fixture_tool",
                        token: `${FIXTURE_TAG}-token-1`,
                        toolArgs: { secret: "do not surface" },
                    },
                    {
                        // The common shape: no org of its own, owned via the job.
                        executionId: `${FIXTURE_TAG} via-job`,
                        organizationId: null,
                        jobId: job.id,
                        approverType: "internal",
                        approverEmail: "b@example.test",
                        token: `${FIXTURE_TAG}-token-2`,
                    },
                    {
                        // No org, and a job id that matches no job — the real sentinel
                        // found on 15 rows in dev. Provable owner: none.
                        executionId: `${FIXTURE_TAG} unowned`,
                        organizationId: null,
                        jobId: 0,
                        approverType: "internal",
                        approverEmail: "c@example.test",
                        token: `${FIXTURE_TAG}-token-3`,
                    },
                ])
                .returning({ id: approvalRequests.id });
            approvals = { byOwnOrg: rows[0].id, byJob: rows[1].id, unowned: rows[2].id };
        });

        it("reads an approval that carries its own org", async () => {
            const a = await ontologyService.listObjects(ORG_A, "Approval", { limit: 200 });
            expect(a.map((r) => r.id)).toContain(approvals.byOwnOrg);
        });

        it("reaches an approval with no org of its own, through its job", async () => {
            const a = await ontologyService.listObjects(ORG_A, "Approval", { limit: 200 });
            expect(a.map((r) => r.id)).toContain(approvals.byJob);

            const b = await ontologyService.listObjects(ORG_B, "Approval", { limit: 200 });
            expect(b.map((r) => r.id)).not.toContain(approvals.byJob);
            await expect(
                ontologyService.getObject(ORG_B, "Approval", approvals.byJob),
            ).rejects.toThrow(NotFoundError);
        });

        it("shows an approval that can prove no owner to nobody", async () => {
            // The failure mode to avoid is the opposite one: an unowned row defaulting
            // into every org's list.
            for (const org of [ORG_A, ORG_B]) {
                const rows = await ontologyService.listObjects(org, "Approval", { limit: 200 });
                expect(rows.map((r) => r.id)).not.toContain(approvals.unowned);
                await expect(
                    ontologyService.getObject(org, "Approval", approvals.unowned),
                ).rejects.toThrow(NotFoundError);
            }
        });

        it("never surfaces the approval token or the gated payload", async () => {
            // token is the bearer secret in the external approval link; toolArgs and
            // modifiedOutput are the payload the approval exists to protect.
            const approval = await ontologyService.getObject(ORG_A, "Approval", approvals.byOwnOrg);
            expect(approval).not.toHaveProperty("token");
            expect(approval).not.toHaveProperty("toolArgs");
            expect(approval).not.toHaveProperty("modifiedOutput");
            expect(approval.approverEmail).toBe("a@example.test");
            expect(approval.label).toBe("fixture_tool");
        });

        it("labels an approval that names no tool", async () => {
            const approval = await ontologyService.getObject(ORG_A, "Approval", approvals.byJob);
            expect(approval.label).toBe(`Approval ${approvals.byJob}`);
        });

        it("reads has_approval from the job back to its approvals", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Job",
                id: ownJobId,
                link: "has_approval",
            });
            expect(res.link.direction).toBe("inverse");
            expect(res.objects.map((r) => r.id)).toEqual([approvals.byJob]);
        });

        it("follows for_job forward to the job it gates", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Approval",
                id: approvals.byJob,
                link: "for_job",
            });
            expect(res.link.toType).toBe("Job");
            expect(res.objects.map((j) => j.id)).toEqual([ownJobId]);
        });

        it("resolves an approval with no job to nothing, not to an error", async () => {
            const res = await ontologyService.traverse(ORG_A, {
                objectType: "Approval",
                id: approvals.byOwnOrg,
                link: "for_job",
            });
            expect(res.objects).toEqual([]);
            expect(res.complete).toBe(true);
            expect(res.note).toMatch(/no value for 'jobId'/);
        });
    });

    /**
     * The five adapters that were registered but named by no Object Type, so nothing
     * could reach them. These assertions are thin on purpose — the suite does not own
     * the ambient rows — but "the type resolves and its adapter answers" is exactly
     * what was untrue before.
     */
    describe("previously unreachable adapters", () => {
        it.each(["Signal", "Prediction", "Surprise", "Project Event", "Calculation"])(
            "registers and reads %s",
            async (typeName) => {
                const types = await ontologyService.listObjectTypes(ORG_A);
                expect(types.map((t) => t.name)).toContain(typeName);
                await expect(ontologyService.listObjects(ORG_A, typeName, { limit: 5 })).resolves.toBeInstanceOf(Array);
            },
        );

        it("declares the signal -> prediction -> surprise thread", async () => {
            const fromSignal = (await ontologyService.listLinkTypes(ORG_A, "Signal")).map((l) => l.inverseName);
            expect(fromSignal).toEqual(expect.arrayContaining(["has_prediction", "has_surprise"]));
        });
    });

    /**
     * Defaults only used to be seeded when an org was CREATED, so every org older than
     * a default — or older than the ontology tables — read an empty ontology forever.
     * A fresh instance is used rather than the singleton because the check is memoised
     * per process, and these assertions must not depend on which test ran first.
     */
    describe("default seeding for an org that already exists", () => {
        it("registers a default the org is missing, on the next read", async () => {
            await db
                .delete(ontologyObjectTypes)
                .where(and(eq(ontologyObjectTypes.organizationId, ORG_B.organizationId), eq(ontologyObjectTypes.name, "Query")));
            const gone = await db
                .select({ id: ontologyObjectTypes.id })
                .from(ontologyObjectTypes)
                .where(and(eq(ontologyObjectTypes.organizationId, ORG_B.organizationId), eq(ontologyObjectTypes.name, "Query")));
            expect(gone).toHaveLength(0);

            const types = await new OntologyService().listObjectTypes(ORG_B);
            expect(types.map((t) => t.name)).toContain("Query");
        });

        it("leaves a default the org switched off switched off", async () => {
            await db
                .update(ontologyObjectTypes)
                .set({ isActive: false })
                .where(and(eq(ontologyObjectTypes.organizationId, ORG_B.organizationId), eq(ontologyObjectTypes.name, "Dataset")));

            const types = await new OntologyService().listObjectTypes(ORG_B);
            expect(types.map((t) => t.name)).not.toContain("Dataset");

            // Present-but-inactive must not read as missing, or seeding would keep
            // reviving a type the org deliberately turned off.
            const [row] = await db
                .select({ isActive: ontologyObjectTypes.isActive })
                .from(ontologyObjectTypes)
                .where(and(eq(ontologyObjectTypes.organizationId, ORG_B.organizationId), eq(ontologyObjectTypes.name, "Dataset")));
            expect(row.isActive).toBe(false);

            await db
                .update(ontologyObjectTypes)
                .set({ isActive: true })
                .where(and(eq(ontologyObjectTypes.organizationId, ORG_B.organizationId), eq(ontologyObjectTypes.name, "Dataset")));
        });

        it("checks once per org, then stops touching the table", async () => {
            const svc = new OntologyService();
            await svc.listObjectTypes(ORG_A);

            // A default deleted AFTER the first read is not restored by the second:
            // the memo is what keeps this off the hot path of every ontology call.
            await db
                .delete(ontologyObjectTypes)
                .where(and(eq(ontologyObjectTypes.organizationId, ORG_A.organizationId), eq(ontologyObjectTypes.name, "Query")));
            const types = await svc.listObjectTypes(ORG_A);
            expect(types.map((t) => t.name)).not.toContain("Query");

            await ontologyService.seedDefaultObjectTypes(ORG_A);
        });
    });
});
